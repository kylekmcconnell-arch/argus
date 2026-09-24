import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyEvidence } from "../../src/data/evidence";
import { getCost, withCostLedger } from "../cost";
import {
  FOMOSCAN_CU,
  describePnl,
  fetchFomoMe,
  fetchFomoPnl,
  fetchFomoTokenTheses,
  fetchFomoUserByHandle,
  fetchFomoUserByWallet,
  fomoRecordBindsToSubject,
  xUsernameFromFomo,
  fomoscanAdapter,
} from "./fomoscan";
import type { CollectContext } from "./types";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json" },
});

const user = (overrides: Record<string, unknown> = {}) => ({
  id: "0a4b8e1c-1111-4222-8333-444455556666",
  handle: "yusufgemz",
  name: "Yusuf",
  bio: null,
  banner: null,
  profilePicture: null,
  twitter: "YusufGemz",
  solanaAddress: "7Gk2sdQ5s7ZJ3k1oQvY8wQe3xQ2uY6v1m8zNq4eP9Lqx",
  evmAddress: "0xAbCdEf0123456789AbCdEf0123456789AbCdEf01",
  ...overrides,
});

function context(handle = "@YusufGemz") {
  const evidence = emptyEvidence(handle);
  const steps: Parameters<CollectContext["emit"]>[0][] = [];
  return { evidence, steps, ctx: { handle, evidence, emit: (step) => steps.push(step) } satisfies CollectContext };
}

