import { expect, it, vi } from "vitest";
import { collectLinkedTeamEvidence } from "./linkedTeamEvidence";
import type { WebTeamMember } from "../src/data/evidence";
const member: WebTeamMember = { name: "Ada", handle: "ada", role: "Founder", source: "post", handleProvenance: "subject_first_party" };
const version = "00000000-0000-4000-8000-000000000123";
it("does not read cross-workspace or name-only evidence", async () => {
  const fetcher = vi.fn();
  await collectLinkedTeamEvidence(undefined, [member], { fetch: fetcher, url: "https://db.test", key: "key" });
  await collectLinkedTeamEvidence("org", [{ ...member, handleProvenance: undefined }], { fetch: fetcher, url: "https://db.test", key: "key" });
  expect(fetcher).not.toHaveBeenCalled();
});
it("scopes both reads to the organization and re-derives facts from exact person versions", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify([{ identity_key: "x:ada", payload: { linkedReport: { reportVersionId: version, investigation: { note: "untrusted cached projection" } } } }]))).mockResolvedValueOnce(new Response(JSON.stringify([{ id: version, created_at: "2026-09-25", payload: { handle: "ada", display_name: "Ada", bio: "Founder", identity_binding: "independent_exact_handle", basicFacts: [], report: { roles: ["FOUNDER"] } } }])));
  const result = await collectLinkedTeamEvidence("org-a", [member], { fetch: fetcher, url: "https://db.test", key: "key" });
  expect(result.people).toHaveLength(1);
  expect(result.people[0].investigation.note).not.toContain("untrusted");
  for (const call of fetcher.mock.calls) { expect(new URL(call[0]).searchParams.get("organization_id")).toBe("eq.org-a"); expect(call[1].redirect).toBe("error"); }
});
it("reports a storage outage as unavailable, not an empty successful history", async () => {
  const result = await collectLinkedTeamEvidence("org", [member], { fetch: vi.fn().mockResolvedValue(new Response("", { status: 503 })), url: "https://db.test", key: "key" });
  expect(result.status).toBe("unavailable");
});
