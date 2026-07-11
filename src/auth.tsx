import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import {
  AuthContext,
  type ArgusSessionProfile,
  type AuthValue,
} from "./auth-context";
import { ArgusMark } from "./components/ArgusMark";
import {
  createAuthenticatedFetch,
  shouldRevalidateSession,
} from "./lib/authenticatedFetch";
import { setAnalyst } from "./lib/analyst";

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
      },
    })
  : null;

let fetchInstalled = false;
let currentAccessToken: string | null = null;
let validatedAccessToken: string | null = null;
let pendingAccessToken: string | null = null;
let currentValidationId = 0;

/** Add the current Supabase bearer token to same-origin API requests only. */
function installAuthenticatedFetch(): void {
  if (fetchInstalled || typeof window === "undefined") return;
  fetchInstalled = true;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = createAuthenticatedFetch(
    nativeFetch,
    window.location.origin,
    () => currentAccessToken,
  );
}

if (supabase) installAuthenticatedFetch();

async function loadProfile(session: Session): Promise<ArgusSessionProfile> {
  const response = await fetch("/api/session", {
    headers: { authorization: `Bearer ${session.access_token}` },
    signal: AbortSignal.timeout(12_000),
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const message = typeof body.message === "string" ? body.message : "ARGUS access could not be verified.";
    throw new Error(message);
  }
  return body as unknown as ArgusSessionProfile;
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
  const [loading, setLoading] = useState(authConfigured);
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [authenticatedButDenied, setAuthenticatedButDenied] = useState(false);

  const validate = useCallback(async (session: Session | null, validationId: number) => {
    setProfile(null);
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
      setProfile(next);
      setAnalyst(next.user.displayName);
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
    setAuthenticatedButDenied(false);
  }, []);

  const value = useMemo<AuthValue | null>(
    () => profile ? { ...profile, signOut } : null,
    [profile, signOut],
  );

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!supabase || sending) return;
    setSending(true);
    setError("");
    setMessage("");
    try {
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: email.trim().toLowerCase(),
        options: {
          // Preserve an exact immutable-version deep link through email OTP.
          // Hash fragments can contain auth material, so never echo them.
          emailRedirectTo: `${window.location.origin}${window.location.pathname}${window.location.search}`,
          shouldCreateUser: allowBootstrapSignup,
        },
      });
      if (otpError) throw otpError;
      setMessage("Check your email for the secure ARGUS sign-in link.");
    } catch (signInError) {
      setError(
        signInError instanceof Error
          ? signInError.message
          : "The sign-in link could not be sent.",
      );
    } finally {
      setSending(false);
    }
  };

  if (!authConfigured) {
    return (
      <GateShell>
        <h1 className="mt-6 text-[20px] font-medium tracking-[-0.01em] text-ink">Authentication setup required</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-dim">
          Set <span className="mono text-ink">VITE_SUPABASE_URL</span> and{" "}
          <span className="mono text-ink">VITE_SUPABASE_PUBLISHABLE_KEY</span>, then rebuild ARGUS.
        </p>
      </GateShell>
    );
  }

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

  if (value) return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;

  return (
    <GateShell>
      <h1 className="mt-6 text-[20px] font-medium tracking-[-0.01em] text-ink">
        {authenticatedButDenied ? "Access not provisioned" : "Investigator sign in"}
      </h1>
      <p className="mt-1.5 text-[13px] leading-relaxed text-ink-dim">
        {authenticatedButDenied
          ? "Your identity is verified, but this account is not an active member of an ARGUS workspace."
          : "Use your approved work email. ARGUS will send a one-time sign-in link—no shared password."}
      </p>

      {authenticatedButDenied ? (
        <button type="button" onClick={() => void signOut()} className="btn-primary mt-5 w-full py-2.5 text-[13.5px] font-medium">
          Sign out and use another account
        </button>
      ) : (
        <form onSubmit={submit} className="mt-5">
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
      )}

      {message && <div className="mt-3 rounded-lg border border-signal/30 bg-signal/5 px-3 py-2.5 text-[12px] leading-relaxed text-signal" role="status">{message}</div>}
      {error && <div className="mt-3 rounded-lg border border-avoid/30 bg-avoid/5 px-3 py-2.5 text-[12px] leading-relaxed text-avoid" role="alert">{error}</div>}
      <p className="mt-5 text-[11px] leading-relaxed text-ink-faint">
        Sessions are verified server-side. Workspace roles control reads, investigations, and destructive actions.
      </p>
    </GateShell>
  );
}
