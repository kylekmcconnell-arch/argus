/**
 * The panel capability this browser currently holds.
 *
 * Paid panel routes require a capability, and one is issued per scan (bound
 * to the run) or per saved report (bound to the version). Rather than
 * threading it through every panel component, the authenticated fetch
 * attaches whatever is current, and a component that passes its own
 * `x-argus-panel-token` still wins.
 *
 * The capability proves the workspace is entitled to run paid panels; it is
 * short-lived, server-signed, and cannot be minted here. Cost ATTRIBUTION
 * still uses the version-bound token a component passes explicitly, because
 * only that one names a report version.
 */
let current: string | null = null;

export function setPanelToken(token: string | null | undefined): void {
  if (typeof token === "string" && token.trim()) current = token.trim();
}

export function currentPanelToken(): string | null {
  return current;
}

/** Test seam: forget the capability, as a fresh tab would. */
export function clearPanelToken(): void {
  current = null;
}
