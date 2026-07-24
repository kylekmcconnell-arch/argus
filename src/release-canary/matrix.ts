import { runCase } from "../calibration/run";
import { GOLDEN } from "../calibration/golden";
import { assembleDossier } from "../data/dossier";
import { emptyEvidence } from "../data/evidence";
import { SubjectClass } from "../engine";
import { presentPublicReport } from "../lib/reportPresentation";
import { auditToken, type TokenDossier } from "../token/audit";

const CLEAN_TOKEN_ADDRESS = "0x0000000000000000000000000000000000000101";
const HONEYPOT_TOKEN_ADDRESS = "0x0000000000000000000000000000000000000202";
const BURN_ADDRESS = "0x000000000000000000000000000000000000dead";

export type CanaryKind = "person" | "token";

export interface ReleaseCanaryResult {
  id: string;
  kind: CanaryKind;
  scenario: string;
  expected: string;
  actual: string;
  pass: boolean;
  detail: string;
}

export interface ReleaseCanarySummary {
  schemaVersion: 1;
  mode: "offline-fixtures";
  results: ReleaseCanaryResult[];
  passed: number;
  total: number;
  interceptedFixtureRequests: number;
  unexpectedUrls: string[];
}

interface FixtureFetchState {
  calls: string[];
  unexpectedUrls: string[];
}

// The token sources call global `fetch`. Serialize the short fixture-owned
// section so concurrent in-process canaries cannot capture and later restore
// one another's interceptor out of order.
let fixtureFetchTail: Promise<void> = Promise.resolve();

async function withSerializedFixtureFetch<T>(
  state: FixtureFetchState,
  work: () => Promise<T>,
): Promise<T> {
  const predecessor = fixtureFetchTail;
  let release!: () => void;
  fixtureFetchTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await predecessor;

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = fixtureFetch(state);
    return await work();
  } finally {
    globalThis.fetch = originalFetch;
    release();
  }
}

function golden(name: string) {
  const entry = GOLDEN.find((candidate) => candidate.name === name);
  if (!entry) throw new Error(`release canary fixture missing: ${name}`);
  return entry;
}

function finalPresentation(verdict: string, score: number | null) {
  return presentPublicReport({
    verdict,
    score,
    completeness: "complete",
    attestation: "server_collected",
    checks: [{ status: "confirmed" }],
  });
}

function partialPresentation(verdict: string, score: number | null) {
  return presentPublicReport({
    verdict,
    score,
    completeness: "partial",
    attestation: "server_collected",
    checks: [{ status: "unknown" }],
  });
}

function runGoldenCanary(input: {
  id: string;
  name: string;
  scenario: string;
  expectedPresentation: string;
}): ReleaseCanaryResult {
  const result = runCase(golden(input.name));
  const presentation = finalPresentation(result.actual.verdict, result.actual.score);
  const presentationMatches = presentation.final
    && presentation.displayVerdict === input.expectedPresentation;
  return {
    id: input.id,
    kind: "person",
    scenario: input.scenario,
    expected: `${result.expected.verdict} with a final ${input.expectedPresentation} presentation`,
    actual: `${result.actual.verdict}${result.actual.score == null ? "" : ` ${result.actual.score}/100`} · ${presentation.resultLabel} ${presentation.displayVerdict}`,
    pass: result.pass && presentationMatches,
    detail: result.mismatches.length
      ? result.mismatches.join("; ")
      : presentationMatches
        ? result.note
        : `presentation was ${presentation.resultLabel} ${presentation.displayVerdict} (final=${presentation.final})`,
  };
}

