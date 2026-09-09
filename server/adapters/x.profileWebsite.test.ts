import { describe, expect, it } from "vitest";
import { pickProfileWebsite } from "./x";

describe("profile website selection from the twitterapi record", () => {
  it("skips a leading shared-host link and takes the first credible first-party domain", () => {
    expect(pickProfileWebsite(["https://t.me/foo", "https://foo.trade", "https://youtube.com/@foo"]))
      .toBe("https://foo.trade");
  });

  it("keeps the website field first when it is already a credible domain", () => {
    expect(pickProfileWebsite(["https://clutch.markets/", "https://stonkbrokers.cash/"]))
      .toBe("https://clutch.markets/");
  });

  it("falls back to the first URL when no credible domain exists, so link-hub dereference still runs", () => {
    expect(pickProfileWebsite(["https://linktr.ee/foo", "https://t.me/foo"])).toBe("https://linktr.ee/foo");
    expect(pickProfileWebsite([])).toBeUndefined();
  });
});
