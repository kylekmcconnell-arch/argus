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
  relationshipProvenance?: "subject_official" | "claimant_self" | "counterparty" | "independent" | "third_party";
  source?: string;
  sourceUrl?: string;
}

const SPECIFIC_CORE_ROLE = /\b(?:founder|co[- ]?founder|chief\s+(?:executive|technology|operating|business|product|marketing|financial)\s+officer|ceo|cto|coo|cbo|cpo|cmo|cfo|business\s+development|bd\s+manager|product\s+lead|engineering\s+lead|lead\s+developer)\b/i;
const GENERIC_CORE_ROLE = /\b(?:developer|engineer|team(?:\s+member)?|core\s+team|operator)\b/i;
const CORE_ROLE = new RegExp(`${SPECIFIC_CORE_ROLE.source}|${GENERIC_CORE_ROLE.source}`, "i");
const ADVISOR_ROLE = /\b(?:advisor|adviser|advisory|ambassador)\b/i;
const BACKER_ROLE = /\b(?:vc|venture\s+capital|fund|investor|backer|backed[- ]?by)\b/i;
const PARTNER_ROLE = /\b(?:partner|partnership|integrat(?:ed|ion)|service\s+provider)\b/i;
const ECOSYSTEM_ROLE = /\b(?:ecosystem|community|accelerator|incubator)\b/i;
const AFFILIATION_ROLE = /\b(?:affiliation|team[- ]?affiliation)\b/i;
const FORMER_TEAM_ROLE = /\b(?:former|previously|ex[- ]|past)\b[^.;]{0,80}\b(?:founder|co[- ]?founder|team|developer|engineer|operator|ceo|cto|coo|cbo|cpo|cmo|cfo)\b/i;

const CONFIRMED_RELATIONSHIP_PROVENANCE = new Set<
  NonNullable<TeamRelationshipRecord["relationshipProvenance"]>
>(["subject_official", "counterparty", "independent"]);

export function hasConfirmedRelationshipProof(member: TeamRelationshipRecord): boolean {
  return Boolean(
    member.relationshipProvenance
    && CONFIRMED_RELATIONSHIP_PROVENANCE.has(member.relationshipProvenance),
  );
}

/**
 * P4 is a material-relationship axis. A generic occupation or self-authored bio
 * is still useful context, but only project-side, counterparty, or independent
 * proof of an explicit backer/partner relationship may support the score.
 */
export function isScoreableBackingRelationship(member: TeamRelationshipRecord): boolean {
  return member.evidence_origin !== "model_lead"
    && member.artifact_verified === true
    && hasConfirmedRelationshipProof(member)
    && (member.relationship === "backer" || member.relationship === "partner");
}

export function hasOperatingTeamRole(member: TeamRelationshipRecord): boolean {
  const role = member.role.trim();
  return member.kind !== "org"
    && !FORMER_TEAM_ROLE.test(role)
    && !AFFILIATION_ROLE.test(role)
    && !ADVISOR_ROLE.test(role)
    && CORE_ROLE.test(role);
}

export function classifyProjectRelationship(
  member: TeamRelationshipRecord,
): ProjectRelationshipClass {
  // Model/search rows remain candidates even if they arrived with a prefilled
  // relationship. Claimant-only bios are statements by the claimant, not proof
  // that the audited project recognizes the relationship.
  if (member.evidence_origin === "model_lead" || member.artifact_verified === false) return "candidate";
  if (member.relationshipProvenance === "claimant_self") return "associate";

  const role = member.role.trim();
  // Explicitly non-current or non-operating wording outranks a stale/pre-filled
  // core classification, even when the source itself is authoritative.
  if (member.kind !== "org" && FORMER_TEAM_ROLE.test(role)) return "associate";
  if (member.kind !== "org" && AFFILIATION_ROLE.test(role)) return "team_affiliation";
  if (member.kind !== "org" && ADVISOR_ROLE.test(role)) return "advisor";

  // A confirmed explicit classification outranks the remaining occupation
  // keywords. This preserves an official partner's engineer title as a
  // relationship and a current core member whose title is terse.
  if (
    member.relationship
    && member.relationship !== "candidate"
    && hasConfirmedRelationshipProof(member)
  ) {
    return member.relationship;
  }

  if (member.kind === "org") {
    if (BACKER_ROLE.test(role)) {
      return hasConfirmedRelationshipProof(member) ? "backer" : "associate";
    }
    if (PARTNER_ROLE.test(role)) {
      return hasConfirmedRelationshipProof(member) ? "partner" : "associate";
    }
    if (ECOSYSTEM_ROLE.test(role)) return "ecosystem";
    return "associate";
  }

  if (ECOSYSTEM_ROLE.test(role)) return "ecosystem";

  const hasSpecificCoreRole = SPECIFIC_CORE_ROLE.test(role);
  const hasGenericCoreRole = GENERIC_CORE_ROLE.test(role);

  // A concrete operating title wins for a person even when the same title
  // contains words such as "Investor Relations". Generic developer/engineer/
  // team language needs a project-side, counterparty, or independent binding;
  // otherwise it remains contextual rather than silently becoming employment.
  if (hasSpecificCoreRole) return "core_team";
  if (hasGenericCoreRole) {
    return hasConfirmedRelationshipProof(member) ? "core_team" : "associate";
  }

  // Occupation text alone does not establish a project relationship. VC/fund
  // and partner labels require proof that explicitly binds them to this subject.
  if (BACKER_ROLE.test(role)) {
    return hasConfirmedRelationshipProof(member) ? "backer" : "associate";
  }
  if (PARTNER_ROLE.test(role)) {
    return hasConfirmedRelationshipProof(member) ? "partner" : "associate";
  }
  return "associate";
}