function runSparseIdentityCanary(): ReleaseCanaryResult {
  const evidence = emptyEvidence("@release_canary_unknown");
  evidence.roles = [SubjectClass.FOUNDER];
  evidence.profile.identity_confidence = "Unverified";
  evidence.profile.identity_note = "No provider-backed identity or substantive role evidence was collected.";
  const report = assembleDossier(evidence, true).report;
  const presentation = partialPresentation(report.composite_verdict, report.governing_score);
  const pass = report.composite_verdict === "INCOMPLETE"
    && report.governing_score === null
    && report.governing_role === null
    && report.cap_applied === null
    && presentation.displayVerdict === "INCOMPLETE"
    && !presentation.final
    && presentation.primaryScore === "";
  return {
    id: "person-sparse-unknown",
    kind: "person",
    scenario: "Sparse or unknown identity must abstain instead of manufacturing clearance.",
    expected: "INCOMPLETE with no score, governing role, or cap",
    actual: `${report.composite_verdict} · score ${report.governing_score ?? "withheld"} · ${presentation.readinessLabel}`,
    pass,
    detail: pass
      ? "Missing identity and axis evidence stayed visible as an incomplete investigation."
      : "Sparse evidence produced a publishable or numerically scored result.",
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function fixturePair(address: string) {
  const clean = address === CLEAN_TOKEN_ADDRESS;
  return {
    chainId: "ethereum",
    dexId: "uniswap",
    pairAddress: clean ? "fixture-clean-pair" : "fixture-honeypot-pair",
    priceUsd: clean ? "1.25" : "0.000001",
    liquidity: { usd: clean ? 2_000_000 : 25_000 },
    volume: { h24: clean ? 1_000_000 : 2_000 },
    marketCap: clean ? 100_000_000 : 50_000,
    pairCreatedAt: Date.UTC(2020, 0, 1),
    txns: { h24: clean ? { buys: 500, sells: 470 } : { buys: 45, sells: 1 } },
    priceChange: { h24: clean ? 2 : -75 },
    baseToken: {
      address,
      name: clean ? "Canary Established" : "Canary Honeypot",
      symbol: clean ? "SAFE" : "TRAP",
    },
    quoteToken: { symbol: "WETH" },
    info: {
      websites: [{ url: clean ? "https://safe.canary.invalid" : "https://trap.canary.invalid" }],
      socials: [{ type: "twitter", url: clean ? "https://x.com/canary_safe" : "https://x.com/canary_trap" }],
    },
  };
}

function goplusFixture(address: string) {
  const clean = address === CLEAN_TOKEN_ADDRESS;
  return {
    is_honeypot: clean ? "0" : "1",
    honeypot_with_same_creator: "0",
    is_mintable: "0",
    owner_address: clean ? "0x0000000000000000000000000000000000000000" : "0x000000000000000000000000000000000000beef",
    can_take_back_ownership: "0",
    hidden_owner: "0",
    selfdestruct: "0",
    is_proxy: "0",
    buy_tax: "0",
    sell_tax: clean ? "0" : "0.99",
    cannot_sell_all: clean ? "0" : "1",
    is_open_source: "1",
    transfer_pausable: "0",
    holder_count: clean ? "12000" : "40",
    holders: clean
      ? [
          { address: "0x0000000000000000000000000000000000001001", percent: "0.04" },
          { address: "0x0000000000000000000000000000000000001002", percent: "0.03" },
        ]
      : [{ address: "0x0000000000000000000000000000000000002001", percent: "0.82" }],
    lp_holders: clean
      ? [{ address: BURN_ADDRESS, percent: "1", is_locked: 0, is_contract: 0, tag: "Burn" }]
      : [{ address: "0x0000000000000000000000000000000000002002", percent: "1", is_locked: 0, is_contract: 0 }],
    creator_address: clean ? "0x000000000000000000000000000000000000cafe" : "0x000000000000000000000000000000000000beef",
    creator_percent: clean ? "0" : "0.18",
  };
}

function coingeckoFixture(address: string): Response {
  if (address === HONEYPOT_TOKEN_ADDRESS) return json({}, 404);
  return json({
    market_cap_rank: 100,
    market_data: {
      market_cap: { usd: 100_000_000 },
      ath: { usd: 5 },
      ath_date: { usd: "2025-01-01T00:00:00.000Z" },
      ath_change_percentage: { usd: -75 },
    },
    links: {
      homepage: ["https://safe.canary.invalid"],
      twitter_screen_name: "canary_safe",
    },
    image: {},
    description: { en: "Deterministic offline canary fixture." },
    tickers: ["Binance", "Coinbase", "Kraken", "OKX", "Bybit", "KuCoin"].map((name) => ({
      market: { name, identifier: name.toLowerCase() },
    })),
  });
}

function inputUrl(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function fixtureFetch(state: FixtureFetchState): typeof fetch {
  return async (input: string | URL | Request): Promise<Response> => {
    const rawUrl = inputUrl(input);
    state.calls.push(rawUrl);
    const url = new URL(rawUrl);

    if (url.hostname === "api.dexscreener.com" && url.pathname.startsWith("/latest/dex/tokens/")) {
      const address = decodeURIComponent(url.pathname.split("/").at(-1) ?? "").toLowerCase();
      if (address === CLEAN_TOKEN_ADDRESS || address === HONEYPOT_TOKEN_ADDRESS) {
        return json({ pairs: [fixturePair(address)] });
      }
    }

    if (url.hostname === "api.gopluslabs.io" && url.pathname === "/api/v1/token_security/1") {
      const address = (url.searchParams.get("contract_addresses") ?? "").toLowerCase();
      if (address === CLEAN_TOKEN_ADDRESS || address === HONEYPOT_TOKEN_ADDRESS) {
        return json({ result: { [address]: goplusFixture(address) } });
      }
    }

    if (url.hostname === "api.honeypot.is" && url.pathname === "/v2/IsHoneypot") {
      const address = (url.searchParams.get("address") ?? "").toLowerCase();
      if (address === CLEAN_TOKEN_ADDRESS || address === HONEYPOT_TOKEN_ADDRESS) {
        const honeypot = address === HONEYPOT_TOKEN_ADDRESS;
        return json({
          honeypotResult: { isHoneypot: honeypot },
          simulationSuccess: true,
          simulationResult: { buyTax: 0, sellTax: honeypot ? 99 : 0 },
          flags: honeypot ? ["sell blocked"] : [],
        });
      }
    }

    if (url.hostname === "api.coingecko.com" && url.pathname.includes("/contract/")) {
      const address = decodeURIComponent(url.pathname.split("/").at(-1) ?? "").toLowerCase();
      if (address === CLEAN_TOKEN_ADDRESS || address === HONEYPOT_TOKEN_ADDRESS) {
        return coingeckoFixture(address);
      }
    }

    if (url.hostname === "api.geckoterminal.com" && /\/pools\/fixture-(?:clean|honeypot)-pair\/ohlcv\/day$/.test(url.pathname)) {
      const clean = url.pathname.includes("fixture-clean-pair");
      return json({
        data: {
          attributes: {
            ohlcv_list: clean
              ? [
                  [3, 1.2, 1.3, 1.1, 1.25],
                  [2, 1.1, 1.2, 1, 1.2],
                  [1, 1, 1.1, 0.9, 1],
                ]
              : [
                  [3, 0.000004, 0.000004, 0.000001, 0.000001],
                  [2, 0.000006, 0.000006, 0.000004, 0.000004],
                  [1, 0.00001, 0.00001, 0.000006, 0.000008],
                ],
          },
        },
      });
    }

    state.unexpectedUrls.push(rawUrl);
    return json({ error: "release canary blocked an unrecognized URL" }, 599);
  };
}

function tokenResult(input: {
  id: string;
  scenario: string;
  dossier: TokenDossier | null;
  verdict: string;
  cap: string | null;
}): ReleaseCanaryResult {
  if (!input.dossier) {
    return {
      id: input.id,
      kind: "token",
      scenario: input.scenario,
      expected: `${input.verdict}${input.cap ? ` capped by ${input.cap}` : " with no cap"}`,
      actual: "no dossier",
      pass: false,
      detail: "The deterministic token fixture did not resolve.",
    };
  }
  const presentation = partialPresentation(input.dossier.verdict, input.dossier.score);
  const expectedPublicDisplay = input.verdict === "PASS" ? "INCOMPLETE" : input.verdict;
  const pass = input.dossier.verdict === input.verdict
    && input.dossier.capApplied === input.cap
    && input.dossier.safetyChecked
    && (input.dossier.priceHistory?.points.length ?? 0) >= 3
    && (input.verdict !== "PASS" || input.dossier.cg?.ath?.drawdownPct === -75)
    && !presentation.final
    && presentation.displayVerdict === expectedPublicDisplay
    && (input.verdict !== "PASS" || presentation.secondarySignal?.includes("EARLY SCORE") === true)
    && (input.verdict === "PASS" || presentation.resultLabel === "RISK SIGNAL");
  return {
    id: input.id,
    kind: "token",
    scenario: input.scenario,
    expected: `${input.verdict}${input.cap ? ` capped by ${input.cap}` : " with no cap"}; partial coverage must stay non-final`,
    actual: `${input.dossier.verdict} ${input.dossier.score ?? "N/A"}/100 · cap ${input.dossier.capApplied ?? "none"} · public ${presentation.resultLabel} ${presentation.displayVerdict}`,
    pass,
    detail: pass
      ? "The real token scorer consumed only intercepted fixture responses, froze price history plus lifetime ATH context, and preserved fail-closed presentation semantics."
      : "Token scoring, frozen market history, cap selection, or public readiness presentation drifted.",
  };
}

export async function runOfflineReleaseCanary(): Promise<ReleaseCanarySummary> {
  const results: ReleaseCanaryResult[] = [
    runGoldenCanary({
      id: "person-founder-known-good",
      name: "@satoshi_builds",
      scenario: "Known-good founder with verified exits and repeat backing.",
      expectedPresentation: "PASS",
    }),
    runGoldenCanary({
      id: "person-investor-known-good",
      name: "control:model-fraud-lead",
      scenario: "Known-good investor must not be failed by an unverified model allegation.",
      expectedPresentation: "PASS",
    }),
    runGoldenCanary({
      id: "person-risky-actor",
      name: "@deltagrowth",
      scenario: "Verified manipulation-as-a-service evidence must hard-stop the actor.",
      expectedPresentation: "AVOID",
    }),
    runSparseIdentityCanary(),
  ];

  const fetchState: FixtureFetchState = { calls: [], unexpectedUrls: [] };
  await withSerializedFixtureFetch(fetchState, async () => {
    try {
      const [clean, honeypot] = await Promise.all([
        auditToken({ kind: "token", ref: CLEAN_TOKEN_ADDRESS, via: "evm" }, undefined, { force: true }),
        auditToken({ kind: "token", ref: HONEYPOT_TOKEN_ADDRESS, via: "evm" }, undefined, { force: true }),
      ]);
      // Same clean-token fixtures, but an injected screener reports a sanctioned
      // address: an OFAC SDN hit must override the market score to AVOID.
      const sanctioned = await auditToken(
        { kind: "token", ref: CLEAN_TOKEN_ADDRESS, via: "evm" },
        undefined,
        {
          force: true,
          screenSanctions: async () => ({
            available: true,
            checked: 2,
            listSize: 700,
            sanctioned: ["0x0000000000000000000000000000000000000bad"],
            completedAt: "2026-07-15T00:00:00.000Z",
          }),
        },
      );
      results.push(
        tokenResult({
          id: "token-established-control",
          scenario: "Deep-liquidity, verified-source token with burned LP and no active authority.",
          dossier: clean,
          verdict: "PASS",
          cap: null,
        }),
        tokenResult({
          id: "token-honeypot-negative",
          scenario: "Static and simulated honeypot evidence must select the strongest hard cap.",
          dossier: honeypot,
          verdict: "AVOID",
          cap: "honeypot_confirmed",
        }),
        tokenResult({
          id: "token-ofac-sanctioned",
          scenario: "A sanctioned deployer or holder must hard-stop an otherwise-clean token.",
          dossier: sanctioned,
          verdict: "AVOID",
          cap: "ofac_sanctioned_address",
        }),
      );
    } catch (error) {
      results.push({
        id: "token-fixture-runtime",
        kind: "token",
        scenario: "The isolated token fixture runner must complete.",
        expected: "two deterministic token dossiers",
        actual: "runtime error",
        pass: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  });

  if (fetchState.unexpectedUrls.length) {
    results.push({
      id: "network-isolation",
      kind: "token",
      scenario: "Offline release canary must never fall through to an unrecognized provider URL.",
      expected: "zero unexpected URLs",
      actual: `${fetchState.unexpectedUrls.length} unexpected URL(s)`,
      pass: false,
      detail: fetchState.unexpectedUrls.join(", "),
    });
  }

  return {
    schemaVersion: 1,
    mode: "offline-fixtures",
    results,
    passed: results.filter((result) => result.pass).length,
    total: results.length,
    interceptedFixtureRequests: fetchState.calls.length,
    unexpectedUrls: fetchState.unexpectedUrls,
  };
}