describe("FomoScan is asked only when it can answer", () => {
  it("does not call out without a key, and says so", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const res = await fetchFomoUserByHandle("yusufgemz", { fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(res.state).toBe("no_key");
    expect(res.note).toContain("FOMOSCAN_API_KEY");
  });

  it("sends the key as a bearer header and never in the url", async () => {
    vi.stubEnv("FOMOSCAN_API_KEY", "fsk_live_secret");
    const fetchImpl = vi.fn(async (url: unknown, init: unknown) => {
      expect(String(url)).toBe("https://api.fomoscan.sh/v2/user/handle/yusufgemz");
      expect(String(url)).not.toContain("fsk_live_secret");
      expect((init as RequestInit).headers).toMatchObject({ authorization: "Bearer fsk_live_secret" });
      return json(user());
    }) as unknown as typeof fetch;
    const res = await fetchFomoUserByHandle("@YusufGemz", { fetchImpl });
    expect(res.state).toBe("hit");
    expect(res.cu).toBe(FOMOSCAN_CU.handleHit);
    expect(res.value?.evmAddress).toBe("0xabcdef0123456789abcdef0123456789abcdef01");
  });

  it("reports a key with no plan as configuration, not as a provider failure", async () => {
    vi.stubEnv("FOMOSCAN_API_KEY", "fsk_live_secret");
    const fetchImpl = vi.fn(async () => json({ error: { code: "PAYMENT_REQUIRED" } }, 402)) as unknown as typeof fetch;
    const res = await fetchFomoUserByHandle("yusufgemz", { fetchImpl });
    expect(res.state).toBe("no_plan");
    expect(res.note).toContain("partner.fomoscan.sh");
  });

  it("prices a miss at 250 CU and names it an absence of a record", async () => {
    vi.stubEnv("FOMOSCAN_API_KEY", "fsk_live_secret");
    const fetchImpl = vi.fn(async () => json({ error: { code: "NOT_FOUND" } }, 404)) as unknown as typeof fetch;
    const res = await withCostLedger(() => fetchFomoUserByHandle("nobody", { fetchImpl }));
    expect(res.state).toBe("miss");
    expect(res.cu).toBe(FOMOSCAN_CU.handleMiss);
  });

  it("never resolves a wallet unless the caller opts into the 50,000 CU price", async () => {
    vi.stubEnv("FOMOSCAN_API_KEY", "fsk_live_secret");
    const fetchImpl = vi.fn(async () => json(user())) as unknown as typeof fetch;
    const off = await fetchFomoUserByWallet("0xAbCdEf0123456789AbCdEf0123456789AbCdEf01", { fetchImpl });
    expect(off.state).toBe("skipped");
    expect(fetchImpl).not.toHaveBeenCalled();
    const on = await fetchFomoUserByWallet("0xAbCdEf0123456789AbCdEf0123456789AbCdEf01", { fetchImpl, allowExpensive: true });
    expect(on.state).toBe("hit");
    expect(on.cu).toBe(FOMOSCAN_CU.walletHit);
  });

  it("records every attempt in the cost ledger under the fomoscan provider", async () => {
    vi.stubEnv("FOMOSCAN_API_KEY", "fsk_live_secret");
    const fetchImpl = vi.fn(async () => json(user())) as unknown as typeof fetch;
    const cost = await withCostLedger(async () => {
      await fetchFomoUserByHandle("yusufgemz", { fetchImpl });
      return getCost();
    });
    const line = cost.calls.find((c) => c.provider === "fomoscan" && c.op === "user-by-handle");
    expect(line?.calls).toBe(1);
  });

  it("introspects the key at zero cost", async () => {
    vi.stubEnv("FOMOSCAN_API_KEY", "fsk_live_secret");
    const fetchImpl = vi.fn(async () => json({ plan: { name: "starter" }, usage: { unitsRemaining: 240000, additionalUnits: 0, period: "2026-09" }, entitlement: { unmetered: false } })) as unknown as typeof fetch;
    const res = await fetchFomoMe({ fetchImpl });
    expect(res.state).toBe("hit");
    expect(res.cu).toBe(0);
    expect(res.value?.unitsRemaining).toBe(240000);
  });
});

describe("FomoScan numbers are FomoScan's and say what they are", () => {
  it("describes PnL as cash flow, never as realized profit", async () => {
    vi.stubEnv("FOMOSCAN_API_KEY", "fsk_live_secret");
    const fetchImpl = vi.fn(async () => json({
      handle: "yusufgemz", twitter: "YusufGemz", wallet: "7Gk2", evmWallet: null, updatedAt: 1789560000000,
      windows: { "30d": { netUsd: -12450.5, returnPct: -0.31, volumeUsd: 80000, trades: 44, rank: 120345 } },
    })) as unknown as typeof fetch;
    const res = await fetchFomoPnl("yusufgemz", { fetchImpl });
    expect(res.state).toBe("hit");
    expect(res.note).toContain("net cash out of $12,451");
    expect(res.note).toContain("not realized profit");
    expect(describePnl(res.value!)).toContain("ranked 120,345");
  });

  it("returns theses with their authors so calls can be timed against the chart", async () => {
    vi.stubEnv("FOMOSCAN_API_KEY", "fsk_live_secret");
    const fetchImpl = vi.fn(async () => json({
      tokenAddress: "0xcd4e70bfd73952123449e453f08c12e44ab89e58", tokenNetwork: "robinhood", symbol: "IDX", updatedAt: 1, count: 1, hasMore: false, nextBefore: null,
      items: [{ id: "t1", authorHandle: "YusufGemz", thesis: "IDX is the benchmark", fomoCreatedAt: Date.UTC(2026, 8, 16, 11, 11) }],
    })) as unknown as typeof fetch;
    const res = await fetchFomoTokenTheses("0xCd4E70bfd73952123449E453f08c12e44aB89E58", { fetchImpl });
    expect(res.state).toBe("hit");
    expect(res.value?.[0]).toMatchObject({ id: "t1", authorHandle: "YusufGemz", text: "IDX is the benchmark", postedAt: "2026-09-16T11:11:00.000Z" });
    expect(res.cu).toBe(FOMOSCAN_CU.thesisPage);
  });
});

describe("a FOMO record is only bound to the subject when FOMO's own X link agrees", () => {
  it("reads FOMO's X link whether it is a username or a profile url", () => {
    expect(xUsernameFromFomo("https://x.com/lowcap_hunter")).toBe("lowcap_hunter");
    expect(xUsernameFromFomo("http://twitter.com/@YusufGemz/")).toBe("YusufGemz");
    expect(xUsernameFromFomo("x.com/altcoinist?s=21")).toBe("altcoinist");
    expect(xUsernameFromFomo("@YusufGemz")).toBe("YusufGemz");
    expect(xUsernameFromFomo("not a handle!")).toBeNull();
    expect(xUsernameFromFomo(null)).toBeNull();
    expect(fomoRecordBindsToSubject(user({ twitter: "https://x.com/YusufGemz" }) as never, "yusufgemz")).toBe("x-confirmed");
  });

  it("confirms on a matching X username, rejects a different one, and downgrades a name-only match", () => {
    expect(fomoRecordBindsToSubject(user() as never, "@yusufgemz")).toBe("x-confirmed");
    expect(fomoRecordBindsToSubject(user({ twitter: "someoneelse" }) as never, "yusufgemz")).toBe("other-person");
    expect(fomoRecordBindsToSubject(user({ twitter: null }) as never, "yusufgemz")).toBe("handle-only");
    expect(fomoRecordBindsToSubject(user({ twitter: null, handle: "yusuf_real" }) as never, "yusufgemz")).toBe("other-person");
  });
});

describe("fomoscanAdapter attaches attributed wallets without overclaiming", () => {
  it("is unavailable without a key and skips without spending", async () => {
    vi.stubEnv("FOMOSCAN_API_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { ctx } = context();
    expect(fomoscanAdapter.available()).toBe(false);
    await expect(fomoscanAdapter.run(ctx)).resolves.toMatchObject({ state: "skipped", attempts: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("adds FOMO's verified wallets as InvestigatorAttributed, never SelfDoxxed, with provider attribution", async () => {
    vi.stubEnv("FOMOSCAN_API_KEY", "fsk_live_secret");
    vi.stubGlobal("fetch", vi.fn(async () => json(user())));
    const { ctx, evidence, steps } = context("@YusufGemz");
    await expect(fomoscanAdapter.run(ctx)).resolves.toMatchObject({ state: "executed", attempts: 1 });
    expect(evidence.wallets).toHaveLength(2);
    for (const w of evidence.wallets) {
      expect(w.link_tier).toBe("InvestigatorAttributed");
      expect(w.provider).toBe("fomoscan");
      expect(w.link_evidence_url).toContain("api.fomoscan.sh/v2/user/handle/");
    }
    expect(evidence.wallets.map((w) => w.chain).sort()).toEqual(["ethereum", "solana"]);
    expect(steps.some((s) => s.detail.includes("attached 2 verified wallets"))).toBe(true);
    expect(fomoscanAdapter.applicable?.(evidence)).toBe(false);
  });

  it("refuses a same-named FOMO account whose X link names someone else", async () => {
    vi.stubEnv("FOMOSCAN_API_KEY", "fsk_live_secret");
    vi.stubGlobal("fetch", vi.fn(async () => json(user({ twitter: "another_trader" }))));
    const { ctx, evidence } = context("@YusufGemz");
    const result = await fomoscanAdapter.run(ctx);
    expect(result).toMatchObject({ state: "executed", attempts: 1 });
    expect(evidence.wallets).toHaveLength(0);
    expect((result as { detail: string }).detail).toContain("not @yusufgemz");
  });

  it("treats a 404 as an executed miss and a 402 as a failed lane with the plan note", async () => {
    vi.stubEnv("FOMOSCAN_API_KEY", "fsk_live_secret");
    vi.stubGlobal("fetch", vi.fn(async () => json({}, 404)));
    await expect(fomoscanAdapter.run(context().ctx)).resolves.toMatchObject({ state: "executed", attempts: 1 });
    vi.stubGlobal("fetch", vi.fn(async () => json({}, 402)));
    const failed = await fomoscanAdapter.run(context().ctx);
    expect(failed).toMatchObject({ state: "failed", attempts: 1 });
    expect((failed as { detail: string }).detail).toContain("no compute units");
  });
});

it("rejects a mismatched Fomo wallet and reserves the potential hit cost", async () => {
  vi.stubEnv("FOMOSCAN_API_KEY", "fixture");
  const result = await fetchFomoUserByWallet("0x1111111111111111111111111111111111111111", {allowExpensive:true,fetchImpl:vi.fn(async()=>json(user())) as typeof fetch});
  expect(result).toMatchObject({state:"unavailable",value:null,cu:FOMOSCAN_CU.walletHit});
});

it("never adopts a wallet from a matching FOMO name without an X binding", async () => {
  vi.stubEnv("FOMOSCAN_API_KEY", "fixture");
  vi.stubGlobal("fetch", vi.fn(async () => json(user({ twitter:null }))));
  const {ctx,evidence}=context("@YusufGemz");
  const result=await fomoscanAdapter.run(ctx);
  expect(evidence.wallets).toHaveLength(0);
  expect(result).toMatchObject({state:"executed",attempts:1});
  expect(result?.detail).toContain("no X binding");
});
