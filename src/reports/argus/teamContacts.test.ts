import { expect, it } from "vitest";
import { personContacts, linkedinSlug, xHandleUrl } from "./model";
import { personRecords } from "./personEvidence";

it("retains recorded profile URLs and canonicalizes X links", () => {
  const contacts = personContacts({ name: "Ada Lovelace", handle: "https://twitter.com/ada_codes/", linkedin: "www.linkedin.com/in/ada-lovelace/", telegram: "@ada_codes" });
  expect(contacts.x).toEqual({ label: "@ada_codes", url: "https://x.com/ada_codes" });
  expect(contacts.linkedin?.url).toBe("https://www.linkedin.com/in/ada-lovelace/");
  expect(contacts.telegram?.url).toBe("https://t.me/ada_codes");
});
it("keeps first-party X bindings while withholding guessed handles", () => {
  const member = { name: "Ada Lovelace", handle: "@ada_codes", identity_link_evidence_origin: "model_lead" as const };
  expect(personContacts(member).x).toBeNull();
  expect(personContacts({ ...member, handleProvenance: "subject_first_party" }).x?.label).toBe("@ada_codes");
});
it("rejects deceptive domains, company pages and malformed profiles", () => {
  for (const url of ["https://evil.com/linkedin.com/in/ada-lovelace", "https://linkedin.com.evil.com/in/ada", "https://linkedin.com/company/ada", "https://linkedin.com/in/%ZZ"]) {
    expect(linkedinSlug(url)).toBeNull();
    expect(personContacts({ name: "Ada Lovelace", linkedin: url }).linkedin).toBeNull();
  }
  expect(xHandleUrl("https://x.com/ada_codes/status/123")).toBeNull();
  expect(xHandleUrl("https://x.com.evil.com/ada_codes")).toBeNull();
});
it("preserves directly attached prior projects without asserting their outcomes", () => {
  const records = personRecords({ name: "Ada", priorProjects: [{ name: "Earlier Company", role: "cofounder" }], priorProjectsSource: "https://example.com/team" });
  expect(records[0]).toMatchObject({ kind: "affiliation", label: "Reported prior project", url: "https://example.com/team" });
  expect(records[0]?.detail).toContain("Earlier Company: cofounder");
  expect(records[0]?.detail).toContain("does not establish its outcome or common control");
});
