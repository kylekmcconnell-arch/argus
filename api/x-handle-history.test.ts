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
