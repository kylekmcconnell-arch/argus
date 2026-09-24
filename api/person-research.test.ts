import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), load: vi.fn(), budget: vi.fn(), collect: vi.fn(), cost: vi.fn() }));
vi.mock("./_auth.js", () => ({ requireArgusAuth: mocks.auth, serviceCredentials: () => ({ url: "https://db.test", key: "key" }), serviceHeaders: () => ({}), reserveSupplementalBudget: mocks.budget, rejectSupplementalReservation: () => true }));
vi.mock("./report.js", () => ({ loadExactVersionReport: mocks.load }));
vi.mock("./_cache.js", () => ({ recordProviderUsageBatch: mocks.cost }));
vi.mock("../server/personResearch.js", () => ({ collectPersonResearch: mocks.collect }));
import handler, { savedPersonContext } from "./person-research";
const version = "00000000-0000-4000-8000-000000000123";
const auth = { organizationId: "org-a", userId: "user-a" };
function response() { const r = { status: vi.fn(), json: vi.fn(), setHeader: vi.fn(), end: vi.fn() }; r.status.mockReturnValue(r); return r; }
beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue(auth); mocks.load.mockResolvedValue({ report: { payload: { display_name: "Example", webTeam: [{ name: "Ada", role: "Founder" }] } } }); vi.stubEnv("SERPER_API_KEY", "key"); });
it("loads the exact version in the authenticated organization before research", async () => {
  mocks.load.mockResolvedValue(null); const res = response();
  await handler({ method: "POST", body: { reportVersionId: version, name: "Ada", role: "Founder" } } as never, res as never);
  expect(mocks.load.mock.calls[0].slice(1)).toEqual(["org-a", version]);
  expect(res.status).toHaveBeenCalledWith(404); expect(mocks.collect).not.toHaveBeenCalled();
});
it("rejects ambiguous saved members before charging or searching", async () => {
  mocks.load.mockResolvedValue({ report: { payload: { webTeam: [{ name: "Ada", role: "Founder" }, { name: "Ada", role: "Founder" }] } } });
  await handler({ method: "POST", body: { reportVersionId: version, name: "Ada", role: "Founder" } } as never, response() as never);
  expect(mocks.budget).not.toHaveBeenCalled(); expect(mocks.collect).not.toHaveBeenCalled();
});
it("saved reads never call providers and scope storage to organization and version", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response('[]')); vi.stubGlobal("fetch", fetcher);
  await handler({ method: "GET", query: { reportVersionId: version, name: "Ada", role: "Founder" } } as never, response() as never);
  const url = new URL(fetcher.mock.calls[0][0]);
  expect(url.searchParams.get("organization_id")).toBe("eq.org-a");
  expect(url.searchParams.get("report_version_id")).toBe(`eq.${version}`);
  expect(mocks.collect).not.toHaveBeenCalled(); expect(mocks.budget).not.toHaveBeenCalled();
});
it("duplicate run IDs cannot trigger another paid collection", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('', { status: 409 })));
  const res = response();
  await handler({ method: "POST", body: { reportVersionId: version, name: "Ada", role: "Founder", runId: version } } as never, res as never);
  expect(res.status).toHaveBeenCalledWith(409); expect(mocks.collect).not.toHaveBeenCalled();
});
it("successful research is separately persisted and metered against the source version", async () => {
  const fetcher = vi.fn().mockImplementation(async () => new Response('', { status: 201 })); vi.stubGlobal("fetch", fetcher);
  mocks.budget.mockResolvedValue({ allowed: true });
  mocks.collect.mockResolvedValue({ searches: [{ status: "searched" }], sources: [], name: "Ada" });
  const res = response();
  await handler({ method: "POST", body: { reportVersionId: version, name: "Ada", role: "Founder", runId: version } } as never, res as never);
  expect(mocks.collect.mock.calls[0][0]).toEqual({ name: "Ada", role: "Founder" });
  expect(mocks.cost.mock.calls[0].slice(0,3)).toEqual(["org-a", version, "user-a"]);
  const completion = JSON.parse(fetcher.mock.calls[1][1].body);
  expect(completion.status).toBe("complete");
  expect(fetcher.mock.calls.every(call => !String(call[0]).includes('/report_versions'))).toBe(true);
});

it("resolves people inside frozen project facets without using the token name as company context", () => {
  const projectAccount = { display_name: "Actual Company", webTeam: [{ name: "Ada", role: "Founder" }] };
  expect(savedPersonContext({ display_name: "Token", projectAccount }, "Ada", "Founder")?.company).toBe("Actual Company");
  expect(savedPersonContext({ token: { projectAccount } }, "Ada", "Founder")?.company).toBe("Actual Company");
  expect(savedPersonContext({ ...projectAccount, projectAccount }, "Ada", "Founder")).toBeNull();
});
