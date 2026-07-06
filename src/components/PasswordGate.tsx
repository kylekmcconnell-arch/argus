import { useState } from "react";
import { ArgusMark } from "./ArgusMark";

// A single-password gate in front of the whole app. Not hardened security (an SPA
// ships its code to the browser), but it keeps the platform out of casual hands —
// no one uses ARGUS without the shared password. The password is stored as its
// SHA-256, so the plaintext isn't sitting in the bundle; unlock persists locally.
const EXPECTED = "c5c66bc5374ebfeebadc8fb580617123880abebb9469c3b7e2299d7748c42fdd";
const KEY = "argus:gate";

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function PasswordGate({ children }: { children: React.ReactNode }) {
  const [unlocked, setUnlocked] = useState<boolean>(() => {
    try { return localStorage.getItem(KEY) === EXPECTED; } catch { return false; }
  });
  const [pw, setPw] = useState("");
  const [error, setError] = useState(false);
  const [checking, setChecking] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (checking) return;
    setChecking(true);
    setError(false);
    try {
      if ((await sha256(pw)) === EXPECTED) {
        try { localStorage.setItem(KEY, EXPECTED); } catch { /* noop */ }
        setUnlocked(true);
        return;
      }
    } catch { /* fall through to error */ }
    setError(true);
    setPw("");
    setChecking(false);
  };

  if (unlocked) return <>{children}</>;

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center px-6" style={{ background: "var(--color-void)" }}>
      <div className="grid-bg absolute inset-0 -z-10 opacity-60" />
      <div className="w-full max-w-[340px]">
        <div className="flex items-center gap-2.5">
          <ArgusMark size={30} />
          <span className="text-[19px] font-semibold tracking-tight text-ink">ARGUS</span>
        </div>
        <h1 className="mt-6 text-[20px] font-medium tracking-[-0.01em] text-ink">Restricted</h1>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-dim">Forensic due-diligence. Enter the password to continue.</p>

        <form onSubmit={submit} className="mt-5">
          <input
            type="password"
            autoFocus
            value={pw}
            onChange={(e) => { setPw(e.target.value); setError(false); }}
            placeholder="Password"
            className="mono w-full rounded-lg border bg-panel px-3 py-2.5 text-[14px] text-ink outline-none transition placeholder:text-ink-faint"
            style={{ borderColor: error ? "var(--color-avoid)" : "var(--color-line)" }}
          />
          {error && <div className="mt-1.5 text-[12px] text-avoid">Incorrect password.</div>}
          <button
            type="submit"
            disabled={checking || !pw}
            className="btn-primary mt-3 w-full py-2.5 text-[13.5px] font-medium disabled:opacity-40"
          >
            {checking ? "Checking…" : "Unlock"}
          </button>
        </form>
      </div>
    </div>
  );
}
