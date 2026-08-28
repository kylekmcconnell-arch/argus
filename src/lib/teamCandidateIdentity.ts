/**
 * Reject an X profile URL that points at a different account than the person
 * candidate it is supposed to identify. A post by the project may still name
 * somebody else, so /status/ citations remain valid relationship evidence.
 */
export function teamCandidateSourceMatchesIdentity(candidate: {
  handle?: string | null;
  sourceUrl?: string | null;
}): boolean {
  const expected = (candidate.handle ?? "").trim().replace(/^@/, "").toLowerCase();
  const sourceUrl = (candidate.sourceUrl ?? "").trim();
  if (!expected || !sourceUrl) return true;

  try {
    const url = new URL(sourceUrl);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    if (host !== "x.com" && host !== "twitter.com") return true;
    const parts = url.pathname.split("/").filter(Boolean);
    if (!parts.length || parts[1]?.toLowerCase() === "status") return true;
    if (parts.length === 1) return parts[0].replace(/^@/, "").toLowerCase() === expected;
    return true;
  } catch {
    return true;
  }
}
