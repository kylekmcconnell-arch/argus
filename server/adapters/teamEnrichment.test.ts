import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyEvidence, type WebTeamMember } from "../../src/data/evidence";
import type { CollectContext } from "./types";

const getProfileMock = vi.fn();
const fetchTrustedProfileImageMock = vi.fn();

vi.mock("./x", () => ({ getProfile: (...args: unknown[]) => getProfileMock(...args) }));
vi.mock("./profilePhoto", () => ({ fetchTrustedProfileImage: (...args: unknown[]) => fetchTrustedProfileImageMock(...args) }));

const { enrichFirstPartyTeamAvatars, teamProfileEntityType } = await import("./teamEnrichment");

function member(overrides: Partial<WebTeamMember>): WebTeamMember {
  return { name: "Test Person", role: "Founder", source: "post role-scan", ...overrides };
}

function context(webTeam: WebTeamMember[]): CollectContext {
  const evidence = emptyEvidence("@subject");
  evidence.webTeam = webTeam;
  return { handle: "@subject", evidence, emit: vi.fn() };
}

describe("first-party team avatar enrichment", () => {
  afterEach(() => {
    getProfileMock.mockReset();
    fetchTrustedProfileImageMock.mockReset();
  });

  it("enriches only the member whose handle the subject account itself bound", async () => {
    getProfileMock.mockResolvedValueOnce({
      handle: "@proph3ttt",
      accountStatus: "active",
      statusSourceUrl: "https://x.com/proph3ttt",
      statusCapturedAt: "2026-08-18T00:00:00.000Z",
      followers: 4200,
      image: "https://pbs.twimg.com/profile_images/1/avatar_400x400.jpg",
    });
    fetchTrustedProfileImageMock.mockResolvedValueOnce({
      bytes: Buffer.from("fake"),
      mediaType: "image/jpeg",
      url: "https://pbs.twimg.com/profile_images/1/avatar_400x400.jpg",
      contentHash: "deadbeef",
    });

    const firstParty = member({ name: "Prophett", handle: "@proph3ttt", handleProvenance: "subject_first_party" });
    const searchLead = member({ name: "Web Lead", handle: "@someone", source: "Web identity search" });
    const ctx = context([firstParty, searchLead]);

    await enrichFirstPartyTeamAvatars(ctx);

    expect(getProfileMock).toHaveBeenCalledTimes(1);
    expect(getProfileMock).toHaveBeenCalledWith("@proph3ttt");
    expect(firstParty.followers).toBe(4200);
    expect(firstParty.accountStatus).toBe("active");
    expect(firstParty.avatarUrl).toBe("https://pbs.twimg.com/profile_images/1/avatar_400x400.jpg");
    expect(firstParty.avatarContentHash).toBe("deadbeef");
    expect(firstParty.avatarCapturedAt).toBe("2026-08-18T00:00:00.000Z");
    expect(firstParty.enrichmentProvider).toBe("twitterapi");
    expect(firstParty.enrichmentSourceUrl).toBe("https://x.com/proph3ttt");

    // The search-discovered lead never even reaches the profile lookup.
    expect(searchLead.avatarUrl).toBeUndefined();
    expect(searchLead.followers).toBeUndefined();
  });

  it("leaves a member bare on a failed lookup instead of failing the whole run", async () => {
    getProfileMock
      .mockRejectedValueOnce(new Error("provider outage"))
      .mockResolvedValueOnce({
        handle: "@second",
        accountStatus: "active",
        statusSourceUrl: "https://x.com/second",
        statusCapturedAt: "2026-08-18T00:00:00.000Z",
        followers: 10,
      });

    const first = member({ name: "First", handle: "@first", handleProvenance: "subject_first_party" });
    const second = member({ name: "Second", handle: "@second", handleProvenance: "subject_first_party" });
    const ctx = context([first, second]);

    await expect(enrichFirstPartyTeamAvatars(ctx)).resolves.toBeUndefined();

    expect(first.avatarUrl).toBeUndefined();
    expect(first.followers).toBeUndefined();
    expect(second.followers).toBe(10);
  });

  it("never calls the profile provider for a member without the first-party marker", async () => {
    const searchLead = member({ name: "Web Lead", handle: "@someone" });
    const ctx = context([searchLead]);

    await enrichFirstPartyTeamAvatars(ctx);

    expect(getProfileMock).not.toHaveBeenCalled();
  });

  it("records account status and followers even when the profile carries no image", async () => {
    getProfileMock.mockResolvedValueOnce({
      handle: "@noavatar",
      accountStatus: "active",
      statusSourceUrl: "https://x.com/noavatar",
      statusCapturedAt: "2026-08-18T00:00:00.000Z",
      followers: 55,
    });

    const firstParty = member({ name: "No Avatar", handle: "@noavatar", handleProvenance: "subject_first_party" });
    const ctx = context([firstParty]);

    await enrichFirstPartyTeamAvatars(ctx);

    expect(firstParty.followers).toBe(55);
    expect(firstParty.accountStatus).toBe("active");
    expect(firstParty.avatarUrl).toBeUndefined();
    expect(fetchTrustedProfileImageMock).not.toHaveBeenCalled();
  });

  it("reclassifies Women of Satoshi as an organization and keeps it out of team evidence", async () => {
    getProfileMock.mockResolvedValueOnce({
      handle: "@womenofsatoshi",
      name: "Women of Satoshi",
      bio: "An NFT project and community celebrating women building on Bitcoin.",
      accountStatus: "active",
      statusSourceUrl: "https://x.com/womenofsatoshi",
      statusCapturedAt: "2026-08-27T00:00:00.000Z",
      image: "https://pbs.twimg.com/profile_images/wos/avatar.jpg",
    });
    const falseFounder = member({
      name: "@womenofsatoshi",
      handle: "@womenofsatoshi",
      role: "Founder",
      evidence: 'the official account placed the role "founder" next to @womenofsatoshi',
      sourceUrl: "https://x.com/fedibtc",
      handleProvenance: "subject_first_party",
      evidence_origin: "deterministic",
      artifact_verified: true,
    });
    const ctx = context([falseFounder]);

    await enrichFirstPartyTeamAvatars(ctx);

    expect(teamProfileEntityType({ name: "Women of Satoshi", bio: "An NFT project and community." })).toBe("organization");
    expect(falseFounder).toMatchObject({
      kind: "org",
      name: "Women of Satoshi",
      role: "related organization",
    });
    expect(falseFounder.avatarUrl).toBeUndefined();
    expect(ctx.evidence.associates).toContainEqual(expect.objectContaining({
      associate_handle: "@womenofsatoshi",
      relation: "official-post mention",
    }));
  });
});
