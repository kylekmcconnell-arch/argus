import { useEffect, useState } from "react";
import { sessionExpired, subscribeSessionExpiry } from "../lib/sessionExpiry";

/**
 * One clear line when the session stops being accepted, instead of a page of
 * panels that quietly failed. Deliberately does not sign the analyst out or
 * redirect: a scan may be running, and its result must survive long enough to
 * be read. Reloading is their choice.
 */
export function SessionExpiryNotice() {
  const [expired, setExpired] = useState(sessionExpired);
  useEffect(() => subscribeSessionExpiry(() => setExpired(true)), []);
  if (!expired) return null;
  return (
    <div
      role="alert"
      className="tint-caution border-b px-4 py-2 text-[12.5px] leading-relaxed"
    >
      <span className="font-medium text-ink">Your session expired.</span>{" "}
      <span className="text-ink-dim">
        Some panels stopped loading because the server no longer accepts this sign-in. Anything already on screen is still yours to read.
      </span>{" "}
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="underline underline-offset-2 hover:text-ink"
      >
        Reload to sign in again
      </button>
    </div>
  );
}
