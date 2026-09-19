/* Plain helpers for the inline challenge form: the persistent target shape and
   the exact context and body sent to the existing review workflow. */

export interface ChallengeTarget {
  /** Persistent finding id (chapter + record key). */
  id: string;
  title: string;
  /** The saved text or figure being challenged. */
  claim: string;
}

export function challengeContextLine(target: ChallengeTarget, version?: number): string {
  const suffix = ` [${target.id}${version ? ` · v${version}` : ""}]`;
  return `${target.title.slice(0, 300 - suffix.length)}${suffix}`;
}

export function challengeBody(input: { reason: string; explanation: string; evidence: string; claim: string; version?: number }): string {
  const parts = [
    `Review type: ${input.reason}`,
    input.explanation.trim(),
    input.evidence.trim() ? `Evidence references:\n${input.evidence.trim()}` : "",
  ].filter(Boolean);
  const head = parts.join("\n\n");
  const claimLabel = `\n\nFinding as saved${input.version ? ` in version ${input.version}` : ""}: `;
  const room = 4000 - head.length - claimLabel.length;
  if (room < 40) return head.slice(0, 4000);
  const claim = input.claim.replace(/\s+/g, " ").trim();
  return `${head}${claimLabel}${claim.length > room ? `${claim.slice(0, room - 1)}…` : claim}`;
}

/** A challenge raised by an existing panel through the shared challenge event. */
export function panelTargetForContext(context: string): ChallengeTarget {
  const slug = context.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "report";
  return { id: `panel:${slug}`, title: context.length > 90 ? `${context.slice(0, 89)}…` : context, claim: context };
}
