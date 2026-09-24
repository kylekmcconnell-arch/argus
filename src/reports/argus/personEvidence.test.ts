import { expect, it } from "vitest";
import { personRecords, personRecordSummary } from "./personEvidence";
it("does not attribute another account's allegation through a name co-mention", () => {
  const records = personRecords({ name: "Ada Example", handle: "@ada", leads: [{ claim: "Ada Example discussed this complaint", polarity: -1, finding_scope: { target_entity_key: "@other" } }] });
  expect(records).toEqual([]);
});
it("a name-only match remains a neutral discovery lead", () => {
  const records = personRecords({ name: "Ada Example", handle: "@ada", adverseMentions: [{ text: "Complaint about Ada Example" }] });
  expect(records[0]).toMatchObject({ identityMatch: "name", tone: "neutral" });
  expect(records[0].detail).toContain("identity remains unresolved");
  expect(personRecordSummary(records)?.label).not.toContain("adverse");
});
it("an exact target can surface an attributed unverified concern", () => {
  const records = personRecords({ name: "Ada Example", handle: "@ada", leads: [{ claim: "Unproven allegation", polarity: -1, finding_scope: { target_entity_key: "@ada" } }] });
  expect(records[0]).toMatchObject({ identityMatch: "account", tone: "amber" });
  expect(personRecordSummary(records)?.label).toBe("1 unverified concern to review");
});
