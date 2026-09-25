import { expect, it } from "vitest";
import { linkedPersonEvidence } from "./linkedPersonEvidence";
import { buildPersonInvestigation } from "./personInvestigation";
import type { Dossier } from "../data/dossier";
import type { WebTeamMember } from "../data/evidence";
const member: WebTeamMember = { name: "Ada", handle: "ada", role: "Founder", source: "post", handleProvenance: "subject_first_party" };
const person = { handle: "ada", display_name: "Ada", bio: "Builder", identity_binding: "independent_exact_handle", report: { roles: ["FOUNDER"] }, basicFacts: [] } as unknown as Dossier;
it("requires exact first-party account binding, not display name", () => {
  expect(linkedPersonEvidence({ ...member, handleProvenance: undefined }, person, "v", "2026-09-25")).toBeNull();
  expect(linkedPersonEvidence(member, { ...person, handle: "namesake" }, "v", "2026-09-25")).toBeNull();
  expect(linkedPersonEvidence(member, person, "v", "2026-09-25")?.reportVersionId).toBe("v");
});
it("does not attach organization reports or copy a supplied investigation object", () => {
  expect(linkedPersonEvidence(member, { ...person, bio: undefined } as unknown as Dossier, "v", "date")).toBeNull();
  expect(linkedPersonEvidence(member, { ...person, report: { ...person.report, roles: ["PROJECT" as never] } }, "v", "date")).toBeNull();
  const attached = linkedPersonEvidence(member, { ...person, personInvestigation: { ...buildPersonInvestigation(person, []), note: "injected claim" } }, "v", "date");
  expect(attached?.investigation.note).not.toContain("injected");
});
