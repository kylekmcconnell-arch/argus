/**
 * Shared project-relationship ontology.
 *
 * A discovery lane may find a person, an organization, or a search candidate.
 * Only verified people in operating roles belong in the core-team roster or
 * P1 score. Advisors, investors, partners, ecosystem groups, and candidates
 * remain useful relationship context without becoming employees.
 */

export type ProjectRelationshipClass =
  | "core_team"
  | "advisor"
  | "backer"
  | "partner"
  | "ecosystem"
  | "team_affiliation"
  | "associate"
  | "candidate";

export interface TeamRelationshipRecord {
  name: string;
  role: string;
  handle?: string;
  linkedin?: string;
  kind?: "person" | "org";
  evidence_origin?: string;
  artifact_verified?: boolean;
  relationship?: ProjectRelationshipClass;
  source?: string;
  sourceUrl?: string;
}

const CORE_ROLE = /\b(?:founder|co[- ]?founder|chief\s+(?:executive|technology|operating|business|product|marketing|financial)\s+officer|ceo|cto|coo|cbo|cpo|cmo|cfo|business\s+development|bd\s+manager|developer|engineer|product\s+lead|engineering\s+lead|lead\s+developer|team(?:\s+member)?|core\s+team|operator)\b/i;
const ADVISOR_ROLE = /\b(?:advisor|adviser|advisory|ambassador)\b/i;
const BACKER_ROLE = /\b(?:vc|venture\s+capital|fund|investor|backer|backed[- ]?by)\b/i;
const PARTNER_ROLE = /\b(?:partner|partnership|integrat(?:ed|ion)|service\s+provider)\b/i;
const ECOSYSTEM_ROLE = /\b(?:ecosystem|community|accelerator|incubator)\b/i;
const AFFILIATION_ROLE = /\b(?:affiliation|team[- ]?affiliation)\b/i;

export function classifyProjectRelationship(
  member: TeamRelationshipRecord,
): ProjectRelationshipClass {
  if (member.relationship) return member.relationship;
  if (member.evidence_origin === "model_lead" || member.artifact_verified === false) return "candidate";
  const role = member.role.trim();
  if (member.kind === "org") {
    if (BACKER_ROLE.test(role)) return "backer";
    if (PARTNER_ROLE.test(role)) return "partner";
    if (ECOSYSTEM_ROLE.test(role)) return "ecosystem";
    return "associate";
  }
  if (ADVISOR_ROLE.test(role)) return "advisor";
  if (BACKER_ROLE.test(role)) return "backer";
  if (PARTNER_ROLE.test(role)) return "partner";
  if (ECOSYSTEM_ROLE.test(role)) return "ecosystem";
  if (AFFILIATION_ROLE.test(role)) return "team_affiliation";
  return CORE_ROLE.test(role) ? "core_team" : "associate";
}

export function isCoreTeamRecord(member: TeamRelationshipRecord): boolean {
  return member.kind !== "org" && classifyProjectRelationship(member) === "core_team";
}

const normalizedHandle = (value?: string): string =>
  (value ?? "").trim().replace(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\//i, "").replace(/^@/, "").toLowerCase();

const normalizedLinkedIn = (value?: string): string => {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return url.pathname.replace(/\/+$/, "").toLowerCase();
  } catch {
    return raw.replace(/^https?:\/\/(?:[^/]+)\//i, "/").replace(/\/+$/, "").toLowerCase();
  }
};

const GIVEN_NAME_ALIASES: Record<string, string> = {
  alexander: "alex",
  alexandra: "alex",
  william: "will",
  robert: "rob",
  michael: "mike",
  nicholas: "nick",
  jonathan: "jon",
  christopher: "chris",
};

function normalizedNameParts(value: string): string[] {
  const parts = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts[0] && GIVEN_NAME_ALIASES[parts[0]]) parts[0] = GIVEN_NAME_ALIASES[parts[0]];
  return parts;
}

function editDistance(left: string, right: string): number {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const prior = row[j];
      row[j] = Math.min(
        row[j] + 1,
        row[j - 1] + 1,
        previous + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
      previous = prior;
    }
  }
  return row[right.length];
}

export function samePersonName(left: string, right: string): boolean {
  const a = normalizedNameParts(left);
  const b = normalizedNameParts(right);
  if (a.length < 2 || b.length < 2 || a[0] !== b[0]) return false;
  const aLast = a[a.length - 1];
  const bLast = b[b.length - 1];
  return aLast === bLast
    || (Math.min(aLast.length, bLast.length) >= 6 && editDistance(aLast, bLast) <= 2);
}

function stableIdentityConflict(left: TeamRelationshipRecord, right: TeamRelationshipRecord): boolean {
  const aHandle = normalizedHandle(left.handle);
  const bHandle = normalizedHandle(right.handle);
  if (aHandle && bHandle && aHandle !== bHandle) return true;
  const aLinkedIn = normalizedLinkedIn(left.linkedin);
  const bLinkedIn = normalizedLinkedIn(right.linkedin);
  return Boolean(aLinkedIn && bLinkedIn && aLinkedIn !== bLinkedIn);
}

function sameTeamEntity(left: TeamRelationshipRecord, right: TeamRelationshipRecord): boolean {
  const aHandle = normalizedHandle(left.handle);
  const bHandle = normalizedHandle(right.handle);
  if (aHandle && bHandle) return aHandle === bHandle;
  const aLinkedIn = normalizedLinkedIn(left.linkedin);
  const bLinkedIn = normalizedLinkedIn(right.linkedin);
  if (aLinkedIn && bLinkedIn) return aLinkedIn === bLinkedIn;
  return !stableIdentityConflict(left, right) && samePersonName(left.name, right.name);
}

function recordRank(member: TeamRelationshipRecord): number {
  return (member.artifact_verified === true ? 8 : 0)
    + (member.evidence_origin !== "model_lead" ? 4 : 0)
    + (normalizedHandle(member.handle) ? 2 : 0)
    + (normalizedLinkedIn(member.linkedin) ? 1 : 0);
}

function mergeRecords<T extends TeamRelationshipRecord>(left: T, right: T): T {
  const preferred = recordRank(right) > recordRank(left) ? right : left;
  const other = preferred === left ? right : left;
  return {
    ...other,
    ...preferred,
    handle: preferred.handle || other.handle,
    linkedin: preferred.linkedin || other.linkedin,
    sourceUrl: preferred.sourceUrl || other.sourceUrl,
    source: preferred.source || other.source,
    role: preferred.role || other.role,
    artifact_verified: left.artifact_verified === true || right.artifact_verified === true,
    evidence_origin: left.evidence_origin === "model_lead" && right.evidence_origin === "model_lead"
      ? "model_lead"
      : preferred.evidence_origin ?? other.evidence_origin,
  } as T;
}

/**
 * Collapse only identity-safe duplicates: same handle, same LinkedIn profile,
 * or a conservative real-name variant (Alex/Alexander plus a near-identical
 * surname). Conflicting stable identifiers never merge.
 */
export function canonicalizeTeamRecords<T extends TeamRelationshipRecord>(
  rows: readonly T[],
): T[] {
  const out: T[] = [];
  for (const row of rows) {
    const index = out.findIndex((candidate) => sameTeamEntity(candidate, row));
    if (index < 0) out.push({ ...row });
    else out[index] = mergeRecords(out[index], row);
  }
  return out;
}

export function canonicalizeCoreTeamRecords<T extends TeamRelationshipRecord>(
  rows: readonly T[],
): T[] {
  return canonicalizeTeamRecords(rows.filter(isCoreTeamRecord));
}