export function isCoreTeamRecord(member: TeamRelationshipRecord): boolean {
  return member.kind !== "org" && classifyProjectRelationship(member) === "core_team";
}

export const normalizeTeamHandle = (value?: string): string => {
  const raw = (value ?? "")
    .trim()
    .replace(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\//i, "")
    .replace(/^@/, "")
    .replace(/[/?#].*$/, "")
    .toLowerCase();
  return /^[a-z0-9_]{1,30}$/.test(raw) ? raw : "";
};

export const normalizeTeamLinkedIn = (value?: string): string => {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host !== "linkedin.com" && !host.endsWith(".linkedin.com")) return "";
    const path = url.pathname.replace(/\/+$/, "").toLowerCase();
    return /^\/in\/[a-z0-9%_.-]+$/i.test(path) ? path : "";
  } catch {
    return "";
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

function sameTeamEntity(left: TeamRelationshipRecord, right: TeamRelationshipRecord): boolean {
  const aHandle = normalizeTeamHandle(left.handle);
  const bHandle = normalizeTeamHandle(right.handle);
  if (aHandle && bHandle) return aHandle === bHandle;
  const aLinkedIn = normalizeTeamLinkedIn(left.linkedin);
  const bLinkedIn = normalizeTeamLinkedIn(right.linkedin);
  if (aLinkedIn && bLinkedIn) return aLinkedIn === bLinkedIn;
  // Similar names are a review hint, never an identity key. A merge requires
  // the two rows to share at least one stable handle or LinkedIn profile.
  return false;
}

const RELATIONSHIP_PROVENANCE_RANK: Record<
  NonNullable<TeamRelationshipRecord["relationshipProvenance"]>,
  number
> = {
  third_party: 1,
  claimant_self: 2,
  independent: 4,
  counterparty: 4,
  subject_official: 5,
};

function relationshipAuthority(member: TeamRelationshipRecord): number {
  if (member.evidence_origin === "model_lead" || member.artifact_verified === false) return 0;
  if (member.relationshipProvenance) return RELATIONSHIP_PROVENANCE_RANK[member.relationshipProvenance];
  // A deterministically fetched, artifact-verified row without an explicit
  // relationship label still outranks self-claims and search-derived context.
  return member.artifact_verified === true ? 3 : 0;
}

function trustedRelationshipProvenance(
  member: TeamRelationshipRecord,
): TeamRelationshipRecord["relationshipProvenance"] {
  if (member.evidence_origin === "model_lead" || member.artifact_verified === false) return undefined;
  return member.relationshipProvenance;
}

function strongerRelationshipProvenance(
  left?: TeamRelationshipRecord["relationshipProvenance"],
  right?: TeamRelationshipRecord["relationshipProvenance"],
): TeamRelationshipRecord["relationshipProvenance"] {
  if (!left) return right;
  if (!right) return left;
  return RELATIONSHIP_PROVENANCE_RANK[right] > RELATIONSHIP_PROVENANCE_RANK[left] ? right : left;
}

function recordRank(member: TeamRelationshipRecord): number {
  return relationshipAuthority(member) * 32
    + (member.artifact_verified === true ? 8 : 0)
    + (member.evidence_origin !== "model_lead" ? 4 : 0)
    + (normalizeTeamHandle(member.handle) ? 2 : 0)
    + (normalizeTeamLinkedIn(member.linkedin) ? 1 : 0);
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
    ...(([left, right] as const).some((member) =>
      (member as TeamRelationshipRecord & { handleProvenance?: string }).handleProvenance === "subject_first_party"
      && member.evidence_origin !== "model_lead"
      && member.artifact_verified === true)
      ? { handleProvenance: "subject_first_party" }
      : {}),
    relationshipProvenance: trustedRelationshipProvenance(preferred)
      ? strongerRelationshipProvenance(
          trustedRelationshipProvenance(left),
          trustedRelationshipProvenance(right),
        )
      : undefined,
    relationship: hasConfirmedRelationshipProof(preferred)
      ? preferred.relationship
      : undefined,
  } as T;
}

/**
 * Collapse only identity-safe duplicates that share an exact normalized handle
 * or LinkedIn profile. Name similarity remains available to discovery as a lead,
 * but cannot collapse two people into one authoritative record.
 */
export function canonicalizeTeamRecords<T extends TeamRelationshipRecord>(
  rows: readonly T[],
): T[] {
  const out: T[] = [];
  for (const row of rows) {
    let merged = { ...row };
    let insertAt = out.length;
    // A bridge row can carry both a handle and LinkedIn URL, joining two
    // earlier one-identifier aliases. Re-scan after each merge so the result is
    // transitive without ever falling back to a fuzzy name.
    while (true) {
      const index = out.findIndex((candidate) => sameTeamEntity(candidate, merged));
      if (index < 0) break;
      insertAt = Math.min(insertAt, index);
      merged = mergeRecords(out[index], merged);
      out.splice(index, 1);
    }
    out.splice(Math.min(insertAt, out.length), 0, merged);
  }
  return out.map((row) => ({
    ...row,
    relationship: classifyProjectRelationship(row),
  }));
}

export function canonicalizeCoreTeamRecords<T extends TeamRelationshipRecord>(
  rows: readonly T[],
): T[] {
  // Merge the full relationship record first so the strongest bound source
  // governs classification. Filtering first can discard the official core-team
  // row while preserving a weaker alias as an associate.
  return canonicalizeTeamRecords(rows).filter(isCoreTeamRecord);
}
