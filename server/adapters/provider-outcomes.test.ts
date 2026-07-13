import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { structured } = vi.hoisted(() => ({ structured: vi.fn() }));
vi.mock("../agent", () => ({ structured }));

import { getCost, withCostLedger } from "../cost";
import { checkSiteSubstance } from "./sitecheck";
import { fetchTeamPage } from "./teampage";
import { resolveName } from "./wallet";
import { archivedAffiliation } from "./wayback";

const response = (body: string | null, status = 200, contentType = "text/html") => new Response(body, {
  status,
  headers: { "content-type": contentType },
});

describe("keyless adapter attempt accounting", () => {
  beforeEach(() => structured.mockReset());

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("records each site fallback after its observed HTTP or content outcome", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response("unavailable", 503))
      .mockResolvedValueOnce(response("{}", 200, "application/json"));
    vi.stubGlobal("fetch", fetchMock);

    const captured = await withCostLedger(async () => ({
      result: await checkSiteSubstance("example.org"),
      cost: getCost(),
    }));

    expect(captured.result?.status).toBe("unreachable");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(captured.cost.calls).toContainEqual(expect.objectContaining({
      provider: "site-fetch",
      op: "substance",
      calls: 2,
      succeeded: 0,
      partial: 1,
      failed: 1,
      status: "partial",
      meta: expect.stringContaining("http_503"),
    }));
  });

  it("counts the homepage and client bundle exactly once each", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response('<div id="root"></div><script type="module" src="/app.js"></script>'))
      .mockResolvedValueOnce(response('const route = "ComingSoonApp";', 200, "application/javascript"));
    vi.stubGlobal("fetch", fetchMock);

    const captured = await withCostLedger(async () => ({
      result: await checkSiteSubstance("example.org"),
      cost: getCost(),
    }));

    expect(captured.result?.status).toBe("coming_soon");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(captured.cost.calls).toContainEqual(expect.objectContaining({
      provider: "site-fetch", op: "substance", calls: 2, succeeded: 2, partial: 0, failed: 0,
    }));
  });

  it("records all team-page fetches with one success and the observed failures", async () => {
    const roster = `Founder Alice Example leads engineering and the core team. ${"Product protocol leadership. ".repeat(20)}`;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => (
      String(input) === "https://example.org/team"
        ? response(roster, 200, "text/plain")
        : response("missing", 404)
    )));
    structured.mockResolvedValue({
      people: [{ name: "Alice Example", role: "Founder", source_url: "https://example.org/team" }],
    });

    const captured = await withCostLedger(async () => ({
      result: await fetchTeamPage("example.org", "Example"),
      cost: getCost(),
    }));

    expect(captured.result).toContainEqual(expect.objectContaining({ name: "Alice Example", role: "Founder" }));
    expect(captured.cost.calls).toContainEqual(expect.objectContaining({
      provider: "site-fetch",
      op: "team-page",
      calls: 48,
      succeeded: 1,
      partial: 0,
      failed: 47,
      status: "partial",
    }));
  });

  it("records wallet transport and JSON failures once per physical resolver call", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(response("not-json", 200, "application/json"));
    vi.stubGlobal("fetch", fetchMock);

    const captured = await withCostLedger(async () => ({
      result: await resolveName("alice.eth"),
      cost: getCost(),
    }));

    expect(captured.result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(captured.cost.calls).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: "wallet-resolve", op: "api.web3.bio", calls: 1, failed: 1, meta: "transport_error" }),
      expect.objectContaining({ provider: "wallet-resolve", op: "api.ensideas.com", calls: 1, failed: 1, meta: "response_json_error" }),
    ]));
  });

  it("records Wayback index and snapshot outcomes without pre-counting", async () => {
    const rows = [
      ["urlkey", "timestamp", "original", "mimetype", "statuscode", "digest", "length"],
      ["org,example)/team", "20200102030405", "https://example.org/team", "text/html", "200", "abc", "100"],
    ];
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(JSON.stringify(rows), 200, "application/json"))
      .mockResolvedValueOnce(response("Kyle McConnell is the Founder of Example."));
    vi.stubGlobal("fetch", fetchMock);

    const captured = await withCostLedger(async () => ({
      result: await archivedAffiliation("example.org", "Kyle McConnell"),
      cost: getCost(),
    }));

    expect(captured.result).toMatchObject({ year: "2020", where: "team" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(captured.cost.calls).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: "wayback", op: "cdx-search", calls: 1, succeeded: 1, failed: 0 }),
      expect.objectContaining({ provider: "wayback", op: "snapshot-fetch", calls: 1, succeeded: 1, failed: 0, meta: "name_match" }),
    ]));
  });
});
