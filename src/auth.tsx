import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import {
  AuthContext,
  type ArgusSessionProfile,
  type AuthValue,
} from "./auth-context";
import { ArgusMark } from "./components/ArgusMark";
import { PublicAccessHome } from "./components/PublicAccessHome";
import { WaitlistPortal } from "./components/WaitlistPortal";
import {
  createAuthenticatedFetch,
  shouldRevalidateSession,
} from "./lib/authenticatedFetch";
import { setAnalyst } from "./lib/analyst";
import { requestArgusSignInLink } from "./lib/signInRequest";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, "") || "";
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
const authConfigured = Boolean(supabaseUrl && publishableKey);
const allowBootstrapSignup = import.meta.env.VITE_ARGUS_ALLOW_BOOTSTRAP_SIGNUP === "true";

const supabase: SupabaseClient | null = authConfigured
  ? createClient(supabaseUrl, publishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        experimental: { passkey: true },
      },
    })
  : null;

let fetchInstalled = false;
let currentAccessToken: string | null = null;
let validatedAccessToken: string | null = null;
let pendingAccessToken: string | null = null;
let currentValidationId = 0;
let refreshInFlight: Promise<string | null> | null = null;

// Force a session refresh (used only when an API call 401s on a stale token).
// Single-flight so a burst of 401s triggers one refresh, not a stampede.
function refreshAccessTokenOnce(): Promise<string | null> {
  if (!supabase) return Promise.resolve(null);
  if (!refreshInFlight) {
    refreshInFlight = supabase.auth.refreshSession()
      .then(({ data }) => {
        const t = data.session?.access_token ?? null;
        if (t) currentAccessToken = t;
        return t;
      })
      .catch(() => null)
      .finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}

/** Add the current Supabase bearer token to same-origin API requests only. */
function installAuthenticatedFetch(): void {
  if (fetchInstalled || typeof window === "undefined") return;
  fetchInstalled = true;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = createAuthenticatedFetch(
    nativeFetch,
    window.location.origin,
    () => currentAccessToken,
    refreshAccessTokenOnce,
  );
}

if (supabase) installAuthenticatedFetch();

interface WaitlistSession {
  user: { id: string; email: string; displayName: string };
  waitlist: { publicName: string; code: string; status: string };
}

type SessionResult =
  | { kind: "member"; profile: ArgusSessionProfile }
  | { kind: "waitlist"; session: WaitlistSession };

async function loadProfile(session: Session): Promise<SessionResult> {
  const response = await fetch("/api/session", {
    headers: { authorization: `Bearer ${session.access_token}` },
    signal: AbortSignal.timeout(12_000),
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const message = typeof body.message === "string" ? body.message : "ARGUS access could not be verified.";
    throw new Error(message);
  }
  if (body.access === "waitlist") {
    return { kind: "waitlist", session: body as unknown as WaitlistSession };
  }
  return { kind: "member", profile: body as unknown as ArgusSessionProfile };
}

function PasskeyEnrollmentNotice({ children }: { children: React.ReactNode }) {
  const [needed, setNeeded] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const [error, setError] = useState("");
  const dismissed = typeof window !== "undefined"
    && window.sessionStorage.getItem("argus-passkey-nudge-dismissed") === "1";

  useEffect(() => {
    if (!supabase || dismissed) return;
    let active = true;
    void supabase.auth.passkey.list()
      .then(({ data, error: listError }) => {
        if (!active || listError) return;
        setNeeded(Array.isArray(data) && data.length === 0);
      })
      .catch(() => {
        // Passkeys are progressive enhancement; magic-link recovery remains.
      });
    return () => { active = false; };
  }, [dismissed]);

  const enroll = async () => {
    if (!supabase || enrolling) return;
    setEnrolling(true);
    setError("");
    try {
      const { error: enrollError } = await supabase.auth.registerPasskey();
      if (enrollError) throw enrollError;
      setNeeded(false);
    } catch (enrollError) {
      setError(enrollError instanceof Error ? enrollError.message : "Passkey setup was cancelled.");
    } finally {
      setEnrolling(false);
    }
  };

  const dismiss = () => {
    window.sessionStorage.setItem("argus-passkey-nudge-dismissed", "1");
    setNeeded(false);
  };

  return (
    <>
      {children}
      {needed && (
        <aside className="fixed right-4 top-4 z-[70] w-[min(390px,calc(100%-2rem))] rounded-xl border border-signal/35 bg-panel p-4 shadow-xl" aria-label="Passkey setup">
          <div className="text-[13.5px] font-medium text-ink">Secure ARGUS with a passkey</div>
          <p className="mt-1 text-[11.5px] leading-relaxed text-ink-dim">
            Use Face ID, Touch ID, Windows Hello, a device PIN, or a hardware key next time. Your email link stays available for recovery.
          </p>
          {error && <p className="mt-2 text-[11.5px] text-avoid" role="alert">{error}</p>}
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={dismiss} className="btn-chip">Later</button>
            <button type="button" onClick={() => void enroll()} disabled={enrolling} className="btn-primary px-3 py-1.5 text-[12px] disabled:opacity-50">
              {enrolling ? "Opening passkey…" : "Create passkey"}
            </button>
          </div>
        </aside>
      )}
    </>
  );
}

function GateShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center px-6" style={{ background: "var(--color-void)" }}>
      <div className="grid-bg absolute inset-0 -z-10 opacity-60" />
      <div className="w-full max-w-[380px]">
        <div className="flex items-center gap-2.5">
          <ArgusMark size={30} />
          <span className="text-[19px] font-semibold tracking-tight text-ink">ARGUS</span>
        </div>
        {children}
      </div>
    </div>
  );
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [profile, setProfile] = useState<ArgusSessionProfile | null>(null);
  const [waitlist, setWaitlist] = useState<WaitlistSession | null>(null);
  const [loading, setLoading] = useState(authConfigured);
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [passkeySending, setPasskeySending] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const [authenticatedButDenied, setAuthenticatedButDenied] = useState(false);
  const [showSignIn, setShowSignIn] = useState(
    () => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("view") === "login",
  );

  useEffect(() => {
    const syncPublicRoute = () => {
      setShowSignIn(new URLSearchParams(window.location.search).get("view") === "login");
    };
    window.addEventListener("popstate", syncPublicRoute);
    return () => window.removeEventListener("popstate", syncPublicRoute);
  }, []);

  const validate = useCallback(async (session: Session | null, validationId: number) => {
    setProfile(null);
    setWaitlist(null);
    setAuthenticatedButDenied(false);
    if (!session) {
      validatedAccessToken = null;
      pendingAccessToken = null;
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const next = await loadProfile(session);
      if (validationId !== currentValidationId) return;
      validatedAccessToken = session.access_token;
      if (next.kind === "waitlist") {
        setWaitlist(next.session);
        setAnalyst(next.session.user.displayName);
      } else {
        setProfile(next.profile);
        setAnalyst(next.profile.user.displayName);
      }
      setError("");
    } catch (validationError) {
      if (validationId !== currentValidationId) return;
      validatedAccessToken = session.access_token;
      setAuthenticatedButDenied(true);
      setError(validationError instanceof Error ? validationError.message : "Access could not be verified.");
    } finally {
      if (validationId === currentValidationId) {
        pendingAccessToken = null;
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      // Leave Supabase's auth callback before making another network request.
      const nextAccessToken = session?.access_token ?? null;
      currentAccessToken = nextAccessToken;
      if (!shouldRevalidateSession(
        nextAccessToken,
        validatedAccessToken,
        pendingAccessToken,
      )) return;
      pendingAccessToken = nextAccessToken;
      const validationId = ++currentValidationId;
      setTimeout(() => {
        if (active && validationId === currentValidationId) {
          void validate(session, validationId);
        }
      }, 0);
    });
    return () => {
      active = false;
      currentAccessToken = null;
      validatedAccessToken = null;
      pendingAccessToken = null;
      currentValidationId += 1;
      data.subscription.unsubscribe();
    };
  }, [validate]);

  const signOut = useCallback(async () => {
    setError("");
    setMessage("");
    currentAccessToken = null;
    validatedAccessToken = null;
    pendingAccessToken = null;
    currentValidationId += 1;
    await supabase?.auth.signOut();
    setProfile(null);
    setWaitlist(null);
    setAuthenticatedButDenied(false);
  }, []);

  const value = useMemo<AuthValue | null>(
    () => profile ? { ...profile, signOut } : null,
    [profile, signOut],
  );

  const signInWithPasskey = async () => {
    if (!supabase || passkeySending) return;
    setPasskeySending(true);
    setError("");
    setMessage("");
    try {
      const { error: passkeyError } = await supabase.auth.signInWithPasskey();
      if (passkeyError) throw passkeyError;
    } catch (signInError) {
      setError(signInError instanceof Error ? signInError.message : "Passkey sign-in was cancelled.");
    } finally {
      setPasskeySending(false);
    }
  };

  const enrollPasskey = async () => {
    if (!supabase || enrolling) return;
    setEnrolling(true);
    setError("");
    try {
      const { error: enrollError } = await supabase.auth.registerPasskey();
      if (enrollError) throw enrollError;
    } catch (enrollError) {
      setError(enrollError instanceof Error ? enrollError.message : "Passkey setup was cancelled.");
    } finally {
      setEnrolling(false);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!supabase || sending) return;
    setSending(true);
    setError("");
    setMessage("");
    try {
      if (allowBootstrapSignup) {
        const { error: otpError } = await supabase.auth.signInWithOtp({
          email: email.trim().toLowerCase(),
          options: {
            // Bootstrap is an explicit temporary setup mode. Normal ARGUS
            // sign-in is always gated by active server-owned membership.
            emailRedirectTo: `${window.location.origin}${window.location.pathname}${window.location.search}`,
            shouldCreateUser: true,
          },
        });
        if (otpError) throw otpError;
        setMessage("Check your email for the secure ARGUS sign-in link.");
      } else {
        const nextMessage = await requestArgusSignInLink(
          window.fetch.bind(window),
          email,
          `${window.location.pathname}${window.location.search}`,
        );
        setMessage(nextMessage);
      }
    } catch (signInError) {
      const message = signInError instanceof Error
        ? signInError.message
        : "The sign-in link could not be sent.";
      setError(message);
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <GateShell>
        <div className="mt-7 flex items-center gap-2 text-[13px] text-ink-dim" role="status">
          <span className="h-2 w-2 animate-pulse rounded-full bg-signal" />
          Verifying secure access…
        </div>
      </GateShell>
    );
  }

  if (waitlist) {
    return (
      <WaitlistPortal
        displayName={waitlist.user.displayName}
        onEnrollPasskey={enrollPasskey}
        passkeyBusy={enrolling}
        passkeyError={error}
        onSignOut={signOut}
      />
    );
  }

  if (value) {
    return (
      <AuthContext.Provider value={value}>
        <PasskeyEnrollmentNotice>{children}</PasskeyEnrollmentNotice>
      </AuthContext.Provider>
    );
  }

  if (!authenticatedButDenied && !showSignIn) {
    return (
      <PublicAccessHome
        onLogin={() => {
          window.history.pushState({}, "", "/?view=login");
          setShowSignIn(true);
        }}
        onCode={(code) => {
          window.location.assign(`/?view=join&ref=${encodeURIComponent(code)}`);
        }}
      />
    );
  }

  if (!authConfigured) {
    return (
      <GateShell>
        <button
          type="button"
          onClick={() => {
            window.history.pushState({}, "", "/");
            setShowSignIn(false);
          }}
          className="mt-6 text-[12px] text-ink-dim underline underline-offset-4 hover:text-ink"
        >
          Back to home
        </button>
        <h1 className="mt-5 text-[20px] font-medium tracking-[-0.01em] text-ink">Authentication setup required</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-dim">
          Set <span className="mono text-ink">VITE_SUPABASE_URL</span> and{" "}
          <span className="mono text-ink">VITE_SUPABASE_PUBLISHABLE_KEY</span>, then rebuild ARGUS.
        </p>
      </GateShell>
    );
  }

  return (
    <GateShell>
      {!authenticatedButDenied && (
        <button
          type="button"
          onClick={() => {
            window.history.pushState({}, "", "/");
            setShowSignIn(false);
          }}
          className="mt-6 text-[12px] text-ink-dim underline underline-offset-4 hover:text-ink"
        >
          Back to home
        </button>
      )}
      <h1 className="mt-6 text-[20px] font-medium tracking-[-0.01em] text-ink">
        {authenticatedButDenied ? "Access not provisioned" : "Investigator sign in"}
      </h1>
      <p className="mt-1.5 text-[13px] leading-relaxed text-ink-dim">
        {authenticatedButDenied
          ? "Your identity is verified, but this account is not an active member of an ARGUS workspace."
          : "Use a passkey, or verify your email once and create a passkey after you enter ARGUS."}
      </p>

      {authenticatedButDenied ? (
        <button type="button" onClick={() => void signOut()} className="btn-primary mt-5 w-full py-2.5 text-[13.5px] font-medium">
          Sign out and use another account
        </button>
      ) : (
        <div className="mt-5">
          <button
            type="button"
            onClick={() => void signInWithPasskey()}
            disabled={passkeySending}
            className="btn-primary w-full py-2.5 text-[13.5px] font-medium disabled:opacity-40"
          >
            {passkeySending ? "Opening passkey…" : "Sign in with a passkey"}
          </button>
          <div className="my-3 flex items-center gap-3" aria-hidden>
            <span className="h-px flex-1 bg-line" />
            <span className="mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">or use email</span>
            <span className="h-px flex-1 bg-line" />
          </div>
        <form onSubmit={submit}>
          <label htmlFor="argus-email" className="mb-1.5 block text-[12px] font-medium text-ink-dim">Work email</label>
          <input
            id="argus-email"
            type="email"
            autoComplete="email"
            autoFocus
            required
            value={email}
            onChange={(event) => { setEmail(event.target.value); setError(""); setMessage(""); }}
            placeholder="you@company.com"
            className="mono w-full rounded-lg border bg-panel px-3 py-2.5 text-[14px] text-ink outline-none transition placeholder:text-ink-faint"
            style={{ borderColor: error ? "var(--color-avoid)" : "var(--color-line)" }}
          />
          <button
            type="submit"
            disabled={sending || !email.trim()}
            className="btn-primary mt-3 w-full py-2.5 text-[13.5px] font-medium disabled:opacity-40"
          >
            {sending ? "Sending secure link…" : "Email me a sign-in link"}
          </button>
        </form>
        </div>
      )}

      {message && <div className="mt-3 rounded-lg border border-signal/30 bg-signal/5 px-3 py-2.5 text-[12px] leading-relaxed text-signal-lift" role="status">{message}</div>}
      {error && <div className="mt-3 rounded-lg border border-avoid/30 bg-avoid/5 px-3 py-2.5 text-[12px] leading-relaxed text-avoid" role="alert">{error}</div>}
      <p className="mt-5 text-[11px] leading-relaxed text-ink-faint">
        Sessions are verified server-side. Workspace roles control reads, investigations, and destructive actions.
      </p>
      {!authenticatedButDenied && (
        <p className="mt-3 text-[12.5px] text-ink-dim">
          New here? <a href="/?view=join" className="text-signal-lift underline">Request early access</a>
          {" · "}
          <a href="/?view=leaderboard" className="text-signal-lift underline">Referral board</a>
          {" · "}
          <a href="/?view=pricing" className="text-signal-lift underline">Pricing</a>
        </p>
      )}
    </GateShell>
  );
}
