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

    expect(captured.result?.status).toBe("unavailable");
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

    expect(captured.result?.status).toBe("client_rendered");
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
      result: await archivedAffiliation("example.org", "Kyle McConnell", "Example"),
      cost: getCost(),
    }));

    expect(captured.result).toMatchObject({ year: "2020", where: "team" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(captured.cost.calls).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: "wayback", op: "cdx-search", calls: 1, succeeded: 1, failed: 0 }),
      expect.objectContaining({ provider: "wayback", op: "snapshot-fetch", calls: 1, succeeded: 1, failed: 0, meta: "subject_and_venture_match" }),
    ]));
  });

  it("matches a roster whose name is split across markup tags", async () => {
    const rows = [
      ["urlkey", "timestamp", "original", "mimetype", "statuscode", "digest", "length"],
      ["org,example)/team", "20200102030405", "https://example.org/team", "text/html", "200", "abc", "100"],
    ];
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(JSON.stringify(rows), 200, "application/json"))
      .mockResolvedValueOnce(response("<div><span>Kyle</span>\n<span>McConnell</span> leads <b>Example</b> Labs</div>"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await withCostLedger(() => archivedAffiliation("example.org", "Kyle McConnell", "Example"));
    expect(result).toMatchObject({ year: "2020", where: "team" });
  });

  it("does NOT match a subject name embedded inside longer words", async () => {
    // "ed chen" must never match inside "watched chennai": needles are whole
    // words on stripped text, not raw substrings of the HTML.
    const teamRows = [
      ["urlkey", "timestamp", "original", "mimetype", "statuscode", "digest", "length"],
      ["org,example)/team", "20200102030405", "https://example.org/team", "text/html", "200", "abc", "100"],
    ];
    const emptyRows = [["urlkey", "timestamp", "original", "mimetype", "statuscode", "digest", "length"]];
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(JSON.stringify(teamRows), 200, "application/json"))
      .mockResolvedValueOnce(response("We watched chennai adoption grow. Example is expanding."))
      .mockResolvedValueOnce(response(JSON.stringify(emptyRows), 200, "application/json"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await withCostLedger(() => archivedAffiliation("example.org", "Ed Chen", "Example"));
    expect(result).toBeNull();
  });

  it("does NOT match when the archived page names the subject but not the venture", async () => {
    // The core forensic guard: a subject-name substring on a page that is not the
    // venture's own (wrong/misguessed domain, a coincidental mention) must not
    // corroborate — the venture identity has to be present too.
    const teamRows = [
      ["urlkey", "timestamp", "original", "mimetype", "statuscode", "digest", "length"],
      ["org,example)/team", "20200102030405", "https://example.org/team", "text/html", "200", "abc", "100"],
    ];
    const emptyRows = [["urlkey", "timestamp", "original", "mimetype", "statuscode", "digest", "length"]];
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(JSON.stringify(teamRows), 200, "application/json")) // cdx /team
      .mockResolvedValueOnce(response("Kyle McConnell recently joined an unrelated startup.")) // page: subject, no venture/root
      .mockResolvedValueOnce(response(JSON.stringify(emptyRows), 200, "application/json")); // cdx /about: no snapshot
    vi.stubGlobal("fetch", fetchMock);

    const result = await withCostLedger(() => archivedAffiliation("example.org", "Kyle McConnell", "Example"));
    expect(result).toBeNull();
  });
});
