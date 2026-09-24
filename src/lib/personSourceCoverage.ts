import type { WebTeamMember } from "../data/evidence";

/** A source receipt describes collection, independently of identity confidence. */
export interface PersonSourceReceipt {
  platform: "x" | "linkedin" | "web";
  url?: string;
  status: "read" | "partial" | "blocked" | "failed" | "no_match" | "not_searched";
  capturedAt: string;
  scope: string;
  provider: string;
}
export interface PersonSourceCoverage {
  platform: PersonSourceReceipt["platform"];
  label: string;
  url?: string;
  identity: string;
  access: string;
  coverage: string;
  capturedAt?: string;
  nextAction: string;
}
const ACCESS: Record<PersonSourceReceipt["status"], string> = {
  read: "Read successfully", partial: "Partially read", blocked: "Access blocked",
  failed: "Provider unavailable", no_match: "Searched; no match", not_searched: "Not searched",
};
export function personSourceCoverage(member: WebTeamMember, links: { x?: string | null; linkedin?: string | null }, candidates: readonly { url: string }[] = []): PersonSourceCoverage[] {
  return (["x", "linkedin", "web"] as const).map(platform => {
    const url = platform === "web" ? member.sourceUrl : links[platform];
    // A receipt for another URL cannot establish this profile's access state.
    const receipt = (member.sourceReceipts ?? []).filter(row => row.platform === platform && (!url ? !row.url : row.url === url))
      .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))[0];
    const candidate = candidates.some(row => {
      try { const host = new URL(row.url).hostname; return platform === "x" ? /^(www\.)?(x|twitter)\.com$/.test(host) : platform === "linkedin" && /(^|\.)linkedin\.com$/.test(host); } catch { return false; }
    });
    return {
      platform, label: platform === "x" ? "X" : platform === "linkedin" ? "LinkedIn" : "Official role source",
      url: url || undefined,
      identity: platform === "x" && member.handleProvenance === "subject_first_party" && url ? "Linked by the subject" : url ? "Recorded reference; identity not independently verified" : candidate ? "Candidate; identity unresolved" : "No bound source recorded",
      access: receipt ? ACCESS[receipt.status] : url ? "Link recorded; read status unknown" : candidate ? "Candidate found; read status unknown" : "Search status not recorded",
      coverage: receipt?.scope || "Historical coverage was not recorded. A link alone does not establish that the profile was read.",
      capturedAt: receipt?.capturedAt,
      nextAction: platform === "x" ? "Check dated project announcements and earlier account history." : platform === "linkedin" ? "Corroborate role dates and previous companies with independent records." : "Verify the current role and follow the person's own profile links.",
    };
  });
}
