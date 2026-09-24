import { expect, it } from "vitest";
import { personResearchIdentity } from "./personResearch";
it("never joins names or candidate handles across reports", () => {
  expect(personResearchIdentity({ handle: "@ada" })).toBeNull();
  expect(personResearchIdentity({})).toBeNull();
  expect(personResearchIdentity({ handle: "@Ada", handleProvenance: "subject_first_party" })).toBe("x:ada");
});
