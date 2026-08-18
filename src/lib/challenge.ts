/* The challenge contract: any surface that shows a scored claim can send the
   reader to the console with the disputed context attached. AskReport is the
   single listener; the event carries display context only — never evidence —
   so nothing here can be confused with stored data.

   Structural browser types, not DOM globals: this file is also compiled by
   the server and api tsconfigs, which intentionally omit the DOM lib. */

export const CHALLENGE_EVENT = "argus:challenge";

export interface ChallengeDetail {
  /** Investor-readable description of what is being challenged,
      e.g. "Team & identity · scored 14/25". */
  context: string;
}

interface ScrollTarget {
  scrollIntoView(options?: { behavior: "auto" | "smooth"; block: "start" }): void;
}

interface ChallengeWindow {
  matchMedia(query: string): { matches: boolean };
  dispatchEvent(event: unknown): boolean;
  CustomEvent: new (type: string, init: { detail: ChallengeDetail }) => unknown;
  document: { getElementById(id: string): ScrollTarget | null };
}

function browserWindow(): ChallengeWindow | undefined {
  return (globalThis as { window?: ChallengeWindow }).window;
}

export function requestChallenge(context: string, anchorId = "ask-report"): void {
  const win = browserWindow();
  if (!win) return;
  win.document.getElementById(anchorId)?.scrollIntoView({
    behavior: win.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    block: "start",
  });
  win.dispatchEvent(new win.CustomEvent(CHALLENGE_EVENT, { detail: { context } }));
}
