import { describe, expect, it } from "vitest";
import { trustedOfficialTeamPortraitUrl, trustedOfficialXAvatarUrl } from "./avatars";

describe("trustedOfficialXAvatarUrl", () => {
  it("accepts official X CDN hosts and rejects everything else", () => {
    expect(trustedOfficialXAvatarUrl("https://pbs.twimg.com/profile_images/1/photo.jpg")).toBe(
      "https://pbs.twimg.com/profile_images/1/photo.jpg",
    );
    expect(trustedOfficialXAvatarUrl("https://abs.twimg.com/sticky/default_profile.png")).toContain("abs.twimg.com");
    expect(trustedOfficialXAvatarUrl("https://unavatar.io/x/alice")).toBeNull();
    expect(trustedOfficialXAvatarUrl("http://pbs.twimg.com/profile_images/1/photo.jpg")).toBeNull();
    expect(trustedOfficialXAvatarUrl("https://evil.example/pbs.twimg.com/x.jpg")).toBeNull();
  });
});

describe("trustedOfficialTeamPortraitUrl", () => {
  it("accepts an HTTPS portrait only when its first-party source page is frozen with it", () => {
    expect(trustedOfficialTeamPortraitUrl(
      "https://cdn.prod.website-files.com/anyone/advisor-1.png",
      "https://www.anyone.io/about-us",
    )).toBe("https://cdn.prod.website-files.com/anyone/advisor-1.png");
    expect(trustedOfficialTeamPortraitUrl(
      "https://cdn.prod.website-files.com/anyone/advisor-1.png",
      null,
    )).toBeNull();
  });

  it("rejects local, credentialed, non-HTTPS, and non-image targets", () => {
    const source = "https://www.anyone.io/about-us";
    expect(trustedOfficialTeamPortraitUrl("http://cdn.example.org/person.png", source)).toBeNull();
    expect(trustedOfficialTeamPortraitUrl("https://127.0.0.1/person.png", source)).toBeNull();
    expect(trustedOfficialTeamPortraitUrl("https://user:pass@cdn.example.org/person.png", source)).toBeNull();
    expect(trustedOfficialTeamPortraitUrl("https://cdn.example.org/person.svg", source)).toBeNull();
  });
});
