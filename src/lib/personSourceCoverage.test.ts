import { expect, it } from "vitest";
import { personSourceCoverage } from "./personSourceCoverage";
const member = { name: "Ada", role: "Founder", source: "team-page" };
it("never treats a retained LinkedIn link as a successful profile read", () => {
  const row = personSourceCoverage(member, { linkedin: "https://linkedin.com/in/ada" })[1];
  expect(row.access).toBe("Link recorded; read status unknown");
  expect(row.capturedAt).toBeUndefined();
});
it("keeps provider failure distinct from a searched empty result", () => {
  const row = personSourceCoverage({ ...member, sourceReceipts: [{ platform: "x", url: "https://x.com/ada", status: "failed", capturedAt: "2026-09-24", scope: "No history", provider: "twitterapi" }] }, { x: "https://x.com/ada" })[0];
  expect(row.access).toBe("Provider unavailable");
});
it("cannot transfer a read receipt between namesake profiles", () => {
  const rows = personSourceCoverage({ ...member, sourceReceipts: [{ platform: "linkedin", url: "https://linkedin.com/in/other", status: "read", capturedAt: "2026-09-24", scope: "Profile", provider: "test" }] }, { linkedin: "https://linkedin.com/in/ada" });
  expect(rows[1].access).toBe("Link recorded; read status unknown");
});
