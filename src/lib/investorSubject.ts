const INSTITUTION_LANGUAGE = /\b(?:venture(?:s)?|venture capital|capital partners?|investment (?:firm|fund|manager)|fund management|portfolio|accelerator|family office)\b/i;
const FIRST_PERSON_ORGANIZATION = /\b(?:we|our|us)\s+(?:back|fund|invest|partner|support|manage|help)\b/i;
const ORGANIZATION_NAME = /\b(?:ventures?|capital|partners?|holdings?|management|foundation|fund|labs?|group)\b/i;

/** INVESTOR is a methodology, not an entity type. */
export function isInstitutionalInvestorAccount(
  evidence: {
    roles: readonly unknown[];
    profile: {
      handle: string;
      display_name: string;
      resolved_name?: string;
      bio: string;
    };
  },
): boolean {
  if (!evidence.roles.some((role) => String(role) === "INVESTOR")) return false;
  if (evidence.profile.resolved_name?.trim()) return false;
  const display = evidence.profile.display_name.trim();
  const bio = evidence.profile.bio.trim();
  const handle = evidence.profile.handle.replace(/^@/, "").toLowerCase();
  return FIRST_PERSON_ORGANIZATION.test(bio)
    || INSTITUTION_LANGUAGE.test(`${display} ${bio}`)
    || ORGANIZATION_NAME.test(display)
    || /(?:vc|ventures|capital|fund|partners)$/.test(handle);
}

export function isOrganizationAccount(
  evidence: Parameters<typeof isInstitutionalInvestorAccount>[0],
): boolean {
  if (evidence.roles.some((role) => String(role) === "PROJECT")) return true;
  if (isInstitutionalInvestorAccount(evidence)) return true;
  if (!evidence.roles.some((role) => String(role) === "AGENCY")) return false;
  if (evidence.profile.resolved_name?.trim()) return false;
  const display = evidence.profile.display_name.trim();
  const bio = evidence.profile.bio.trim();
  const handle = evidence.profile.handle.replace(/^@/, "").toLowerCase();
  return /\b(?:we|our|us)\s+(?:build|provide|offer|help|serve|work|grow|market|design|develop|manage)\b/i.test(bio)
    || /\b(?:agency|studio|company|services?|consulting|marketing|development|group|labs?)\b/i.test(`${display} ${bio}`)
    || ORGANIZATION_NAME.test(display)
    || /(?:agency|studio|labs|group|services)$/.test(handle);
}
