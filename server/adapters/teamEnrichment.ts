// A face, follower count, and account status only for a team member whose
// handle the SUBJECT ITSELF bound — its own posts, following edge, or
// amplification edge. Everyone else (team page, site search, model leads)
// stays bare. See `WebTeamMember.handleProvenance` in ../../src/data/evidence
// for why this gate is a durable marker and not the general evidence-origin
// field, which a separate path can flatten for the whole roster.

import type { CollectContext } from "./types";
import type { WebTeamMember } from "../../src/data/evidence";
import { getProfile } from "./x";
import { fetchTrustedProfileImage } from "./profilePhoto";

const MAX_ENRICHED_MEMBERS = 15;

async function enrichOne(member: WebTeamMember): Promise<boolean> {
  const profile = await getProfile(member.handle!);
  if (!profile) return false;
  member.accountStatus = profile.accountStatus;
  member.followers = profile.followers;
  member.enrichmentProvider = "twitterapi";
  member.enrichmentSourceUrl = profile.statusSourceUrl;
  if (!profile.image) return true;
  const image = await fetchTrustedProfileImage(profile.image);
  if (!image) return true;
  member.avatarUrl = image.url;
  member.avatarContentHash = image.contentHash;
  member.avatarCapturedAt = profile.statusCapturedAt;
  return true;
}

export async function enrichFirstPartyTeamAvatars(ctx: CollectContext): Promise<void> {
  const webTeam = ctx.evidence.webTeam ?? [];
  const targets = webTeam
    .filter((member) => member.handle && member.handleProvenance === "subject_first_party" && !member.avatarUrl)
    .slice(0, MAX_ENRICHED_MEMBERS);
  if (!targets.length) return;

  let enriched = 0;
  for (const member of targets) {
    // A failed lookup for one person must never fail the run or drop the
    // person from the roster; it just leaves them bare.
    try {
      if (await enrichOne(member)) enriched++;
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
}
