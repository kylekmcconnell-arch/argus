import { expect, it } from "vitest";
import type { BasicFact } from "../data/evidence";
import { personFactBindsAccount } from "./personFactBinding";
const fact = { subjectKey: "x:public_alias", sources: [{ artifactVerified: true, sourceClass: "independent_press", url: "https://example.com", excerpt: "@public_alias built the protocol." }] } as BasicFact;
it("allows a pseudonymous public track record through exact-account evidence", () => {
  expect(personFactBindsAccount(fact, { handle: "@public_alias" })).toBe(true);
});
it("rejects a name-only claim and a longer namesake handle", () => {
  expect(personFactBindsAccount({ ...fact, sources: [{ ...fact.sources[0], excerpt: "Public Alias built it." }] }, { handle: "@public_alias" })).toBe(false);
  expect(personFactBindsAccount({ ...fact, sources: [{ ...fact.sources[0], excerpt: "@public_alias_impostor built it." }] }, { handle: "@public_alias" })).toBe(false);
});
