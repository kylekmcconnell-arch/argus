const ORGANIZATION_WORDS = new Set([
  "app", "capital", "company", "corp", "corporation", "dao", "exchange",
  "finance", "foundation", "fund", "group", "inc", "incorporated", "labs",
  "limited", "llc", "ltd", "markets", "network", "protocol", "studio",
  "studios", "systems", "ventures", "wallet",
]);

const ROLE_OR_FRAGMENT_WORDS = new Set([
  "advisor", "adviser", "and", "backer", "board", "chief", "community",
  "cofounder", "co-founder", "consultant", "cto", "ceo", "cfo", "cmo",
  "coo", "developer", "director", "engineer", "executive", "founder", "head",
  "lead", "leader", "manager", "marketing", "member", "mentor", "officer",
  "operations", "operator", "owner", "partner", "president", "product",
  "researcher", "senior", "staff", "strategist", "team", "technical", "the",
  "vice", "vp",
]);

const SENTENCE_WORDS = new Set([
  "are", "at", "builds", "building", "founded", "from", "has", "have", "is",
  "joined", "leads", "of", "runs", "was", "were", "with",
]);

const HONORIFIC = /^(?:dr|mr|mrs|ms|prof)\.$/i;
const INITIAL = /^[A-Z]\.$/;
const HANDLE = /^@[A-Za-z0-9_]{2,30}$/;
const NAME_PART = /^[\p{L}\p{M}][\p{L}\p{M}'’\-]*\.?$/u;

/**
 * Reject organizations, job-title fragments, and prose from fields that claim
 * to contain a person. Pseudonyms and first-party-bound handles remain valid;
 * periods are admitted only for honorifics and initials, never sentence stops.
 */
export function isPlausiblePersonRosterName(value: string): boolean {
  const name = value.trim().replace(/\s+/g, " ");
  if (!name || name.length > 80) return false;
  if (HANDLE.test(name)) return true;
  if (/[:;!?()[\]{}|/\\]/.test(name)) return false;

  const parts = name.split(" ");
  if (parts.length > 6) return false;
  if (parts.some((part) => !NAME_PART.test(part))) return false;
  if (parts.some((part) => part.includes(".") && !HONORIFIC.test(part) && !INITIAL.test(part))) return false;

  const words = parts.map((part) => part.toLowerCase().replace(/[.'’]/g, ""));
  if (words.some((word) => ORGANIZATION_WORDS.has(word))) return false;
  if (words.some((word) => SENTENCE_WORDS.has(word))) return false;
  if (words.every((word) => ROLE_OR_FRAGMENT_WORDS.has(word))) return false;
  return true;
}
