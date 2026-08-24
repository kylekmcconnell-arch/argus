export interface CreditReservation {
  chargedCredits: number;
  remainingCredits: number;
}

export async function reserveInvestigationCredit(
  idempotencyKey: string,
  kind: "token" | "investigation",
  canonicalRef: string,
  displayQuery = canonicalRef,
  privateRun = false,
  startedAt = new Date().toISOString(),
): Promise<CreditReservation> {
  const response = await fetch("/api/investigation-credit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idempotencyKey, kind, canonicalRef, displayQuery, privateRun, startedAt }),
  });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const message = typeof body.message === "string"
      ? body.message
      : response.status === 429
        ? "You have no investigation credits left. Ask a workspace owner to add credits before starting another scan."
        : "ARGUS could not check your credit balance. No providers were started and no credit was taken. Try again.";
    throw new Error(message);
  }
  const reservation = {
    chargedCredits: typeof body.chargedCredits === "number" ? body.chargedCredits : 0,
    remainingCredits: typeof body.remainingCredits === "number" ? body.remainingCredits : 0,
  };
  const browser = globalThis as unknown as {
    window?: { dispatchEvent: (event: unknown) => boolean };
    CustomEvent?: new (name: string, init: { detail: CreditReservation }) => unknown;
  };
  if (browser.window && browser.CustomEvent) {
    browser.window.dispatchEvent(new browser.CustomEvent("argus:credits-changed", { detail: reservation }));
  }
  return reservation;
}
