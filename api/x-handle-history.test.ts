import type { VercelRequest, VercelResponse } from "@vercel/node";
import { afterEach, describe, expect, it, vi } from "vitest";

import handler, { type HandleHistoryAccount } from "./x-handle-history";

type Body = Record<string, unknown> & { accounts?: HandleHistoryAccount[] };

function response() {
  const captured: { status?: number; body?: Body; headers: Record<string, string> } = { headers: {} };
  const res = {
    status(code: number) { captured.status = code; return this; },
    json(body: Body) { captured.body = body; return this; },
    setHeader(k: string, v: string) { captured.headers[k.toLowerCase()] = v; return this; },
  };
  return { res, captured };
}

// memory.lol shape: { accounts: [{ id, id_str, screen_names: { name: [dates] } }] }
function stubUpstream(payload: unknown, status = 200) {
  const fetchMock = vi.fn().mockImplementation((input: string | URL | Request) => {
    const url = String(input);
    if (!url.startsWith("https://api.memory.lol/v1/tw/")) {
      throw new Error(`unexpected upstream call: ${url}`);
    }
    if (status !== 200) return Promise.resolve(new Response("nope", { status }));
    return Promise.resolve(new Response(JSON.stringify(payload), {
      status: 200, headers: { "content-type": "application/json" },
    }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const json = (payload: unknown) => Promise.resolve(new Response(JSON.stringify(payload), {
  status: 200, headers: { "content-type": "application/json" },
}));

// The by-name route answers `{accounts:[...]}`; the by-id route answers with the
// one account bare. `byId` is keyed on the numeric id in the path.
function stubRoutes(opts: { byName?: unknown; byId?: Record<string, unknown>; resolveId?: unknown }) {
  const fetchMock = vi.fn().mockImplementation((input: string | URL | Request) => {
    const url = String(input);
    const id = url.match(/^https:\/\/api\.memory\.lol\/v1\/tw\/id\/(\d+)$/)?.[1];
    if (id) {
      const hit = opts.byId?.[id];
      return hit ? json(hit) : Promise.resolve(new Response("no", { status: 404 }));
    }
    if (url.startsWith("https://api.memory.lol/v1/tw/")) return json(opts.byName ?? { accounts: [] });
    if (url.startsWith("https://api.twitterapi.io/")) {
      return opts.resolveId ? json(opts.resolveId) : Promise.resolve(new Response("no", { status: 404 }));
    }
    throw new Error(`unexpected upstream call: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function run(query: Record<string, string>) {
  const { res, captured } = response();
  await handler({ query } as unknown as VercelRequest, res as unknown as VercelResponse);
  return captured;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("x-handle-history - prior screen names", () => {
  it("reports the prior handles of a renamed account", async () => {
    stubUpstream({ accounts: [{ id_str: "4242", screen_names: {
      oldgamblingbot: ["2019-03-01", "2025-11-04"],
      chequeapp: ["2026-01-12", "2026-09-01"],
    } }] });
    const c = await run({ handle: "chequeapp" });
    expect(c.status).toBe(200);
    expect(c.body?.status).toBe("renamed");
    expect(c.body?.priorHandles).toEqual(["oldgamblingbot"]);
    expect(c.body?.renameCount).toBe(1);
    expect(c.body?.currentSince).toBe("2026-01-12");
    // The last sighting of the OLD name bounds when the rename happened.
    expect(c.body?.lastRenameSeen).toBe("2025-11-04");
    expect(c.body?.note).toContain("@oldgamblingbot");
  });

  it("matches the current handle case-insensitively", async () => {
    stubUpstream({ accounts: [{ id_str: "7", screen_names: {
      priorname: ["2020-01-01"],
      ChequeApp: ["2026-02-02"],
    } }] });
    const c = await run({ handle: "chequeapp" });
    expect(c.body?.status).toBe("renamed");
    expect(c.body?.priorHandles).toEqual(["priorname"]);
    expect(c.body?.currentSince).toBe("2026-02-02");
  });

  it("strips a leading @ from the query", async () => {
    const fetchMock = stubUpstream({ accounts: [{ id_str: "9", screen_names: { solo: ["2021-01-01"] } }] });
    const c = await run({ handle: "@solo" });
    expect(c.status).toBe(200);
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.memory.lol/v1/tw/solo");
  });

  it("reports 'single' when the archive knows the account but no other name", async () => {
    stubUpstream({ accounts: [{ id_str: "11", screen_names: { onlyname: ["2018-06-01", "2026-09-01"] } }] });
    const c = await run({ handle: "onlyname" });
    expect(c.body?.status).toBe("single");
    expect(c.body?.priorHandles).toEqual([]);
    expect(c.body?.lastRenameSeen).toBeNull();
    // Absence of a recorded rename must never read as a clean bill.
    expect(c.body?.note).toMatch(/partial|weak evidence/i);
  });

  it("orders the timeline oldest first and tolerates undated sightings", async () => {
    stubUpstream({ accounts: [{ id_str: "12", screen_names: {
      newest: ["2026-01-01"],
      undated: null,
      oldest: ["2015-01-01"],
    } }] });
    const c = await run({ handle: "newest" });
    expect(c.body?.accounts?.[0].names.map((n) => n.handle)).toEqual(["oldest", "newest", "undated"]);
    expect(c.body?.accounts?.[0].names[2]).toMatchObject({ handle: "undated", firstSeen: null, lastSeen: null });
  });
});

describe("x-handle-history - handle reuse across accounts", () => {
  it("flags a screen name that has been worn by more than one account id", async () => {
    stubUpstream({ accounts: [
      { id_str: "100", screen_names: { chequeapp: ["2014-01-01", "2019-01-01"] } },
      { id_str: "200", screen_names: { somethingelse: ["2020-01-01"], chequeapp: ["2026-01-01"] } },
    ] });
    const c = await run({ handle: "chequeapp" });
    expect(c.body?.handleReused).toBe(true);
    expect(c.body?.accountCount).toBe(2);
    expect(c.body?.note).toContain("changed hands");
  });
});

// The archive is keyed by account id, and its by-name route only answers for
// names it has already seen. A rename newer than the archive's last sighting is
// therefore invisible by name and complete by id - the case this fallback is for.
describe("x-handle-history - falls back to the account id", () => {
  const record = {
    id_str: "1234567890",
    screen_names: { oldgamblingbot: ["2019-03-01", "2026-06-20"], secondname: ["2026-06-21", "2026-07-02"] },
  };

  it("finds the history by id when the current name is too new to be indexed", async () => {
    const fetchMock = stubRoutes({ byName: { accounts: [] }, byId: { "1234567890": record } });
    const c = await run({ handle: "shlok_dm", id: "1234567890" });
    expect(c.status).toBe(200);
    expect(c.body?.status).toBe("renamed");
    expect(c.body?.resolvedBy).toBe("id");
    expect(c.body?.priorHandles).toEqual(["oldgamblingbot", "secondname"]);
    expect(c.body?.currentNameInArchive).toBe(false);
    expect(c.body?.lastRenameSeen).toBe("2026-07-02");
    // The sharper claim: not merely "was renamed" but "renamed after the
    // archive last looked", which is what makes it fresh.
    expect(c.body?.note).toContain("no sighting of it as @shlok_dm");
    expect(c.body?.note).toContain("more recent than that");
    expect(String(fetchMock.mock.calls[1][0])).toBe("https://api.memory.lol/v1/tw/id/1234567890");
  });

  it("does not spend the id lookup when the name lookup already answered", async () => {
    const fetchMock = stubRoutes({
      byName: { accounts: [{ id_str: "1234567890", screen_names: { prior: ["2020-01-01"], known: ["2026-01-01"] } }] },
      byId: { "1234567890": record },
    });
    const c = await run({ handle: "known", id: "1234567890" });
    expect(c.body?.resolvedBy).toBe("handle");
    expect(c.body?.currentNameInArchive).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("resolves the id from a keyed provider when the caller has none", async () => {
    process.env.TWITTERAPI_KEY = "test-key";
    try {
      stubRoutes({
        byName: { accounts: [] },
        byId: { "555": record },
        resolveId: { data: { id: "555" } },
      });
      const c = await run({ handle: "renamedlast_month" });
      expect(c.body?.resolvedBy).toBe("id");
      expect(c.body?.priorHandles).toEqual(["oldgamblingbot", "secondname"]);
    } finally { delete process.env.TWITTERAPI_KEY; }
  });

  it("stays keyless and unchanged when no id is available", async () => {
    const fetchMock = stubRoutes({ byName: { accounts: [] } });
    const c = await run({ handle: "nevertracked" });
    expect(c.body?.status).toBe("unknown");
    expect(c.body?.resolvedBy).toBeNull();
    expect(c.body?.note).toMatch(/not a clean bill/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("ignores an id that is not a numeric account id", async () => {
    const fetchMock = stubRoutes({ byName: { accounts: [] } });
    const c = await run({ handle: "someone", id: "../../etc/passwd" });
    expect(c.body?.status).toBe("unknown");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports 'single' when the id route knows only the current name", async () => {
    stubRoutes({
      byName: { accounts: [] },
      byId: { "77": { id_str: "77", screen_names: { onlyname: ["2018-06-01"] } } },
    });
    const c = await run({ handle: "onlyname", id: "77" });
    expect(c.body?.status).toBe("single");
    expect(c.body?.currentNameInArchive).toBe(true);
    expect(c.body?.note).toMatch(/partial|weak evidence/i);
  });
});

describe("x-handle-history - absence and failure are not clean bills", () => {
  it("returns unknown when memory.lol has no record", async () => {
    stubUpstream({ accounts: [] });
    const c = await run({ handle: "nevertracked" });
    expect(c.status).toBe(200);
    expect(c.body?.status).toBe("unknown");
    expect(c.body?.note).toMatch(/not a clean bill/i);
  });

  it("returns unknown on a 404 rather than erroring", async () => {
    stubUpstream(null, 404);
    const c = await run({ handle: "missing" });
    expect(c.status).toBe(200);
    expect(c.body?.status).toBe("unknown");
  });

  it("returns unknown when the upstream throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const c = await run({ handle: "offline" });
    expect(c.status).toBe(200);
    expect(c.body?.status).toBe("unknown");
  });

  it("survives a malformed upstream payload", async () => {
    stubUpstream({ accounts: [{ nonsense: true }, "not-an-object"] });
    const c = await run({ handle: "weird" });
    expect(c.status).toBe(200);
    expect(c.body?.status).toBe("unknown");
  });
});

describe("x-handle-history - input and bounds", () => {
  it("rejects a handle that is not a valid X screen name", async () => {
    const c = await run({ handle: "not a handle!" });
    expect(c.status).toBe(400);
  });

  it("rejects a missing handle without calling the upstream", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const c = await run({});
    expect(c.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("caps the number of names returned for one account", async () => {
    const screen_names: Record<string, string[]> = {};
    for (let i = 0; i < 80; i += 1) screen_names[`name${i}`] = ["2020-01-01"];
    stubUpstream({ accounts: [{ id_str: "1", screen_names }] });
    const c = await run({ handle: "name0" });
    expect(c.body?.accounts?.[0].names.length).toBeLessThanOrEqual(40);
  });

  it("caches at the edge so a free archive is not hit once per scan", async () => {
    stubUpstream({ accounts: [{ id_str: "1", screen_names: { x: ["2020-01-01"] } }] });
    const c = await run({ handle: "x" });
    expect(c.headers["cache-control"]).toContain("s-maxage=86400");
  });
});
