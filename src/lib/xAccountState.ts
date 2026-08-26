/**
 * X public-profile probe classification.
 *
 * A login wall, JS shell, or empty HTML is not a missing account. Terminal
 * states are only the phrases X itself prints: "Account suspended" and
 * "account does not exist". Frozen reports keep whatever status they stored.
 */

export type XAccountStatus =
  | "active"
  | "suspended"
  | "unavailable"
  | "temporarily_unavailable";

const SUSPENDED = /\bAccount suspended\b/i;
const DOES_NOT_EXIST = /\b(?:This account (?:doesn['’]t|does not) exist|Account does not exist)\b/i;

export function classifyPublicXAccountPage(html: string): Exclude<XAccountStatus, "active"> {
  if (SUSPENDED.test(html)) return "suspended";
  if (DOES_NOT_EXIST.test(html)) return "unavailable";
  return "temporarily_unavailable";
}

export function xAccountIdentityEstablished(profile: {
  identity_binding?: string | null;
  followers?: string | number | null;
  website?: string | null;
  profile_collection_state?: string | null;
  display_name?: string | null;
}): boolean {
  const followers = profile.followers;
  const hasFollowers = followers != null
    && String(followers).trim() !== ""
    && String(followers).trim() !== "N/A";
  return Boolean(
    profile.identity_binding
    || hasFollowers
    || profile.website
    || profile.profile_collection_state === "resolved"
    || (profile.display_name && profile.display_name.trim() && profile.display_name !== "N/A"),
  );
}

/**
 * Material banner / finding. Explicit suspension always announces.
 * "Does not exist" announces only when this run has not already bound
 * identity elsewhere. Temporary probe failures never announce.
 * Renderers of frozen dossiers should pass identityEstablished=false so
 * an old saved "unavailable" notice stays on the report.
 */
export function shouldAnnounceOfficialXAccountStatus(input: {
  accountStatus?: XAccountStatus | null;
  identityEstablished?: boolean;
}): boolean {
  if (input.accountStatus === "suspended") return true;
  if (input.accountStatus === "unavailable" && !input.identityEstablished) return true;
  return false;
}
