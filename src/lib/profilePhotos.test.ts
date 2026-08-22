import { describe, expect, it } from "vitest";
import { profilePhotoForName } from "./profilePhotos";

describe("profilePhotoForName", () => {
  it("maps only the approved public identities", () => {
    expect(profilePhotoForName("Kyle")).toBe("/referral-avatars/kyle.png");
    expect(profilePhotoForName("Kyle McConnell")).toBe("/referral-avatars/kyle.png");
    expect(profilePhotoForName("Enigma")).toBe("/referral-avatars/enigma.jpg");
    expect(profilePhotoForName("Another Kyle")).toBeNull();
    expect(profilePhotoForName("Enigma Labs")).toBeNull();
  });
});
