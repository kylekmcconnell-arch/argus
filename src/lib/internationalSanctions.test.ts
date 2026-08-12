import { describe, expect, it } from "vitest";
import {
  collectInternationalSanctions,
  describeInternationalSanctions,
  openSanctionsDatasetUrl,
} from "./internationalSanctions";

const HEADER = "id,schema,name,aliases";
const row = (name: string, aliases = "") => `x,"Person","${name}","${aliases}"`;

// A healthy OpenSanctions targets.simple.csv, padded past the list's floor so it
// parses to a valid index (mirrors the real 0.7k–4.3k person counts).
const healthyCsv = (rows: string[], total: number) => {
  const filler = Array.from({ length: Math.max(0, total - rows.length) }, (_, i) => row(`Filler Person ${i}`));
  return [HEADER, ...rows, ...filler].join("\n");
};

type ListState = { rows?: string[]; total?: number; status?: number };

const fetcherFor = (state: { eu?: ListState; un?: ListState; uk?: ListState } = {}) =>
  ((input: string | URL | Request) => {
    const url = String(input);
    const resolve = (list: ListState | undefined, defaultTotal: number) => {
      const status = list?.status ?? 200;
      if (status !== 200) return Promise.resolve(new Response("error", { status }));
      return Promise.resolve(new Response(healthyCsv(list?.rows ?? [], list?.total ?? defaultTotal), { status: 200 }));
    };
    if (url.includes("/eu_fsf/")) return resolve(state.eu, 1_600);
    if (url.includes("/un_sc_sanctions/")) return resolve(state.un, 400);
    if (url.includes("/gb_fcdo_sanctions/")) return resolve(state.uk, 1_600);
    return Promise.resolve(new Response("", { status: 404 }));
  }) as unknown as typeof fetch;

describe("collectInternationalSanctions", () => {
  it("flags an exact match and names the list that hit", async () => {
    const out = await collectInternationalSanctions("Vladimir Putin", {
      fetcher: fetcherFor({ eu: { rows: [row("Vladimir Putin")] } }),
    });
    expect(out.value.available).toBe(true);
    if (!out.value.available) throw new Error("expected available");
    expect(out.value.sanctioned).toBe(true);
    expect(out.value.matchedLists).toEqual(["EU Consolidated Financial Sanctions"]);
    expect(out.value.screenedLists).toHaveLength(3);
    expect(describeInternationalSanctions(out).status).toBe("finding");
  });

  it("clears a name when all three lists load and none match", async () => {
    const out = await collectInternationalSanctions("Jane Q Analyst", { fetcher: fetcherFor() });
    expect(out.value.available).toBe(true);
    if (!out.value.available) throw new Error("expected available");
    expect(out.value.sanctioned).toBe(false);
    expect(out.value.screenedLists).toHaveLength(3);
    const summary = describeInternationalSanctions(out);
    expect(summary.status).toBe("checked-empty");
    expect(summary.note).toContain("no match");
  });

  it("matches on a reversed surname-first index entry", async () => {
    const out = await collectInternationalSanctions("Vladimir Putin", {
      fetcher: fetcherFor({ un: { rows: [row("Putin Vladimir")], total: 400 } }),
    });
    expect(out.value.available).toBe(true);
    if (!out.value.available) throw new Error("expected available");
    expect(out.value.sanctioned).toBe(true);
    expect(out.value.matchedLists).toEqual(["UN Security Council Consolidated"]);
  });

  it("treats an undersized (truncated) index as an unavailable list, not a clean pass", async () => {
    const out = await collectInternationalSanctions("Jane Q Analyst", {
      fetcher: fetcherFor({ eu: { rows: [], total: 100 } }), // below EU floor of 1500
    });
    expect(out.value.available).toBe(true);
    if (!out.value.available) throw new Error("expected available");
    const eu = out.value.results.find((r) => r.key === "eu");
    expect(eu?.available).toBe(false);
    expect(out.value.screenedLists).toHaveLength(2); // UN + UK still screened
  });

  it("reports unavailable when every list fails to load", async () => {
    const out = await collectInternationalSanctions("Jane Q Analyst", {
      fetcher: fetcherFor({ eu: { status: 503 }, un: { status: 503 }, uk: { status: 500 } }),
    });
    expect(out.value.available).toBe(false);
    expect(out.status).toBe("failed");
    expect(describeInternationalSanctions(out).status).toBe("unavailable");
  });

  it("refuses to screen a name that is not a resolved full name", async () => {
    let called = 0;
    const spy = ((_input: string | URL | Request) => {
      called += 1;
      return Promise.resolve(new Response("", { status: 200 }));
    }) as unknown as typeof fetch;
    const out = await collectInternationalSanctions("Cher", { fetcher: spy });
    expect(out.value.available).toBe(false);
    expect(called).toBe(0); // never fetches a list for an unresolved name
  });

  it("builds the OpenSanctions dataset URL for a slug", () => {
    expect(openSanctionsDatasetUrl("eu_fsf")).toBe(
      "https://data.opensanctions.org/datasets/latest/eu_fsf/targets.simple.csv",
    );
  });
});
