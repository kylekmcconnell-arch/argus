// A face, follower count, and account status only for a team member whose
// handle the SUBJECT ITSELF bound — its own posts, following edge, or
// amplification edge. Everyone else (team page, site search, model leads)
// stays bare. See `WebTeamMember.handleProvenance` in ../../src/data/evidence
// for why this gate is a durable marker and not the general evidence-origin
// field, which a separate path can flatten for the whole roster.

import type { CollectContext } from "./types";
import type { WebTeamMember } from "../../src/data/evidence";
import { getProfile, type XProfile } from "./x";
import { fetchTrustedProfileImage } from "./profilePhoto";

const MAX_ENRICHED_MEMBERS = 15;

const ORGANIZATION_NAME = /\b(?:dao|foundation|collective|company|studio|studios|network|media|magazine|protocol|community)\b/i;
const ORGANIZATION_BIO = /\b(?:nft\s+(?:project|collection|community)|digital\s+collectibles?|official\s+(?:account|community)|community[- ](?:led|owned)\s+(?:project|platform)|we\s+(?:build|are|create|represent)|our\s+(?:community|project|mission|platform|collection))\b/i;
const COLLECTIVE_NAME = /^(?:women|men|builders|artists|developers|friends|fans|community)\s+(?:of|for)\b/i;

/** A strict organization result; ambiguity remains a person lead, never an org guess. */
export function teamProfileEntityType(profile: Pick<XProfile, "name" | "bio">): "organization" | "unknown" {
  const name = String(profile.name ?? "").replace(/\s+/g, " ").trim();
  const bio = String(profile.bio ?? "").replace(/\s+/g, " ").trim();
  return COLLECTIVE_NAME.test(name) || ORGANIZATION_NAME.test(name) || ORGANIZATION_BIO.test(bio)
    ? "organization"
    : "unknown";
}

function preserveRelatedOrganization(ctx: CollectContext, member: WebTeamMember, profile: XProfile): void {
  member.kind = "org";
  member.name = profile.name?.trim() || member.name;
  member.biography = profile.bio?.trim() || member.biography;
  const originalRole = member.role;
  member.role = "related organization";
  member.evidence = `${member.evidence ?? "The official account mentioned this handle."} The handle's own profile describes an organization, so ARGUS excluded it from the team roster.`;

  const handle = member.handle!;
  const key = handle.replace(/^@/, "").toLowerCase();
  if (!ctx.evidence.associates.some((associate) => associate.associate_handle.replace(/^@/, "").toLowerCase() === key)) {
    ctx.evidence.associates.push({
      associate_handle: handle,
      relation: "official-post mention",
      notes: `Mentioned beside the role \"${originalRole}\", but ${handle}'s own profile identifies an organization rather than a person. Preserved as related context; not team evidence.`,
      evidence_url: member.sourceUrl ?? profile.statusSourceUrl,
      provider: "twitterapi",
      evidence_origin: "deterministic",
      artifact_verified: true,
    });
  }
}

async function enrichOne(ctx: CollectContext, member: WebTeamMember): Promise<"person" | "organization" | false> {
  const profile = await getProfile(member.handle!);
  if (!profile) return false;
  member.accountStatus = profile.accountStatus;
  member.followers = profile.followers;
  member.enrichmentProvider = "twitterapi";
  member.enrichmentSourceUrl = profile.statusSourceUrl;
  if (teamProfileEntityType(profile) === "organization") {
    preserveRelatedOrganization(ctx, member, profile);
    return "organization";
  }
  if (!profile.image) return "person";
  const image = await fetchTrustedProfileImage(profile.image);
  if (!image) return "person";
  member.avatarUrl = image.url;
  member.avatarContentHash = image.contentHash;
  member.avatarCapturedAt = profile.statusCapturedAt;
  return "person";
}

export async function enrichFirstPartyTeamAvatars(ctx: CollectContext): Promise<void> {
  const webTeam = ctx.evidence.webTeam ?? [];
  const targets = webTeam
    .filter((member) => member.handle && member.handleProvenance === "subject_first_party" && !member.avatarUrl)
    .slice(0, MAX_ENRICHED_MEMBERS);
  if (!targets.length) return;

  let enriched = 0;
  let reclassified = 0;
  for (const member of targets) {
    // A failed lookup for one person must never fail the run or drop the
    // person from the roster; it just leaves them bare.
    try {
      const result = await enrichOne(ctx, member);
      if (result === "person") enriched++;
      if (result === "organization") reclassified++;
    } catch (error) {
      ctx.emit({
        phase: "P1 · Team",
        label: "Team enrichment error",
        detail: `${member.name}${member.handle ? ` (${member.handle})` : ""}: ${String(error)}`,
        source: "twitterapi.io",
        tone: "warn",
      });
    }
  }
  if (enriched) {
    ctx.emit({
      phase: "P1 · Team",
      label: "Team member photos",
      detail: `Enriched ${enriched} of ${targets.length} team handle${targets.length === 1 ? "" : "s"} the subject account itself bound (its own posts, following, or amplification) with a profile photo, follower count, and account status.`,
      source: "twitterapi.io",
      tone: "good",
    });
  }
  if (reclassified) {
    ctx.emit({
      phase: "P1 · Team",
      label: "Organizations separated from people",
      detail: `Moved ${reclassified} organization account${reclassified === 1 ? "" : "s"} out of the team roster and into related-organization evidence after checking the handle's own profile.`,
      source: "twitterapi.io",
      tone: "neutral",
    });
  }
}
