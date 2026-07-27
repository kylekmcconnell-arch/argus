import { useEffect, useState } from "react";

const CHECK_INTERVAL_MS = 5 * 60_000;

/**
 * True once a newer ARGUS deploy is live than the one this tab loaded.
 *
 * A long-lived SPA tab keeps rendering with the bundle it booted on, so a fix
 * deployed mid-session is invisible until a manual refresh. Detection follows
 * the documented deploy signal: index.html's last-modified header flips on
 * every prod deploy, including server-only ones the bundle hash cannot see.
 * The first probe freezes a baseline; any later change marks the tab stale.
 * Probe failures (offline, blocked HEAD) stay silent and never nag.
 */
export function useDeployFreshness(): boolean {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    let baseline: string | null = null;
    let cancelled = false;
    const probe = async () => {
      try {
        const res = await fetch("/", { method: "HEAD", cache: "no-store" });
        const modified = res.headers.get("last-modified");
        if (cancelled || !modified) return;
        if (baseline === null) {
          baseline = modified;
          return;
        }
        if (modified !== baseline) setStale(true);
      } catch {
        // A failed probe is never evidence of anything.
      }
    };
    void probe();
    const timer = setInterval(() => { void probe(); }, CHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);
  return stale;
}
