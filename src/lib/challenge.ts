/* The challenge contract: any surface that shows a scored claim can open the
   structured challenge dialog with the disputed context attached. The dialog
   collects WHO is challenging (the subject's own team, domain-verified by
   email, or a community member), the correction, optional evidence files, and
   the separate "where did this go wrong?" system-learning note. The events
   carry display context only — never evidence — so nothing here can be
   confused with stored data.

   A second event routes a context to the Argus Eye Q&A instead, used by the
   dialog's "ask about this first" affordance.

   Structural browser types, not DOM globals: this file is also compiled by
   the server and api tsconfigs, which intentionally omit the DOM lib. */

export const CHALLENGE_EVENT = "argus:challenge";
export const CHALLENGE_ASK_EVENT = "argus:challenge-ask";

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

/** Open the structured challenge dialog for a disputed context. */
export function requestChallenge(context: string, _anchorId = "ask-report"): void {
  void _anchorId; // kept for caller compatibility; the dialog replaces the scroll target
  const win = browserWindow();
  if (!win) return;
  win.dispatchEvent(new win.CustomEvent(CHALLENGE_EVENT, { detail: { context } }));
}

/** Route a disputed context to the Argus Eye Q&A instead of the dialog. */
export function requestChallengeAsk(context: string, anchorId = "ask-report"): void {
  const win = browserWindow();
  if (!win) return;
  win.document.getElementById(anchorId)?.scrollIntoView({
    behavior: win.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    block: "start",
  });
  win.dispatchEvent(new win.CustomEvent(CHALLENGE_ASK_EVENT, { detail: { context } }));
}
