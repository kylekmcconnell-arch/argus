import { describe, expect, it } from "vitest";
import { trustedOfficialXAvatarUrl } from "./avatars";

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
