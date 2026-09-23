// server/providerDeadline.ts
import { AsyncLocalStorage } from "node:async_hooks";
var context = new AsyncLocalStorage();
var deadlineFetch = (input, init) => {
  const signal = context.getStore();
  signal?.throwIfAborted();
  return globalThis.fetch(input, { ...init, signal: signal ? AbortSignal.any([signal, ...init?.signal ? [init.signal] : []]) : init?.signal });
};

// server/sweep.ts
import { createHash } from "node:crypto";

// server/config.ts
function env(key) {
  return process.env[key];
}
var GROK_ANALYST_MODEL = process.env.ARGUS_GROK_ANALYST_MODEL || process.env.ARGUS_GROK_MODEL || "grok-4-fast";
var ANALYST_MODEL = process.env.ARGUS_ANALYST_MODEL || "claude-sonnet-4-6";
var DISCOVERY_MODEL = process.env.ARGUS_DISCOVERY_MODEL || ANALYST_MODEL;

// src/threat/net.ts
var legacyContext;
var contextForRequest;
function hasThreatApiContext() {
  return !!(contextForRequest?.() ?? legacyContext)?.base;
}

// src/lib/officialXProfile.ts
var X_RESERVED_PATHS = /* @__PURE__ */ new Set([
  "i",
  "home",
  "search",
  "intent",
  "share",
  "hashtag",
  "explore",
  "settings",
  "messages",
  "notifications",
  "compose",
  "login",
  "signup",
  "privacy",
  "tos",
  "about",
  "download",
  "jobs",
  "help"
]);
function officialXProfileHandle(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (!["https:", "http:"].includes(url.protocol) || host !== "x.com" && host !== "twitter.com") return null;
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length !== 1) return null;
    const handle = segments[0];
    if (!/^[A-Za-z0-9_]{2,30}$/.test(handle) || X_RESERVED_PATHS.has(handle.toLowerCase())) return null;
    return handle;
  } catch {
    return null;
  }
}

// src/lib/decisionBoundary.ts
var CAP_BOUNDARIES = {
  honeypot_confirmed: {
    ceiling: 10,
    controllingFact: "The saved tradeability evidence shows that holders may not be able to sell.",
    unlockCondition: "A fresh successful buy-and-sell receipt, together with contract evidence showing the restriction is gone, must replace the failed result.",
    evidenceArea: "contract"
  },
  cannot_sell_all: {
    ceiling: 10,
    controllingFact: "The contract does not allow a holder to sell their full balance.",
    unlockCondition: "A fresh trade receipt must show a full-balance sell succeeds and the contract restriction no longer applies.",
    evidenceArea: "contract"
  },
  owner_can_modify_balance: {
    ceiling: 20,
    controllingFact: "An active controller can directly change holder balances.",
    unlockCondition: "A current chain receipt must show that the balance-changing authority was permanently removed or cannot be exercised.",
    evidenceArea: "contract"
  },
  balance_mutable_authority: {
    ceiling: 20,
    controllingFact: "An active authority can rewrite token balances.",
    unlockCondition: "A current chain receipt must show that the balance-mutating authority was permanently revoked.",
    evidenceArea: "contract"
  },
  serial_scammer_creator: {
    ceiling: 25,
    controllingFact: "The attributed creator wallet has previously created tokens recorded as honeypots.",
    unlockCondition: "Primary creation records must reattribute this token to a different wallet, or the source record behind the prior honeypot link must be corrected.",
    evidenceArea: "contract"
  },
  mint_authority_active: {
    ceiling: 35,
    controllingFact: "More tokens can still be created by an active mint authority.",
    unlockCondition: "A current chain receipt must show that the mint authority was permanently revoked.",
    evidenceArea: "contract"
  },
  freeze_authority_active: {
    ceiling: 35,
    controllingFact: "An active freeze authority can stop token accounts from moving funds.",
    unlockCondition: "A current chain receipt must show that the freeze authority was permanently revoked.",
    evidenceArea: "contract"
  },
  reclaimable_ownership: {
    ceiling: 35,
    controllingFact: "The saved contract record shows hidden or reclaimable ownership control.",
    unlockCondition: "A current contract-authority receipt must show that ownership cannot be hidden, reclaimed, or exercised.",
    evidenceArea: "contract"
  },
  single_wallet_majority_supply: {
    ceiling: 39,
    controllingFact: "One assessed non-market wallet controls at least half of the token supply.",
    unlockCondition: "A comparable current holder register must show that no non-market wallet holds a majority of supply.",
    evidenceArea: "holders"
  },
  documented_scanner_concealment: {
    ceiling: 55,
    controllingFact: "The verified contract source documents behavior intended to conceal activity from scanners.",
    unlockCondition: "New verified source code and matching deployed-bytecode receipts must show that the concealment behavior was removed.",
    evidenceArea: "contract"
  },
  single_wallet_concentration: {
    ceiling: 69,
    controllingFact: "One assessed non-market wallet holds at least a quarter of the token supply.",
    unlockCondition: "A comparable current holder register must show the largest non-market wallet below the concentration threshold.",
    evidenceArea: "holders"
  },
  few_wallet_concentration: {
    ceiling: 69,
    controllingFact: "The three largest assessed material wallets hold at least 60% of supply between them.",
    unlockCondition: "A comparable current holder register must show those wallets below the concentration threshold.",
    evidenceArea: "holders"
  },
  ofac_sanctioned_address: {
    ceiling: 5,
    controllingFact: "A wallet bound to this report matched a current sanctions record.",
    unlockCondition: "A current official sanctions record must show the address is no longer designated, or primary attribution evidence must correct the address binding.",
    evidenceArea: "contract"
  }
};
var MARKET_CANNOT_OVERRIDE = "Higher price, volume, liquidity, followers, or social activity cannot override this safety limit.";
function largestHeadroom(axes) {
  const ranked = axes.filter((axis) => Number.isFinite(axis.score) && Number.isFinite(axis.weight) && axis.weight > 0).map((axis) => ({ axis, points: Math.max(0, axis.weight - axis.score) })).sort((a, b) => b.points - a.points || a.axis.key.localeCompare(b.axis.key));
  return ranked[0] && ranked[0].points > 0 ? ranked[0] : null;
}
function largestContribution(axes) {
  const ranked = axes.filter((axis) => Number.isFinite(axis.score) && Number.isFinite(axis.weight) && axis.weight > 0).map((axis) => ({ axis, points: Math.max(0, axis.score) })).sort((a, b) => b.points - a.points || a.axis.key.localeCompare(b.axis.key));
  return ranked[0] && ranked[0].points > 0 ? ranked[0] : null;
}
function areaForAxis(axis) {
  if (!axis) return "method";
  if (axis.key === "T1") return "liquidity";
  if (axis.key === "T2" || axis.key === "T3") return "contract";
  if (axis.key === "T4") return "holders";
  if (axis.key === "T5" || axis.key === "T6") return "market";
  return "method";
}
function deriveTokenDecisionBoundary(input) {
  if (input.score === null || !Number.isFinite(input.score)) return null;
  const score = Math.max(0, Math.min(100, Math.round(input.score)));
  if (input.capApplied) {
    const rule = CAP_BOUNDARIES[input.capApplied.toLowerCase()];
    if (!rule) {
      return {
        schemaVersion: 1,
        kind: "unknown_cap",
        controllingFact: "A saved safety limit controls this result, but this report does not contain a public explanation for that limit.",
        boundary: `The saved score is ${score}/100. ARGUS will not infer the missing ceiling.`,
        willNotChange: MARKET_CANNOT_OVERRIDE,
        unlockCondition: "Open the methodology receipt for the saved limit before treating this result as movable.",
        evidenceArea: "method"
      };
    }
    return {
      schemaVersion: 1,
      kind: "cap",
      controllingFact: rule.controllingFact,
      boundary: `This finding caps the score at ${rule.ceiling}/100, even if every other scored area improves.`,
      willNotChange: MARKET_CANNOT_OVERRIDE,
      unlockCondition: rule.unlockCondition,
      evidenceArea: rule.evidenceArea
    };
  }
  if (score < 70) {
    const threshold = score < 40 ? 40 : 70;
    const nextVerdict = score < 40 ? "CAUTION" : "PASS";
    const gap = threshold - score;
    const headroom = largestHeadroom(input.axes);
    const headroomCopy = !headroom ? "The saved axes contain no unused scoring headroom." : headroom.points >= gap ? `${headroom.axis.label} has ${headroom.points} points of unused headroom on paper, enough to cross the boundary only if new evidence earns those points.` : `${headroom.axis.label} has the most unused headroom at ${headroom.points} points, so no single scored area can cross the boundary by itself.`;
    return {
      schemaVersion: 1,
      kind: "threshold",
      controllingFact: `${gap} evidence-backed point${gap === 1 ? "" : "s"} separate this score from ${nextVerdict}.`,
      boundary: headroomCopy,
      willNotChange: "Price movement, volume, or social attention alone does not add points to this saved report.",
      unlockCondition: `A new scan must verify enough changed evidence to add ${gap} point${gap === 1 ? "" : "s"}; arithmetic headroom is not a prediction.`,
      evidenceArea: areaForAxis(headroom?.axis)
    };
  }
  const buffer = score - 69;
  const contribution = largestContribution(input.axes);
  const pressure = contribution && contribution.points >= buffer ? `${contribution.axis.label} contributes ${contribution.points} points and is large enough by itself to erase that buffer if its evidence materially deteriorates.` : "No single scored area is large enough by itself to erase the current buffer.";
  return {
    schemaVersion: 1,
    kind: "buffer",
    controllingFact: `${buffer} point${buffer === 1 ? "" : "s"} separate this score from falling below PASS.`,
    boundary: pressure,
    willNotChange: "Short-term price or social movement does not change the saved PASS result.",
    unlockCondition: "Only a new scan with materially different verified evidence can move this boundary.",
    evidenceArea: areaForAxis(contribution?.axis)
  };
}

// src/graph/network.ts
var EVM_ADDRESS = /^0x[0-9a-f]+$/i;
var SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
function normalizeChain(chain) {
  return String(chain).trim().toLowerCase();
}
function normalizeAddress(chain, address) {
  const value = String(address).trim();
  return normalizeChain(chain) !== "solana" && EVM_ADDRESS.test(value) ? value.toLowerCase() : value;
}
function tokenEntityKey(chain, address) {
  return `token:${normalizeChain(chain)}:${normalizeAddress(chain, address)}`;
}
function walletEntityKey(chain, address) {
  return `wallet:${normalizeChain(chain)}:${normalizeAddress(chain, address)}`;
}
function canonical(raw) {
  const value = String(raw).trim();
  let m = value.match(/^token:([^:]+):(.+)$/i);
  if (m) return tokenEntityKey(m[1], m[2]);
  m = value.match(/^(?:wallet|holder|funder):([^:]+):(.+)$/i);
  if (m) return walletEntityKey(m[1], m[2]);
  m = value.match(/^(?:token|mint):(.+)$/i);
  if (m && EVM_ADDRESS.test(m[1])) return tokenEntityKey("evm", m[1]);
  if (m && SOLANA_ADDRESS.test(m[1])) return tokenEntityKey("solana", m[1]);
  m = value.match(/^(?:wallet|holder|funder):(.+)$/i);
  if (m && EVM_ADDRESS.test(m[1])) return walletEntityKey("evm", m[1]);
  if (m && SOLANA_ADDRESS.test(m[1])) return walletEntityKey("solana", m[1]);
  m = value.match(/^([^:]+):(.+)$/);
  if (m && (EVM_ADDRESS.test(m[2]) || normalizeChain(m[1]) === "solana" && SOLANA_ADDRESS.test(m[2]))) {
    return walletEntityKey(m[1], m[2]);
  }
  if (SOLANA_ADDRESS.test(value)) return value;
  const lower = value.toLowerCase().replace(/\s+/g, "");
  if (lower.startsWith("$")) return lower;
  return lower.replace(/^@/, "");
}
var GENERIC_KEYS = /* @__PURE__ */ new Set([
  "site",
  "website",
  "web",
  "twitter",
  "x",
  "telegram",
  "discord",
  "github",
  "docs",
  "documentation",
  "medium",
  "linktree",
  "whitepaper",
  "mail",
  "email",
  "youtube",
  "tiktok",
  "instagram",
  "reddit",
  "facebook",
  "warpcast",
  "farcaster",
  "coingecko",
  "dexscreener",
  "linkedin",
  "blog",
  "other",
  "unknown"
]);
var isGenericKey = (raw) => GENERIC_KEYS.has(canonical(raw));
var CONTEXT_ONLY_EDGE_TYPES = /* @__PURE__ */ new Set([
  "INVESTED_IN",
  "AFFILIATED_WITH",
  "ARKHAM_ENTITY",
  "ARKHAM_RISK_CONTEXT",
  "ARKHAM_TRANSACTION_CONTEXT"
]);
function contextOnlyNodeKeys(contribution, resolve) {
  const byNode = /* @__PURE__ */ new Map();
  for (const edge of contribution.edges) {
    const type = String(edge.type).toUpperCase();
    for (const endpoint of [resolve(edge.src), resolve(edge.dst)]) {
      const types = byNode.get(endpoint) ?? [];
      types.push(type);
      byNode.set(endpoint, types);
    }
  }
  return new Set([...byNode.entries()].filter(([, types]) => types.length > 0 && types.every((type) => CONTEXT_ONLY_EDGE_TYPES.has(type))).map(([key]) => key));
}
function buildAliasResolver(contributions) {
  const targets = /* @__PURE__ */ new Map();
  const add = (alias2, subject) => {
    const a = canonical(alias2);
    if (!a) return;
    const set = targets.get(a) ?? /* @__PURE__ */ new Set();
    set.add(subject);
    targets.set(a, set);
  };
  const DOMAIN = /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i;
  for (const c of contributions) {
    const rawSubject = c.nodes.find((n) => n.subject)?.key ?? c.handle;
    const subj = canonical(String(rawSubject));
    const addressBacked = subj.startsWith("token:");
    if (String(c.handle).startsWith("$")) add(c.handle, subj);
    if (!addressBacked) continue;
    for (const alias2 of c.aliases ?? []) add(alias2, subj);
    const subjectNode = c.nodes.find((n) => n.subject);
    if (subjectNode) {
      if (typeof subjectNode.label === "string") add(subjectNode.label, subj);
      if (typeof subjectNode.symbol === "string") add("$" + subjectNode.symbol.replace(/^\$/, ""), subj);
    }
    for (const e of c.edges) {
      if (canonical(e.src) !== subj) continue;
      const dst = String(e.dst);
      if (e.type === "TEAM" && dst.startsWith("@")) add(dst, subj);
      else if (e.type === "LINKS" && DOMAIN.test(dst)) add(dst, subj);
    }
  }
  const unique = /* @__PURE__ */ new Map();
  for (const [alias2, ids] of targets) if (ids.size === 1) unique.set(alias2, [...ids][0]);
  return (key) => {
    const id = canonical(key);
    return unique.get(id) ?? id;
  };
}
function subjectConnections(handle, contributions, max = 12) {
  const resolve = buildAliasResolver(contributions);
  const me = resolve(handle);
  const mine = /* @__PURE__ */ new Map();
  for (const c of contributions) {
    if (resolve(c.handle) !== me) continue;
    const contextOnly = contextOnlyNodeKeys(c, resolve);
    for (const n of c.nodes) {
      if (isGenericKey(String(n.key))) continue;
      const k = resolve(n.key);
      const label = typeof n.label === "string" && n.label.trim() ? n.label : String(n.key);
      if (k !== me && !contextOnly.has(k)) mine.set(k, { label, type: String(n.type) });
    }
  }
  if (!mine.size) return [];
  const byOther = /* @__PURE__ */ new Map();
  const ensure = (id, label, verdict) => {
    if (!byOther.has(id)) byOther.set(id, { label, verdict, ties: /* @__PURE__ */ new Map(), direct: false });
    return byOther.get(id);
  };
  for (const c of contributions) {
    const other = resolve(c.handle);
    if (other === me) continue;
    const otherLabel = c.aliases?.[0] ?? (typeof c.nodes.find((n) => n.subject)?.label === "string" ? String(c.nodes.find((n) => n.subject).label) : c.handle);
    const contextOnly = contextOnlyNodeKeys(c, resolve);
    if (mine.has(other)) {
      const e = ensure(other, otherLabel, c.verdict);
      e.direct = true;
    }
    for (const n of c.nodes) {
      if (isGenericKey(String(n.key))) continue;
      const k = resolve(n.key);
      if (k !== me && k !== other && mine.has(k) && !contextOnly.has(k)) {
        const e = ensure(other, otherLabel, c.verdict);
        e.ties.set(k, { key: k, label: mine.get(k).label, type: mine.get(k).type });
      }
    }
  }
  return [...byOther.entries()].map(([, v]) => ({ other: v.label, otherVerdict: v.verdict, ties: [...v.ties.values()], direct: v.direct })).filter((x) => x.ties.length > 0 || x.direct).sort((a, b) => Number(b.direct) - Number(a.direct) || b.ties.length - a.ties.length).slice(0, max);
}

// src/lib/priceHistory.ts
var NETWORK = {
  solana: "solana",
  ethereum: "eth",
  eth: "eth",
  bsc: "bsc",
  base: "base",
  arbitrum: "arbitrum",
  polygon: "polygon_pos",
  "polygon_pos": "polygon_pos",
  avalanche: "avax",
  avax: "avax",
  optimism: "optimism",
  fantom: "ftm",
  sui: "sui",
  ton: "ton",
  tron: "tron",
  blast: "blast",
  sei: "sei-evm"
};
var PERIOD_SECONDS = { day: 86400, hour: 3600 };
var VOLUME_WINDOW_MAX = 7;
var GT = "https://api.geckoterminal.com/api/v2";
function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
function readCandle(row) {
  if (!Array.isArray(row) || row.length < 5) return null;
  const ts = finiteNumber(row[0]);
  const close = finiteNumber(row[4]);
  if (ts === void 0 || close === void 0) return null;
  const high = finiteNumber(row[2]);
  const low = finiteNumber(row[3]);
  const volumeUsd = finiteNumber(row[5]);
  return {
    ts,
    close,
    ...high === void 0 ? {} : { high },
    ...low === void 0 ? {} : { low },
    ...volumeUsd === void 0 || volumeUsd < 0 ? {} : { volumeUsd }
  };
}
function candleRange(series, last) {
  const measured = series.filter((candle) => candle.high !== void 0 && candle.low !== void 0 && candle.low > 0 && candle.low <= candle.close && candle.high >= candle.close);
  if (!measured.length) return {};
  const high = Math.max(...measured.map((candle) => candle.high));
  const low = Math.min(...measured.map((candle) => candle.low));
  return {
    range: {
      high,
      low,
      drawdownFromHighPct: high > 0 ? (last - high) / high * 100 : 0,
      measuredPoints: measured.length,
      ...measured.length === series.length ? {
        highs: measured.map((candle) => candle.high),
        lows: measured.map((candle) => candle.low)
      } : {}
    }
  };
}
function volumeWindow(candles) {
  const measured = candles.filter((candle) => candle.volumeUsd !== void 0);
  return {
    usd: measured.reduce((total, candle) => total + candle.volumeUsd, 0),
    candles: candles.length,
    measured: measured.length
  };
}
function volumeTrend(series) {
  const width = Math.min(VOLUME_WINDOW_MAX, Math.floor(series.length / 2));
  if (width < 2) return {};
  const recent = volumeWindow(series.slice(series.length - width));
  const prior = volumeWindow(series.slice(series.length - width * 2, series.length - width));
  if (!recent.measured || !prior.measured || prior.usd <= 0) return {};
  return {
    volume: {
      recent,
      prior,
      changePct: (recent.usd - prior.usd) / prior.usd * 100,
      isFloor: recent.measured < recent.candles || prior.measured < prior.candles
    }
  };
}
function windowShape(series, count, timeframe) {
  const period = PERIOD_SECONDS[timeframe];
  const span = series[series.length - 1].ts - series[0].ts;
  if (!period || span <= 0) return {};
  const spanPeriods = Math.round(span / period) + 1;
  if (spanPeriods < count) return {};
  return { spanPeriods, windowIsPartial: count < spanPeriods };
}
function summarizeCandles(candles, timeframe) {
  const series = [...candles].sort((left, right) => left.ts - right.ts).filter((candle) => candle.close > 0);
  if (!series.length) return null;
  const points = series.map((candle) => candle.close);
  const first = points[0];
  const last = points[points.length - 1];
  const peak = Math.max(...points);
  return {
    points,
    first,
    last,
    peak,
    changePct: first > 0 ? (last - first) / first * 100 : 0,
    drawdownPct: peak > 0 ? (last - peak) / peak * 100 : 0,
    ...candleRange(series, last),
    ...volumeTrend(series),
    ...windowShape(series, points.length, timeframe)
  };
}
async function gt(path, fetchImpl2 = fetch) {
  try {
    const r = await fetchImpl2(`${GT}${path}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8e3)
    });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}
async function topPool(network, address, fetchImpl2 = fetch) {
  const d = await gt(`/networks/${network}/tokens/${address}/pools?page=1`, fetchImpl2);
  const rows = record(d).data;
  const first = Array.isArray(rows) ? record(rows[0]) : {};
  const attributes = record(first.attributes);
  const id = typeof attributes.address === "string" ? attributes.address : typeof first.id === "string" ? first.id : void 0;
  return id ? id.replace(`${network}_`, "") : null;
}
async function fetchPriceHistory(address, chain, pairAddress, fetchImpl2 = fetch) {
  const network = NETWORK[chain?.toLowerCase()] ?? chain?.toLowerCase();
  if (!network || !address) return null;
  const pool = pairAddress || await topPool(network, address, fetchImpl2);
  if (!pool) return null;
  for (const timeframe of ["day", "hour"]) {
    const d = await gt(`/networks/${network}/pools/${pool}/ohlcv/${timeframe}?aggregate=1&limit=200&currency=usd`, fetchImpl2);
    const rawList = record(record(record(d).data).attributes).ohlcv_list;
    const candles = Array.isArray(rawList) ? rawList.map(readCandle).filter((candle) => candle !== null) : [];
    if (candles.length < 3) continue;
    const summary = summarizeCandles(candles, timeframe);
    if (!summary || summary.points.length < 3) continue;
    return { ...summary, timeframe, capturedAt: (/* @__PURE__ */ new Date()).toISOString() };
  }
  return null;
}
async function fetchOhlcv(address, chain, pairAddress, timeframe) {
  const network = NETWORK[chain?.toLowerCase()] ?? chain?.toLowerCase();
  if (!network || !address) return null;
  const pool = pairAddress || await topPool(network, address);
  if (!pool) return null;
  for (const tf of timeframe ? [timeframe] : ["day", "hour"]) {
    const d = await gt(`/networks/${network}/pools/${pool}/ohlcv/${tf}?aggregate=1&limit=200&currency=usd`);
    const rawList = record(record(record(d).data).attributes).ohlcv_list;
    const candles = (Array.isArray(rawList) ? rawList.map(readCandle).filter((candle) => candle !== null) : []).filter((candle) => candle.close > 0).sort((left, right) => left.ts - right.ts);
    if (candles.length < 3) continue;
    return { candles, timeframe: tf };
  }
  return null;
}

// src/lib/providerCapabilities.ts
var ENABLED_VALUE = /^(?:1|true|on|enabled)$/i;
var DISABLED_VALUE = /^(?:0|false|off|disabled)$/i;
function arkhamProviderEnabled() {
  const raw = String(import.meta.env?.VITE_ARKHAM_PROVIDER_ENABLED ?? "").trim();
  if (!raw) return true;
  if (DISABLED_VALUE.test(raw)) return false;
  return ENABLED_VALUE.test(raw);
}

// src/token/scannerEvasion.ts
var DETECTOR_PATTERNS = [
  [/\bgmgn\b/i, "GMGN"],
  [/\bhoneypot\.is\b/i, "honeypot.is"],
  [/\btoken\s*sniffer\b/i, "TokenSniffer"],
  [/\bgo\s*plus\b/i, "GoPlus"],
  [/\bquick\s*intel\b/i, "QuickIntel"],
  [/\bde\.fi\b|\bdefi\s*scanner\b/i, "De.Fi scanner"],
  [/\bdex\s*tools\b/i, "DEXTools"],
  [/\brug\s*(?:check|checker|screen)s?\b/i, "rug checker"],
  [/\bhoneypot\b/i, "honeypot detection"],
  [/\btrade\s*restriction\b/i, "trade-restriction detection"],
  [/\bscanner?s?\b|\bdetector\b|\bbot\s*checks?\b/i, "automated scanners"]
];
var CONCEALMENT_INTENT = [
  /\b(?:hide|hides|hidden|hiding|mask|masks|masked|disguise|disguises|obfuscate|obfuscates|conceal|conceals|spoof|spoofs|fake|fakes)\b/i,
  /\b(?:bypass|bypasses|evade|evades|evasion|dodge|dodges|trick|tricks|fool|fools|defeat|defeats)\b/i
];
var EVASION_INTENT = [
  /\b(?:stop|stops|stopped|prevent|prevents|avoid|avoids|bypass|bypasses|evade|evades|dodge|defeat|suppress)\b/i,
  /\bso\s+(?:it|they|we)\s+(?:do(?:es)?n'?t|won'?t|will\s+not|no\s+longer)\b/i,
  /\b(?:not|never|no\s+longer)\s+(?:get\s+)?(?:flag\w*|detect\w*|mark\w*|catch|caught|picked\s+up)\b/i,
  /\b(?:hide|hides|hidden|mask|masks|disguise)\b/i
];
var FLAGGING_VERB = /\b(?:flag|flags|flagged|flagging|detect|detects|detected|detection|mark|marks|marked|trigger|triggers|caught|catch|report|reports|classif\w*)\b/i;
var COMMENT = /\/\/[^\n\r]{4,400}|\/\*[\s\S]{4,1200}?\*\//g;
function cleanComment(raw) {
  return raw.replace(/^\s*\/\*+/, "").replace(/\*+\/\s*$/, "").replace(/^\s*\/\/+/gm, "").replace(/^\s*\*+/gm, "").replace(/\s+/g, " ").trim();
}
function sourceComments(source) {
  const out = [];
  for (const match of source.matchAll(COMMENT)) {
    const text = cleanComment(match[0]);
    if (text.length < 12) continue;
    if (/^SPDX-License-Identifier/i.test(text)) continue;
    out.push(text);
  }
  return out;
}
function detectScannerEvasion(source) {
  if (!source || typeof source !== "string") return [];
  const findings = [];
  const seen = /* @__PURE__ */ new Set();
  for (const comment of sourceComments(source)) {
    const detectors = [...new Set(
      DETECTOR_PATTERNS.filter(([pattern]) => pattern.test(comment)).map(([, name]) => name)
    )];
    if (!detectors.length) continue;
    if (!EVASION_INTENT.some((pattern) => pattern.test(comment))) continue;
    if (!FLAGGING_VERB.test(comment)) continue;
    const key = comment.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const kind = CONCEALMENT_INTENT.some((pattern) => pattern.test(comment)) ? "concealment" : "tuning";
    findings.push({ quote: comment.slice(0, 300), detectors, kind });
    if (findings.length >= 3) break;
  }
  return findings;
}
function scannerEvasionClaim(finding) {
  const surfaces = finding.detectors.slice(0, 2).join(" and ");
  if (finding.kind === "concealment") {
    return `The verified contract source documents concealing behaviour from ${surfaces}: "${finding.quote}" The behaviour stays and the detector is blinded to it, so a clean contract result here is not evidence the behaviour is absent.`;
  }
  return `The deployer writes about ${surfaces} in the contract source: "${finding.quote}" Read as stated, the flagged behaviour was removed rather than hidden, so the clean scanner result is accurate. It is recorded because a deployer iterating against scanner heuristics is worth knowing, not because it is misconduct.`;
}

// src/lib/marketAddresses.ts
var SOLANA_CEX_WALLETS = {
  "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9": "Binance",
  "2ojv9BAiHUrvsm9gxDe7fJSzbNZSJcxZvf8dqmWGHG8S": "Binance",
  "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM": "Binance",
  GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7npE: "Coinbase",
  H8sMJSCQxfKiFTCfDR3DUMLPwcRbM61LGFJ8N4dK3WjS: "Coinbase",
  "2AQdpHJ2JpcEgPiATUXjQxA8QmafFegfQwSLWSprPicm": "Coinbase",
  FWznbcNXWQuHTawe9RxvQ2LdCENssh12dsznf4RiouN5: "Kraken",
  AobVSwdW9BbpMdJvTqeCN4hPAmh4rHm7vwLnQ5ATSyrS: "OKX",
  "5VVBHtk2QQBy5rZ2pBdgcb4yj9DBYy8tDksBs2pWnUKr": "Bybit",
  "9un5wqE3q4oCjyrDkwsdD48KteCJitQX5978Vh7KKxHo": "Gate.io",
  "6gnCPhXtLnUD76HjQuSYPENLSZdG8RvDB1pTLM5aLSss": "MEXC"
};
var EVM_CEX_WALLETS = {
  "0x28c6c06298d514db089934071355e5743bf21d60": "Binance",
  "0x21a31ee1afc51d94c2efccaa2092ad1028285549": "Binance",
  "0xdfd5293d8e347dfe59e90efd55b2956a1343963d": "Binance",
  "0x56eddb7aa87536c09ccc2793473599fd21a8b17f": "Binance",
  "0xf977814e90da44bfa03b6295a0616a897441acec": "Binance",
  "0x71660c4005ba85c37ccec55d0c4493e66fe775d3": "Coinbase",
  "0x503828976d22510aad0201ac7ec88293211d23da": "Coinbase",
  "0xddfabcdc4d8ffc6d5beaf154f18b778f892a0740": "Coinbase",
  "0x3cc936b795a188f0e246cbb2d74c5bd190aecf18": "OKX",
  "0x2b5634c42055806a59e9107ed44d43c426e58258": "Kucoin",
  "0x0d0707963952f2fba59dd06f2b425ace40b492fe": "Gate.io",
  "0xf89d7b9c864f589bbF53a82105107622B35EaA40": "Bybit",
  // Merged from the EVM deployer route, which had been carrying a longer list of
  // its own. Every one of these is exchange custody, so holder concentration was
  // counting them as insider wallets on any token they hold float in.
  "0x9696f59e4d72e237be84ffd425dcad154bf96976": "Binance",
  "0x4976a4a02f38326660d17bf34b431dc6e2eb2327": "Binance",
  "0x0681d8db095565fe8a346fa0277bffde9c0edbbf": "Binance",
  "0xddb1b4c4fb1e19bd353bc07d1d46c87d67b8e1e0": "Coinbase",
  "0x3cd751e6b0078be393132286c442345e5dc49699": "Coinbase",
  "0xeb2629a2734e272bcc07bda959863f316f4bd4cf": "Coinbase",
  "0xa9d1e08c7793af67e9d92fe308d5697fb81d3e43": "Coinbase",
  "0x2910543af39aba0cd09dbb2d50200b3e800a63d2": "Kraken",
  "0x0a869d79a7052c7f1b55a8ebabbea3420f0d1e13": "Kraken",
  "0x6cc5f688a315f3dc28a7781717a9a798a59fda7b": "OKX",
  "0x236f9f97e0e62388479bf9e5ba4889e46b0273c3": "OKX",
  "0x1522900b6dafac587d499a862861c0869be6e428": "Bitfinex"
};
var normalize = (address) => {
  const value = String(address ?? "").trim();
  return /^0x[0-9a-fA-F]{40}$/.test(value) ? value.toLowerCase() : value;
};
var lookup = (map, address) => {
  const direct = map[address];
  if (direct) return direct;
  const lowered = normalize(address);
  for (const [candidate, name] of Object.entries(map)) {
    if (normalize(candidate) === lowered) return name;
  }
  return void 0;
};
function classifyMarketAddress(address, context2 = {}) {
  const value = String(address ?? "").trim();
  if (!value) return null;
  const pool = (context2.poolAddresses ?? []).some((candidate) => normalize(candidate) === normalize(value));
  if (pool) return { label: "liquidity pool", kind: "pool" };
  const exchange = lookup(SOLANA_CEX_WALLETS, value) ?? lookup(EVM_CEX_WALLETS, value);
  if (exchange) return { label: exchange, kind: "exchange" };
  const known = context2.knownAccounts?.[value];
  const type = String(known?.type ?? "").toUpperCase();
  if (type === "AMM" || type === "MARKET" || type === "POOL") {
    return { label: known?.name?.trim() || "liquidity pool", kind: "pool" };
  }
  if (type === "LOCKER" || type === "VAULT") {
    return { label: known?.name?.trim() || "locked vault", kind: "locker" };
  }
  if (type === "EXCHANGE" || type === "CEX") {
    return { label: known?.name?.trim() || "exchange", kind: "exchange" };
  }
  return null;
}

// src/token/cloneCheck.ts
var ORDERING_MARGIN_MS = 6e4;
var BURST_WINDOW_MS = 15 * 6e4;
var DEFAULT_LOOKUP_LIMIT = 8;
var LOOKUP_CONCURRENCY = 4;
var SEARCH_TIMEOUT_MS = 8e3;
var LOOKUP_TIMEOUT_MS = 9e3;
var EVM_ADDRESS2 = /^0x[0-9a-f]{40}$/i;
var INVISIBLE = new RegExp("[\\u200B-\\u200F\\u2060\\uFEFF]|\\p{Cc}", "gu");
function normalizeTicker(symbol) {
  if (!symbol || typeof symbol !== "string") return "";
  return symbol.normalize("NFKC").replace(INVISIBLE, "").replace(/\s+/g, " ").trim().toUpperCase();
}
function mintKey(chain, address) {
  return `${chain}:${EVM_ADDRESS2.test(address) ? address.toLowerCase() : address}`;
}
async function rugcheckFirstSeen(mint, chain, fetchImpl2 = fetch) {
  if (chain !== "solana") return null;
  try {
    const response = await fetchImpl2(
      `https://api.rugcheck.xyz/v1/tokens/${encodeURIComponent(mint)}/report`,
      { signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) }
    );
    if (!response.ok) return null;
    const body = await response.json();
    const at = typeof body?.detectedAt === "string" ? Date.parse(body.detectedAt) : NaN;
    return Number.isFinite(at) ? at : null;
  } catch {
    return null;
  }
}
async function searchSameTicker(symbol, fetchImpl2) {
  try {
    const response = await fetchImpl2(
      `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(symbol)}`,
      { signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS) }
    );
    if (!response.ok) return null;
    const body = await response.json();
    return Array.isArray(body?.pairs) ? body.pairs : [];
  } catch {
    return null;
  }
}
function num(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function foldByMint(pairs, ticker) {
  const byMint = /* @__PURE__ */ new Map();
  const deepestPool = /* @__PURE__ */ new Map();
  for (const pair of pairs) {
    const address = pair.baseToken?.address;
    const chain = pair.chainId;
    if (!address || !chain) continue;
    if (normalizeTicker(pair.baseToken?.symbol) !== ticker) continue;
    const key = mintKey(chain, address);
    const created = num(pair.pairCreatedAt);
    const liquidity = num(pair.liquidity?.usd);
    const row = byMint.get(key);
    if (!row) {
      byMint.set(key, {
        mint: address,
        chain,
        pairCreatedAt: created,
        firstSeenAt: created,
        firstSeenBasis: created === null ? "unknown" : "listing",
        liquidityUsd: liquidity,
        marketCapUsd: num(pair.marketCap) ?? num(pair.fdv),
        url: pair.url ?? null
      });
      deepestPool.set(key, liquidity ?? -1);
      continue;
    }
    if (created !== null && (row.pairCreatedAt === null || created < row.pairCreatedAt)) {
      row.pairCreatedAt = created;
      row.firstSeenAt = created;
      row.firstSeenBasis = "listing";
    }
    if (liquidity !== null) row.liquidityUsd = (row.liquidityUsd ?? 0) + liquidity;
    if (liquidity !== null && liquidity > (deepestPool.get(key) ?? -1)) {
      deepestPool.set(key, liquidity);
      row.marketCapUsd = num(pair.marketCap) ?? num(pair.fdv) ?? row.marketCapUsd;
      if (pair.url) row.url = pair.url;
    }
  }
  return byMint;
}
function lookupTargets(audited, peers, limit) {
  const auditedAt = audited.firstSeenAt;
  const earlier = peers.filter((peer) => peer.firstSeenAt !== null && (auditedAt === null || peer.firstSeenAt < auditedAt)).sort((a, b) => (a.firstSeenAt ?? 0) - (b.firstSeenAt ?? 0));
  const deepest = [...peers].sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0));
  const picked = [audited];
  const seen = /* @__PURE__ */ new Set([mintKey(audited.chain, audited.mint)]);
  for (const candidate of [...earlier, ...deepest]) {
    if (picked.length >= limit) break;
    const key = mintKey(candidate.chain, candidate.mint);
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(candidate);
  }
  return picked;
}
async function applyCreationTimes(targets, resolve, fetchImpl2) {
  let cursor = 0;
  const worker = async () => {
    while (cursor < targets.length) {
      const row = targets[cursor++];
      const createdAt = await resolve(row.mint, row.chain, fetchImpl2).catch(() => null);
      if (createdAt === null) continue;
      if (row.pairCreatedAt === null || createdAt <= row.pairCreatedAt + ORDERING_MARGIN_MS) {
        row.firstSeenBasis = "creation";
      }
      row.firstSeenAt = row.firstSeenAt === null ? createdAt : Math.min(row.firstSeenAt, createdAt);
    }
  };
  await Promise.all(Array.from({ length: Math.min(LOOKUP_CONCURRENCY, targets.length) }, worker));
}
var usd = (value) => `$${Math.round(value).toLocaleString("en-US")}`;
var plural = (count, one, many) => count === 1 ? one : many;
function describeSpan(ms, round) {
  const span = Math.max(0, ms);
  if (span < 90 * 6e4) {
    const minutes = Math.max(1, round(span / 6e4));
    return `${minutes} ${plural(minutes, "minute", "minutes")}`;
  }
  if (span < 48 * 36e5) {
    const hours = Math.max(1, round(span / 36e5));
    return `${hours} ${plural(hours, "hour", "hours")}`;
  }
  const days = Math.max(1, round(span / 864e5));
  return `${days} ${plural(days, "day", "days")}`;
}
var COUNT_IS_A_FLOOR = "A clone with no liquidity pool is often not listed at all, so that count is a floor.";
var SWEEP_IS_A_FLOOR = "A clone with no liquidity pool is often not listed at all, so this sweep can miss one.";
var CHECK_ADDRESS = "Check the contract address before you buy.";
function earliestNote(ticker, auditedAt, clones) {
  const burst = clones.filter((clone) => clone.firstSeenAt !== null && clone.firstSeenAt <= auditedAt + BURST_WINDOW_MS);
  const rest2 = clones.length - burst.length;
  const tail = rest2 > 0 ? ` ${rest2} more ${plural(rest2, "has", "have")} used the ticker since. ${COUNT_IS_A_FLOOR}` : ` ${COUNT_IS_A_FLOOR}`;
  if (!burst.length) {
    return `${clones.length} other ${plural(clones.length, "mint uses", "mints use")} the ticker $${ticker}, every one of them first seen after this mint. ${CHECK_ADDRESS}${tail}`;
  }
  const window = describeSpan(
    Math.max(...burst.map((clone) => (clone.firstSeenAt ?? auditedAt) - auditedAt)),
    Math.ceil
  );
  const deepest = Math.max(...burst.map((clone) => clone.liquidityUsd ?? 0));
  const money = deepest > 0 ? `, the largest holding ${usd(deepest)} of liquidity` : ", none of them with any liquidity";
  return `${burst.length} other ${plural(burst.length, "token", "tokens")} using the ticker $${ticker} appeared within ${window} of this one${money}. ${CHECK_ADDRESS}${tail}`;
}
function laterNote(ticker, gapMs, audited, earliest) {
  const theirs = earliest.liquidityUsd ?? 0;
  const ours = audited.liquidityUsd ?? 0;
  let money = "";
  if (theirs > 0) {
    money = ours > 0 ? `, holding ${usd(theirs)} of liquidity against this mint's ${usd(ours)}` : `, holding ${usd(theirs)} of liquidity where this mint has none`;
  }
  return `This is not the first mint using the ticker $${ticker}. Another appeared ${describeSpan(gapMs, Math.floor)} earlier at ${earliest.mint}${money}. ${CHECK_ADDRESS} Which mint the project itself issued is not something these timestamps settle.`;
}
async function checkForClones(input, options = {}) {
  const fetchImpl2 = options.fetchImpl ?? fetch;
  const resolveCreatedAt = options.resolveCreatedAt ?? rugcheckFirstSeen;
  const limit = options.lookupLimit ?? DEFAULT_LOOKUP_LIMIT;
  const ticker = normalizeTicker(input.symbol);
  const chain = input.chain;
  const callerPairCreatedAt = num(input.pairCreatedAt);
  const callerLiquidity = num(input.liquidityUsd);
  if (!ticker || !input.mint || !chain) {
    return {
      audited: "unresolved",
      clones: [],
      checked: false,
      note: "There is no ticker to sweep for, so no same ticker mint has been ruled in or out."
    };
  }
  const pairs = await searchSameTicker(ticker, fetchImpl2);
  if (pairs === null) {
    return {
      audited: "unresolved",
      clones: [],
      checked: false,
      note: `The ticker sweep for $${ticker} did not complete, so no same ticker mint has been ruled in or out.`
    };
  }
  const byMint = foldByMint(pairs, ticker);
  const auditedKey = mintKey(chain, input.mint);
  const audited = byMint.get(auditedKey) ?? {
    mint: input.mint,
    chain,
    pairCreatedAt: callerPairCreatedAt,
    firstSeenAt: callerPairCreatedAt,
    firstSeenBasis: callerPairCreatedAt === null ? "unknown" : "listing",
    liquidityUsd: callerLiquidity,
    marketCapUsd: null,
    url: null
  };
  if (callerPairCreatedAt !== null && (audited.pairCreatedAt === null || callerPairCreatedAt < audited.pairCreatedAt)) {
    audited.pairCreatedAt = callerPairCreatedAt;
    audited.firstSeenAt = audited.firstSeenAt === null ? callerPairCreatedAt : Math.min(audited.firstSeenAt, callerPairCreatedAt);
    audited.firstSeenBasis = "listing";
  }
  if (callerLiquidity !== null) audited.liquidityUsd = callerLiquidity;
  byMint.set(auditedKey, audited);
  const clones = [...byMint.values()].filter((row) => mintKey(row.chain, row.mint) !== auditedKey);
  if (!clones.length) {
    return {
      audited: "only",
      clones: [],
      checked: true,
      note: `No other mint using the ticker $${ticker} is listed on dexscreener. ${SWEEP_IS_A_FLOOR}`
    };
  }
  await applyCreationTimes(lookupTargets(audited, clones, limit), resolveCreatedAt, fetchImpl2);
  clones.sort((a, b) => (a.firstSeenAt ?? Infinity) - (b.firstSeenAt ?? Infinity));
  const auditedAt = audited.firstSeenAt;
  const dated = clones.filter((clone) => clone.firstSeenAt !== null);
  const cohort = `${clones.length} other ${plural(clones.length, "mint uses", "mints use")} the ticker $${ticker}`;
  if (auditedAt === null || !dated.length) {
    return {
      audited: "unresolved",
      clones,
      checked: true,
      note: `${cohort}. There is no public creation record to order them against this mint, so which came first is unsettled. ${CHECK_ADDRESS}`
    };
  }
  const earliest = dated[0];
  if (earliest.firstSeenAt + ORDERING_MARGIN_MS <= auditedAt) {
    const gap = auditedAt - earliest.firstSeenAt;
    if (audited.firstSeenBasis !== "creation") {
      return {
        audited: "unresolved",
        clones,
        checked: true,
        note: `${cohort}, and one at ${earliest.mint} has a public record ${describeSpan(gap, Math.floor)} older than this mint's first listing. A first listing can trail a mint by hours, so that does not establish which was minted first. ${CHECK_ADDRESS}`
      };
    }
    return {
      audited: "later",
      clones,
      checked: true,
      earliestMint: earliest.mint,
      note: laterNote(ticker, gap, audited, earliest)
    };
  }
  if (auditedAt + ORDERING_MARGIN_MS <= earliest.firstSeenAt) {
    return {
      audited: "earliest",
      clones,
      checked: true,
      earliestMint: audited.mint,
      note: earliestNote(ticker, auditedAt, clones)
    };
  }
  return {
    audited: "unresolved",
    clones,
    checked: true,
    note: `${cohort}, first seen within ${describeSpan(Math.abs(auditedAt - earliest.firstSeenAt), Math.ceil)} of this one, too close together to order. ${CHECK_ADDRESS}`
  };
}

// src/lib/retry.ts
async function retryFetch(input, init, attempts = 3, fetchImpl2 = fetch) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      init?.signal?.throwIfAborted();
      const res = await fetchImpl2(input, init);
      if (res.ok || res.status !== 429 && res.status < 500) return res;
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (e) {
      lastErr = e;
    }
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, 300 * 2 ** i));
  }
  throw lastErr;
}
async function retryFetchWithFreshTimeout(input, timeoutMs, init = {}, attempts = 2, fetchImpl2 = fetch) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await fetchImpl2(input, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (response.ok || response.status !== 429 && response.status < 500) return response;
      lastErr = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastErr = error;
    }
    if (i < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** i));
  }
  throw lastErr;
}

// src/token/sources.ts
var GOPLUS_CHAIN = {
  ethereum: "1",
  bsc: "56",
  base: "8453",
  polygon: "137",
  arbitrum: "42161",
  optimism: "10",
  avalanche: "43114",
  fantom: "250",
  cronos: "25",
  zksync: "324",
  linea: "59144",
  scroll: "534352",
  // Robinhood Chain (Arbitrum stack, mainnet Jul 2026). GoPlus has covered it
  // since launch; ARGUS simply never asked, which left every token on this
  // chain with no safety data, no creator, and therefore no sanctions screen.
  robinhood: "4663"
};
var GOPLUS_UNSORTED_HOLDER_CHAINS = /* @__PURE__ */ new Set(["robinhood"]);
var BLOCKSCOUT_API = {
  robinhood: "https://robinhoodchain.blockscout.com"
};
function blockscoutHolderSourceUrl(chain, address) {
  const base = BLOCKSCOUT_API[chain.trim().toLowerCase()];
  return base ? `${base}/api/v2/tokens/${encodeURIComponent(address)}/holders` : null;
}
async function blockscoutContractSource(chain, address, fetchImpl2 = fetch) {
  const base = BLOCKSCOUT_API[chain];
  if (!base) return null;
  try {
    const response = await fetchImpl2(`${base}/api/v2/smart-contracts/${address}`, { signal: AbortSignal.timeout(9e3) });
    if (!response.ok) return null;
    const body = await response.json();
    const sourceCode = typeof body?.source_code === "string" ? body.source_code : "";
    if (!sourceCode) return null;
    return {
      name: typeof body?.name === "string" ? body.name : null,
      isVerified: body?.is_verified === true,
      sourceCode: sourceCode.slice(0, 4e5)
    };
  } catch {
    return null;
  }
}
async function blockscoutHolders(chain, address, fetchImpl2 = fetch) {
  const chainKey = chain.trim().toLowerCase();
  const base = BLOCKSCOUT_API[chainKey];
  if (!base) return null;
  const holderSourceUrl = blockscoutHolderSourceUrl(chainKey, address);
  if (!holderSourceUrl) return null;
  try {
    const [tokenRes, holderRes] = await Promise.all([
      fetchImpl2(`${base}/api/v2/tokens/${address}`, { signal: AbortSignal.timeout(9e3) }),
      fetchImpl2(holderSourceUrl, { signal: AbortSignal.timeout(9e3) })
    ]);
    if (!tokenRes.ok || !holderRes.ok) return null;
    const meta = await tokenRes.json();
    const supply = Number(meta?.total_supply ?? 0);
    if (!Number.isFinite(supply) || supply <= 0) return null;
    const body = await holderRes.json();
    const items = Array.isArray(body?.items) ? body.items : [];
    const rows = [];
    for (const item of items) {
      const value = Number(item?.value ?? 0);
      const hash = item?.address?.hash;
      if (!hash || !Number.isFinite(value) || value <= 0) continue;
      rows.push({ address: hash, percent: value / supply * 100, isContract: item.address?.is_contract === true });
      if (rows.length >= 10) break;
    }
    return rows;
  } catch {
    return null;
  }
}
async function dexByTokenResult(address, fetchImpl2 = fetch) {
  const request = (url, init) => retryFetch(url, init, 3, fetchImpl2);
  try {
    const res = await request(`https://api.dexscreener.com/latest/dex/tokens/${address}`, {
      signal: AbortSignal.timeout(8e3)
    });
    if (!res.ok) return { ok: false, pairs: [] };
    const d = await res.json();
    if (d.pairs !== null && !Array.isArray(d.pairs)) return { ok: false, pairs: [] };
    if (d.pairs?.some((p) => !p || typeof p.chainId !== "string" || typeof p.baseToken?.address !== "string")) return { ok: false, pairs: [] };
    return { ok: true, pairs: d.pairs ?? [] };
  } catch {
    return { ok: false, pairs: [] };
  }
}
var CG_PLATFORM = {
  ethereum: "ethereum",
  eth: "ethereum",
  base: "base",
  solana: "solana",
  bsc: "binance-smart-chain",
  polygon: "polygon-pos",
  arbitrum: "arbitrum-one",
  optimism: "optimistic-ethereum",
  avalanche: "avalanche",
  fantom: "fantom"
};
var CG_DEX = /uniswap|pancake|raydium|sushi|curve|balancer|orca|meteora|aerodrome|camelot|quickswap|trader.?joe|\bdex\b/i;
function cleanBlurb(raw) {
  if (typeof raw !== "string" || !raw.trim()) return null;
  let s = raw.replace(/<[^>]+>/g, " ").replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, "$1").replace(/https?:\/\/\S+/g, "").replace(/[*_`>#]+/g, " ").replace(/&amp;/g, "&").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim();
  if (!s) return null;
  if (s.length > 1600) s = `${s.slice(0, 1597).replace(/\s+\S*$/, "").trim()}\u2026`;
  return s;
}
var CG_TIER1 = /binance|coinbase|kraken|okx|bybit|kucoin|gate|crypto\.?com|bitget|upbit|huobi|htx|mexc/i;
async function coingeckoToken(chain, address, fetchImpl2 = fetch) {
  const request = (url, init) => retryFetch(url, init, 3, fetchImpl2);
  const plat = CG_PLATFORM[chain] ?? chain;
  try {
    const res = await request(`https://api.coingecko.com/api/v3/coins/${plat}/contract/${address}?localization=false&tickers=true&market_data=true&community_data=false&developer_data=false`, {
      signal: AbortSignal.timeout(8e3)
    });
    if (res.status === 404) return { listed: false, id: null, rank: null, mcapUsd: null, marketCount: 0, cexCount: 0, cexNames: [], homepage: null, twitter: null, image: null, description: null, categories: [] };
    if (!res.ok) return null;
    const d = await res.json();
    const tickers = d.tickers ?? [];
    const markets = new Set(tickers.map((t) => t.market?.name).filter(Boolean));
    const cex = new Set(tickers.filter((t) => !CG_DEX.test(t.market?.identifier || t.market?.name || "")).map((t) => t.market?.name).filter(Boolean));
    const cexNames = [...cex].sort((a, b) => (CG_TIER1.test(b) ? 1 : 0) - (CG_TIER1.test(a) ? 1 : 0)).slice(0, 12);
    const homepageValue = (d.links?.homepage ?? []).find((value) => typeof value === "string" && /^https?:\/\//i.test(value));
    const homepage = typeof homepageValue === "string" ? homepageValue : null;
    const tw = typeof d.links?.twitter_screen_name === "string" ? d.links.twitter_screen_name.replace(/^@/, "").trim() : "";
    const twitter = /^[A-Za-z0-9_]{2,30}$/.test(tw) ? tw : null;
    const image = d.image?.large ?? d.image?.small ?? d.image?.thumb ?? null;
    const athPrice = d.market_data?.ath?.usd;
    const athDate = d.market_data?.ath_date?.usd;
    const athDrawdown = d.market_data?.ath_change_percentage?.usd;
    const ath = athPrice != null || athDate != null || athDrawdown != null ? {
      priceUsd: typeof athPrice === "number" && Number.isFinite(athPrice) ? athPrice : null,
      date: typeof athDate === "string" && athDate.trim() ? athDate : null,
      drawdownPct: typeof athDrawdown === "number" && Number.isFinite(athDrawdown) ? athDrawdown : null
    } : null;
    return {
      listed: true,
      id: typeof d.id === "string" && d.id ? d.id : null,
      rank: d.market_cap_rank ?? null,
      mcapUsd: d.market_data?.market_cap?.usd ?? null,
      marketCount: markets.size,
      cexCount: cex.size,
      cexNames,
      homepage,
      twitter,
      image,
      description: cleanBlurb(d.description?.en),
      categories: (d.categories ?? []).filter((c) => typeof c === "string" && c.trim().length > 0).slice(0, 12),
      ath
    };
  } catch {
    return null;
  }
}
async function dexByPairResult(chain, pair, fetchImpl2 = fetch) {
  const request = (url, init) => retryFetch(url, init, 3, fetchImpl2);
  try {
    const res = await request(`https://api.dexscreener.com/latest/dex/pairs/${chain}/${pair}`, {
      signal: AbortSignal.timeout(8e3)
    });
    if (!res.ok) return { ok: false, pair: null };
    const d = await res.json();
    return { ok: true, pair: d.pair ?? d.pairs?.[0] ?? null };
  } catch {
    return { ok: false, pair: null };
  }
}
function pickPair(pairs, wantAddress) {
  if (!pairs.length) return null;
  const byLiq = [...pairs].sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
  if (wantAddress) {
    const exact = byLiq.find((p) => p.baseToken?.address === wantAddress);
    if (exact) return exact;
    const match = /^0x[0-9a-f]{40}$/i.test(wantAddress) ? byLiq.find((p) => p.baseToken?.address?.toLowerCase() === wantAddress.toLowerCase()) : void 0;
    if (match) return match;
    return null;
  }
  return byLiq[0];
}
function hasCompleteGoplusTradeability(result) {
  const reported = (value) => typeof value === "string" && value.trim().length > 0;
  return result?.is_in_dex === "1" && reported(result.buy_tax) && reported(result.sell_tax) && reported(result.cannot_sell_all);
}
async function honeypotIs(chainId, address, fetchImpl2 = fetch) {
  const request = (url, init) => retryFetch(url, init, 3, fetchImpl2);
  try {
    const res = await request(`https://api.honeypot.is/v2/IsHoneypot?address=${address}&chainID=${chainId}`);
    if (!res.ok) return null;
    const d = await res.json();
    return {
      isHoneypot: !!d.honeypotResult?.isHoneypot,
      simSuccess: !!d.simulationSuccess,
      buyTax: d.simulationResult?.buyTax ?? 0,
      sellTax: d.simulationResult?.sellTax ?? 0,
      flags: (d.flags ?? []).map((flag) => typeof flag === "string" ? flag : flag.description ?? flag.flag ?? String(flag))
    };
  } catch {
    return null;
  }
}
async function goplusSolana(mint, fetchImpl2 = fetch) {
  const request = (url, init) => retryFetch(url, init, 3, fetchImpl2);
  try {
    const res = await request(`https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=${mint}`);
    if (!res.ok) return null;
    const d = await res.json();
    const row = d.result?.[mint];
    return row ?? null;
  } catch {
    return null;
  }
}
var SOLANA_ADDRESS2 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
function supplySharePercent(amount, supply) {
  const balance = Number(amount);
  const total = Number(supply);
  if (!Number.isFinite(balance) || balance < 0) return null;
  if (!Number.isFinite(total) || total <= 0) return null;
  const percent = balance / total * 100;
  return percent >= 0 && percent <= 100 ? percent : null;
}
function lockedShare(lpLockedPct, markets) {
  const percent = boundedPercent(lpLockedPct);
  if (percent == null) return null;
  if (percent > 0) return percent;
  const marketsSeen = Array.isArray(markets) ? markets.length : 0;
  return marketsSeen > 0 ? percent : null;
}
function boundedPercent(value) {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const percent = Number(value);
  if (!Number.isFinite(percent)) return null;
  return percent >= 0 && percent <= 100 ? percent : null;
}
function finiteCount(value) {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? count : null;
}
function parseKnownAccounts(value) {
  const accounts = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return accounts;
  for (const [address, entry] of Object.entries(value)) {
    if (!address.trim() || !entry || typeof entry !== "object") continue;
    const record2 = entry;
    accounts[address] = {
      ...typeof record2.name === "string" ? { name: record2.name } : {},
      ...typeof record2.type === "string" ? { type: record2.type } : {}
    };
  }
  return accounts;
}
function largestInsiderClusterPercent(networks) {
  const measured = networks.map((network) => network.percent).filter((percent) => percent != null);
  return measured.length ? Math.max(...measured) : null;
}
async function rugcheckReport(mint, fetchImpl2 = fetch) {
  try {
    const res = await retryFetchWithFreshTimeout(`https://api.rugcheck.xyz/v1/tokens/${encodeURIComponent(mint)}/report`, 15e3, {
      headers: { accept: "application/json" }
    }, 2, fetchImpl2);
    if (!res.ok) return null;
    const d = await res.json();
    const creator = typeof d?.creator === "string" && SOLANA_ADDRESS2.test(d.creator.trim()) ? d.creator.trim() : null;
    const supply = d?.token?.supply;
    const networks = Array.isArray(d?.insiderNetworks) ? d.insiderNetworks : [];
    return {
      creator,
      // With no creator there is nobody for a balance to belong to, and a bare
      // zero would read as "the creator sold out" rather than "not measured".
      creatorPercent: creator ? supplySharePercent(d?.creatorBalance, supply) : null,
      lpLockedPct: lockedShare(d?.lpLockedPct, d?.markets),
      rugged: d?.rugged === true,
      knownAccounts: parseKnownAccounts(d?.knownAccounts),
      insiderNetworks: networks.map((network) => ({
        // Null, not zero. A cluster whose wallet count RugCheck did not report
        // is not a cluster of nobody, and "0 linked wallets" is the reading that
        // would talk a reader out of looking.
        size: finiteCount(network?.size ?? network?.activeAccounts),
        percent: supplySharePercent(network?.tokenAmount, supply)
      })),
      graphInsidersDetected: finiteCount(d?.graphInsidersDetected)
    };
  } catch {
    return null;
  }
}
async function goplus(chainId, address, fetchImpl2 = fetch) {
  const request = (url, init) => retryFetch(url, init, 3, fetchImpl2);
  const once = async () => {
    try {
      const res = await request(`https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${address}`);
      if (!res.ok) return null;
      const d = await res.json();
      return d.result?.[address.toLowerCase()] ?? d.result?.[address] ?? null;
    } catch {
      return null;
    }
  };
  let row = await once();
  if (row && !(row.holders && row.holders.length)) {
    await new Promise((r) => setTimeout(r, 700));
    const retry = await once();
    if (retry?.holders?.length) row = retry;
  }
  return row;
}

// src/token/audit.ts
function deployerRoleLabel(attribution, form = "title") {
  const proven = attribution?.kind === "deployer";
  const base = proven ? "Deployer" : "Creator or authority";
  return form === "wallet" ? `${base} wallet` : base;
}
var EVM_ADDRESS3 = /^0x[0-9a-fA-F]{40}$/;
function sameWalletAddress(a, b) {
  if (EVM_ADDRESS3.test(a) && EVM_ADDRESS3.test(b)) return a.toLowerCase() === b.toLowerCase();
  return a === b;
}
var SEVERE_RISK_CATEGORY = /sanction|hack|theft|exploit|ransom|scam|phish|stolen|fraud|terror/i;
var FACTORY_ATTRIBUTION_METHOD = "contract factory";
function deployerWalletAddress(d) {
  if (!d.deployer) return null;
  if (d.deployerAttribution?.method === FACTORY_ATTRIBUTION_METHOD) return null;
  return d.deployer;
}
async function resolveEvmCreatorKind(chain, creator, fetchImpl2 = fetch) {
  const origin = globalThis.location?.origin;
  if (!origin && !hasThreatApiContext()) return "unknown";
  try {
    const r = await fetchImpl2(`/api/bytecode?address=${encodeURIComponent(creator)}&chain=${encodeURIComponent(chain)}`, { signal: AbortSignal.timeout(12e3) });
    if (!r.ok) return "unknown";
    const d = await r.json();
    if (d?.available !== true || typeof d.isContract !== "boolean") return "unknown";
    return d.isContract ? "contract" : "wallet";
  } catch {
    return "unknown";
  }
}
async function screenDeployerRisk(address, fetchImpl2 = fetch) {
  if (!arkhamProviderEnabled()) return void 0;
  if (!address || address.length < 8) return void 0;
  const origin = globalThis.location?.origin;
  if (!origin && !hasThreatApiContext()) return void 0;
  const completedAt = (/* @__PURE__ */ new Date()).toISOString();
  try {
    const r = await fetchImpl2(`/api/deployer-risk?address=${encodeURIComponent(address)}`, { signal: AbortSignal.timeout(18e3) });
    if (!r.ok) return { available: false, paths: [], completedAt };
    const d = await r.json();
    if (d?.available !== true) return { available: false, paths: [], completedAt };
    return {
      available: true,
      paths: Array.isArray(d.paths) ? d.paths : [],
      briefing: d.briefing,
      completedAt
    };
  } catch {
    return { available: false, paths: [], completedAt };
  }
}
var SIGNED_THE_CREATION = /* @__PURE__ */ new Set(["mint feePayer", "creation-tx fee payer"]);
async function resolveDeployerViaRoute(mint, fetchImpl2 = fetch) {
  const origin = globalThis.location?.origin;
  if (!origin && !hasThreatApiContext()) return null;
  try {
    const r = await fetchImpl2(`/api/resolve-deployer?mint=${encodeURIComponent(mint)}`, { signal: AbortSignal.timeout(2e4) });
    if (!r.ok) return null;
    const d = await r.json();
    const address = typeof d?.deployer === "string" ? d.deployer.trim() : "";
    if (!address) return null;
    const via = typeof d?.via === "string" && d.via.trim() ? d.via.trim() : "resolver";
    return { address, source: "helius", method: via, kind: SIGNED_THE_CREATION.has(via) ? "deployer" : "attributed" };
  } catch {
    return null;
  }
}
async function screenAddressSanctions(chain, addresses, fetchImpl2 = fetch) {
  const unique = [...new Set(addresses.filter((a) => typeof a === "string" && a.length > 8))].slice(0, 40);
  if (!unique.length) {
    return {
      available: false,
      checked: 0,
      sanctioned: [],
      completedAt: (/* @__PURE__ */ new Date()).toISOString(),
      reason: "no_screenable_addresses"
    };
  }
  const origin = globalThis.location?.origin;
  if (!origin && !hasThreatApiContext()) return void 0;
  const completedAt = (/* @__PURE__ */ new Date()).toISOString();
  try {
    const r = await fetchImpl2(
      `/api/sanctions?addresses=${encodeURIComponent(unique.join(","))}&chain=${encodeURIComponent(chain)}`,
      { signal: AbortSignal.timeout(9e3) }
    );
    if (!r.ok) return { available: false, checked: unique.length, sanctioned: [], completedAt, reason: "list_unavailable" };
    const d = await r.json();
    if (d?.available !== true) return { available: false, checked: unique.length, sanctioned: [], completedAt, reason: "list_unavailable" };
    return {
      available: true,
      checked: typeof d.checked === "number" ? d.checked : unique.length,
      listSize: typeof d.listSize === "number" ? d.listSize : void 0,
      sanctioned: Array.isArray(d.sanctioned) ? d.sanctioned.filter((a) => typeof a === "string") : [],
      completedAt
    };
  } catch {
    return { available: false, checked: unique.length, sanctioned: [], completedAt, reason: "list_unavailable" };
  }
}
var clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
var num2 = (s) => s == null || s === "" ? null : Number(s);
var t1 = (s) => s === "1";
var solFlag = (x) => x?.status === "1";
function band(score) {
  return score >= 70 ? "PASS" : score >= 40 ? "CAUTION" : "FAIL";
}
function handleFromUrl(url) {
  const handle = officialXProfileHandle(url);
  return handle ? "@" + handle.toLowerCase() : null;
}
var isBurnAddr = (a) => !!a && (/^0x0+$/.test(a) || /0*dead$/i.test(a.replace(/^0x/, "")));
var isBurnTag = (t) => /null|burn|dead|0x0{4,}/i.test(t ?? "");
function evmSafety(gp, sim) {
  const s = sim;
  const goplusTradeabilityAssessed = hasCompleteGoplusTradeability(gp);
  const simulationCompleted = s?.simSuccess === true;
  const topHolderPct = gp?.holders?.length ? Number(gp.holders[0].percent) * 100 : null;
  let lpBurnedPct = 0, lpLockedPct = 0, lpTopUnlockedEoaPct = 0;
  let lpRowsSeen = 0;
  for (const h of gp?.lp_holders ?? []) {
    const pct2 = Number(h.percent) * 100;
    if (!Number.isFinite(pct2) || pct2 < 0 || pct2 > 100) continue;
    lpRowsSeen += 1;
    if (!Number.isFinite(pct2)) continue;
    if (isBurnAddr(h.address) || isBurnTag(h.tag)) lpBurnedPct += pct2;
    else if (h.is_locked === 1) lpLockedPct += pct2;
    else if (h.is_contract !== 1) lpTopUnlockedEoaPct = Math.max(lpTopUnlockedEoaPct, pct2);
  }
  const lpLocked = lpBurnedPct + lpLockedPct >= 50;
  const creatorShare = num2(gp?.creator_percent);
  const ownerAddressReported = typeof gp?.owner_address === "string";
  const ownerAddress = (gp?.owner_address ?? "").trim();
  const hiddenOwner = t1(gp?.hidden_owner);
  const takeBack = t1(gp?.can_take_back_ownership);
  return {
    available: !!gp && Object.values(gp).some((v) => v != null && v !== "") || simulationCompleted,
    contractPropertiesAssessed: !!gp && [gp.is_open_source, gp.is_mintable, gp.transfer_pausable, gp.selfdestruct].every((v) => v === "0" || v === "1") && typeof gp.owner_address === "string",
    taxesAssessed: simulationCompleted ? Number.isFinite(s?.buyTax) && Number.isFinite(s?.sellTax) : [num2(gp?.buy_tax), num2(gp?.sell_tax)].every((v) => v != null && Number.isFinite(v) && v >= 0),
    holderCountAssessed: num2(gp?.holder_count) != null && Number.isFinite(num2(gp?.holder_count)),
    simChecked: simulationCompleted,
    tradeabilityAssessed: simulationCompleted || goplusTradeabilityAssessed,
    tradeabilityMethod: simulationCompleted ? "simulation" : goplusTradeabilityAssessed ? "goplus-screen" : void 0,
    honeypot: t1(gp?.is_honeypot) || (s?.isHoneypot ?? false),
    honeypotOnchain: t1(gp?.is_honeypot) || t1(gp?.cannot_sell_all),
    serialScammerCreator: t1(gp?.honeypot_with_same_creator),
    mintable: t1(gp?.is_mintable),
    freezable: false,
    nonTransferable: false,
    // GoPlus omits owner_address when it cannot detect an owner (unmeasured,
    // not renounced), reports the visible 0x0 while hidden_owner says a
    // concealed controller survives the renounce, and can_take_back_ownership
    // says the renounce is reversible. "Renounced" is only true when the owner
    // was measured AND no owner power survives; every other case leaves the
    // owner-power vectors (balance rewrite, blacklist, tax change) live.
    ownerAssessed: ownerAddressReported,
    ownerRenounced: ownerAddressReported && (ownerAddress === "" || /^0x0+$/.test(ownerAddress)) && !hiddenOwner && !takeBack,
    takeBack,
    hiddenOwner,
    selfdestruct: t1(gp?.selfdestruct),
    pausable: t1(gp?.transfer_pausable),
    openSource: t1(gp?.is_open_source),
    cannotSellAll: t1(gp?.cannot_sell_all),
    metadataMutable: false,
    buyTax: s?.simSuccess ? s.buyTax : (num2(gp?.buy_tax) ?? 0) * 100,
    sellTax: s?.simSuccess ? s.sellTax : (num2(gp?.sell_tax) ?? 0) * 100,
    holderCount: num2(gp?.holder_count) ?? 0,
    topHolderPct,
    lpLocked,
    lpBurnedPct,
    lpLockedPct,
    lpTopUnlockedEoaPct,
    balanceMutable: false,
    transferHook: false,
    transferFee: false,
    proxy: t1(gp?.is_proxy),
    slippageModifiable: t1(gp?.slippage_modifiable) || t1(gp?.personal_slippage_modifiable),
    blacklist: t1(gp?.is_blacklisted),
    tradingCooldown: t1(gp?.trading_cooldown),
    externalCall: t1(gp?.external_call),
    ownerChangeBalance: t1(gp?.owner_change_balance),
    creatorPercent: (creatorShare ?? 0) * 100,
    creatorPercentAssessed: creatorShare != null && Number.isFinite(creatorShare),
    lpAssessed: lpRowsSeen > 0
  };
}
function recordObservedTradeability(safety, market) {
  if (safety.tradeabilityAssessed || market.buys24h <= 0 || market.sells24h <= 0 || market.liquidityUsd <= 0) {
    return safety;
  }
  return {
    ...safety,
    tradeabilityAssessed: true,
    tradeabilityMethod: "observed-market",
    observedBuys24h: market.buys24h,
    observedSells24h: market.sells24h
  };
}
function solanaSafety(sol) {
  const topHolderPct = sol?.holders?.length ? Number(sol.holders[0].percent) * 100 : null;
  let lpLockedPct = 0, lpTopUnlockedEoaPct = 0;
  let lpRowsSeen = 0;
  for (const h of sol?.lp_holders ?? []) {
    const pct2 = Number(h.percent) * 100;
    if (!Number.isFinite(pct2) || pct2 < 0 || pct2 > 100) continue;
    lpRowsSeen += 1;
    if (h.is_locked === 1) lpLockedPct += pct2;
    else lpTopUnlockedEoaPct = Math.max(lpTopUnlockedEoaPct, pct2);
  }
  const lpLocked = lpLockedPct >= 50;
  const mintable = solFlag(sol?.mintable);
  const freezable = solFlag(sol?.freezable);
  return {
    available: !!sol && Object.values(sol).some((v) => v != null && v !== ""),
    contractPropertiesAssessed: !!sol && [sol.mintable?.status, sol.freezable?.status, sol.metadata_mutable?.status].every((v) => v === "0" || v === "1") && Array.isArray(sol.transfer_hook),
    taxesAssessed: sol?.transfer_fee != null && typeof sol.transfer_fee === "object",
    holderCountAssessed: num2(sol?.holder_count) != null && Number.isFinite(num2(sol?.holder_count)),
    simChecked: false,
    honeypot: !!sol?.non_transferable && sol.non_transferable === "1",
    honeypotOnchain: sol?.non_transferable === "1",
    serialScammerCreator: false,
    // GoPlus's same-creator honeypot flag is EVM-only
    mintable,
    freezable,
    nonTransferable: sol?.non_transferable === "1",
    ownerAssessed: [sol?.mintable?.status, sol?.freezable?.status].every((v) => v === "0" || v === "1"),
    ownerRenounced: !mintable && !freezable,
    // both authorities revoked
    takeBack: false,
    hiddenOwner: false,
    selfdestruct: solFlag(sol?.closable),
    pausable: false,
    openSource: true,
    // n/a on Solana SPL; not penalised
    cannotSellAll: false,
    metadataMutable: solFlag(sol?.metadata_mutable),
    buyTax: 0,
    sellTax: 0,
    holderCount: num2(sol?.holder_count) ?? 0,
    topHolderPct,
    lpLocked,
    lpBurnedPct: 0,
    lpLockedPct,
    lpTopUnlockedEoaPct,
    lpAssessed: lpRowsSeen > 0,
    balanceMutable: solFlag(sol?.balance_mutable_authority),
    transferHook: (sol?.transfer_hook?.length ?? 0) > 0,
    transferFee: Object.keys(sol?.transfer_fee ?? {}).length > 0,
    proxy: false,
    slippageModifiable: false,
    blacklist: false,
    tradingCooldown: false,
    // GoPlus has no creator balance on this chain. The audit fills it in from
    // RugCheck once a creator resolves; until then it stays unmeasured, because
    // a hardcoded 0 published "creator holds nothing" about every Solana token.
    externalCall: false,
    ownerChangeBalance: false,
    creatorPercent: 0,
    creatorPercentAssessed: false
  };
}
function emptySafety() {
  return {
    available: false,
    contractPropertiesAssessed: false,
    simChecked: false,
    honeypot: false,
    honeypotOnchain: false,
    serialScammerCreator: false,
    mintable: false,
    freezable: false,
    nonTransferable: false,
    ownerRenounced: false,
    takeBack: false,
    hiddenOwner: false,
    selfdestruct: false,
    pausable: false,
    openSource: false,
    cannotSellAll: false,
    metadataMutable: false,
    buyTax: 0,
    sellTax: 0,
    holderCount: 0,
    topHolderPct: null,
    lpLocked: false,
    lpBurnedPct: 0,
    lpLockedPct: 0,
    lpTopUnlockedEoaPct: 0,
    balanceMutable: false,
    transferHook: false,
    transferFee: false,
    proxy: false,
    slippageModifiable: false,
    blacklist: false,
    tradingCooldown: false,
    externalCall: false,
    ownerChangeBalance: false,
    creatorPercent: 0,
    creatorPercentAssessed: false,
    lpAssessed: false
  };
}
var _cache = /* @__PURE__ */ new Map();
var CACHE_TTL = 6e4;
async function auditToken(input, emit, opts) {
  if (input.kind !== "token") return null;
  const cacheRef = input.via === "evm" ? input.ref.toLowerCase() : input.ref;
  const key = `${opts?.chain ?? input.chain ?? ""}:${input.via}:${cacheRef}:${opts?.skipSim ? 1 : 0}:${opts?.collectSocialActivity ? 1 : 0}:${opts?.collectShipping ? 1 : 0}`;
  const hit = opts?.force ? void 0 : _cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.d;
  const signal = opts?.deadlineAt != null ? AbortSignal.any([...opts.signal ? [opts.signal] : [], AbortSignal.timeout(Math.max(0, opts.deadlineAt - Date.now()))]) : opts?.signal;
  signal?.throwIfAborted();
  const baseFetch = opts?.fetchImpl ?? fetch;
  const fetchImpl2 = (url, init) => {
    signal?.throwIfAborted();
    return baseFetch(url, { ...init, signal: signal ? AbortSignal.any([signal, ...init?.signal ? [init.signal] : []]) : init?.signal });
  };
  const d = await runTokenAudit(input, emit, { ...opts, signal, fetchImpl: fetchImpl2 });
  signal?.throwIfAborted();
  _cache.set(key, { at: Date.now(), d });
  return d;
}
async function runTokenAudit(input, emit, opts) {
  if (input.kind !== "token") return null;
  const fetcher = opts?.fetchImpl ?? fetch;
  const trace = [];
  const step = (s2) => {
    opts?.signal?.throwIfAborted();
    trace.push(s2);
    emit?.(s2);
  };
  step({ phase: "P0 \xB7 Intake", label: "Resolve token", detail: `Resolving ${input.ref.slice(0, 42)} on DexScreener\u2026`, tone: "neutral" });
  let pair = null;
  let allPairs = [];
  if (input.via === "dexscreener") {
    const m = input.ref.match(/dexscreener\.com\/([a-z0-9]+)\/([a-zA-Z0-9]+)/i);
    if (m) {
      const resolved = await dexByPairResult(m[1], m[2], fetcher);
      if (!resolved.ok) throw new Error("token_market_unavailable");
      pair = resolved.pair;
      if (pair && (pair.chainId !== m[1] || !sameWalletAddress(pair.pairAddress ?? "", m[2]))) throw new Error("token_market_identity_mismatch");
    }
    if (!pair && m) {
      const resolved = await dexByTokenResult(m[2], fetcher);
      if (!resolved.ok) throw new Error("token_market_unavailable");
      allPairs = resolved.pairs.filter((p) => p.chainId === m[1]);
      pair = pickPair(allPairs, m[2]);
    }
  } else {
    const resolved = await dexByTokenResult(input.ref, fetcher);
    if (!resolved.ok) throw new Error("token_market_unavailable");
    allPairs = resolved.pairs.filter((p) => input.via === "solana" ? p.chainId === "solana" : p.chainId !== "solana");
    if (opts?.chain ?? input.chain) allPairs = allPairs.filter((p) => p.chainId === (opts?.chain ?? input.chain));
    pair = pickPair(allPairs, input.ref);
  }
  if (!pair && input.via === "solana" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(input.ref)) {
    pair = { chainId: "solana", dexId: "unlisted", pairAddress: "", baseToken: { address: input.ref, name: input.ref, symbol: "TOKEN" } };
  }
  if (!pair || !pair.baseToken) {
    step({ phase: "P0 \xB7 Intake", label: "Not found", detail: "No DEX pair found for this contract.", tone: "warn" });
    return null;
  }
  const address = pair.baseToken.address;
  const chain = pair.chainId;
  const liquidityUsd = pair.liquidity?.usd ?? 0;
  const fdv = pair.marketCap ?? pair.fdv ?? 0;
  const fullyDilutedValuation = pair.fdv ?? pair.marketCap ?? 0;
  const vol24 = pair.volume?.h24 ?? 0;
  const buys = pair.txns?.h24?.buys ?? 0;
  const sells = pair.txns?.h24?.sells ?? 0;
  const pc24 = pair.priceChange?.h24 ?? 0;
  const ageDays = pair.pairCreatedAt ? (Date.now() - pair.pairCreatedAt) / 864e5 : void 0;
  const volLiq = liquidityUsd > 0 ? vol24 / liquidityUsd : 0;
  const washSignature = pair.priceChange?.h24 != null && Number.isFinite(pair.priceChange.h24) && volLiq >= 15 && Math.abs(pc24) < 10 && buys + sells >= 50;
  step({ phase: "Market", label: `$${pair.baseToken.symbol}`, detail: `liquidity $${Math.round(liquidityUsd).toLocaleString()}, 24h vol $${Math.round(vol24).toLocaleString()}, mcap $${Math.round(fdv).toLocaleString()}`, source: "dexscreener", tone: liquidityUsd < 15e3 ? "warn" : "neutral" });
  const gpChain = GOPLUS_CHAIN[chain];
  let safety = emptySafety();
  let gpEvm = null;
  let sol = null;
  let explorerHolders = null;
  let contractSource = null;
  let deployerAttribution = null;
  let rugcheck = null;
  let lpLockSource = "goplus";
  if (chain === "solana") {
    step({ phase: "Contract", label: "Solana safety", detail: "GoPlus Solana: mint authority, freeze authority, transfer hooks, holders\u2026", tone: "neutral" });
    sol = await goplusSolana(address, fetcher);
    safety = solanaSafety(sol);
    if (pair.dexId === "unlisted") {
      if (!safety.available) return null;
      pair.baseToken.name = sol?.metadata?.name || input.ref;
      pair.baseToken.symbol = sol?.metadata?.symbol || "TOKEN";
    }
    const goplusCreator = (sol?.creators ?? []).map((c) => c?.address).find((a) => typeof a === "string" && a.trim().length > 0)?.trim() ?? null;
    const routeResolver = goplusCreator || opts?.skipSim ? Promise.resolve(null) : resolveDeployerViaRoute(address, fetcher).catch(() => null);
    const [routed, rug] = await Promise.all([
      routeResolver,
      rugcheckReport(address, fetcher).catch(() => null)
    ]);
    rugcheck = rug;
    deployerAttribution = goplusCreator ? { address: goplusCreator, source: "goplus", method: "metadata creator", kind: "attributed" } : routed ?? (rug?.creator ? { address: rug.creator, source: "rugcheck", method: "creator field", kind: "attributed" } : null);
    if (deployerAttribution && rug?.creator === deployerAttribution.address && rug.creatorPercent != null) {
      safety = { ...safety, creatorPercent: rug.creatorPercent, creatorPercentAssessed: true };
    }
    if (!safety.lpAssessed && rug?.lpLockedPct != null) {
      safety = { ...safety, lpLockedPct: rug.lpLockedPct, lpLocked: rug.lpLockedPct >= 50, lpAssessed: true };
      lpLockSource = "rugcheck";
      step({
        phase: "Contract",
        label: "LP lock",
        detail: `RugCheck reports ${rug.lpLockedPct.toFixed(1)}% of the liquidity locked.`,
        source: "rugcheck",
        tone: rug.lpLockedPct >= 50 ? "good" : "warn"
      });
    }
    step(deployerAttribution ? {
      phase: "Contract",
      label: deployerRoleLabel(deployerAttribution),
      detail: `${deployerAttribution.address} via ${deployerAttribution.source} ${deployerAttribution.method}${safety.creatorPercentAssessed ? `, holding ${safety.creatorPercent.toFixed(2)}% of supply` : ", holdings not reported"}.`,
      source: deployerAttribution.source,
      tone: "neutral"
    } : { phase: "Contract", label: "Deployer unresolved", detail: "No source named a creator for this mint, so deployer forensics could not run.", tone: "warn" });
  } else if (gpChain) {
    step({ phase: "Contract", label: opts?.skipSim ? "Safety scan" : "Safety + simulation", detail: opts?.skipSim ? "GoPlus: honeypot, mint, ownership, tax, holders\u2026" : "GoPlus + honeypot.is buy/sell simulation\u2026", tone: "neutral" });
    const [gp, sim, explorer, source] = await Promise.all([
      goplus(gpChain, address, fetcher),
      opts?.skipSim ? Promise.resolve(null) : honeypotIs(gpChain, address, fetcher),
      // Where GoPlus cannot order holders, the chain's own explorer is the
      // only correct distribution source. Runs in parallel: no added latency.
      GOPLUS_UNSORTED_HOLDER_CHAINS.has(chain) ? blockscoutHolders(chain, address, fetcher) : Promise.resolve(null),
      // What the deployer wrote about their own contract. Free, and the only
      // place an intent to defeat safety scanners is ever stated outright.
      blockscoutContractSource(chain, address, fetcher)
    ]);
    gpEvm = gp;
    explorerHolders = explorer;
    contractSource = source;
    safety = evmSafety(gp, sim);
    safety = recordObservedTradeability(safety, { buys24h: buys, sells24h: sells, liquidityUsd });
    const evmCreator = gp?.creator_address?.trim();
    const evmOwner = gp?.owner_address?.trim();
    const creatorKind = evmCreator && !sameWalletAddress(evmCreator, address) ? await resolveEvmCreatorKind(chain, evmCreator, fetcher) : "unknown";
    deployerAttribution = evmCreator ? creatorKind === "contract" ? { address: evmCreator, source: "goplus", method: FACTORY_ATTRIBUTION_METHOD, kind: "attributed" } : { address: evmCreator, source: "goplus", method: "contract creator", kind: "deployer" } : evmOwner && !/^0x0+$/.test(evmOwner) ? { address: evmOwner, source: "goplus", method: "current owner", kind: "attributed" } : null;
    if (creatorKind === "contract") {
      step({
        phase: "Contract",
        label: "Factory-minted",
        detail: `The creator record ${evmCreator.slice(0, 10)}\u2026 is a contract (a launchpad factory), not a wallet. Deployer history, sell-structure and funding-trace checks are not attributed to it.`,
        source: "goplus",
        tone: "neutral"
      });
    }
    if (explorerHolders?.length) {
      safety = { ...safety, topHolderPct: explorerHolders[0].percent };
    } else if (GOPLUS_UNSORTED_HOLDER_CHAINS.has(chain)) {
      safety = { ...safety, topHolderPct: null };
    }
  } else {
    step({ phase: "Contract", label: "Limited", detail: `On-chain safety not available for ${chain} keyless; scored on market data only.`, tone: "warn" });
  }
  const findings = [];
  const caps = [];
  const s = safety;
  let cg = null;
  if (!opts?.skipSim) {
    step({ phase: "Corroborate", label: "CoinGecko cross-check", detail: "Independent listing, CEX markets, market-cap vs FDV\u2026", tone: "neutral" });
    cg = await coingeckoToken(chain, address, fetcher);
  }
  const provablySellable = sells >= 10 && liquidityUsd >= 25e4;
  const broadlyTraded = (cg?.cexCount ?? 0) >= 5 || provablySellable;
  if (s.available) {
    if (s.honeypot) {
      const simOnly = !s.honeypotOnchain && !s.cannotSellAll;
      if (simOnly && broadlyTraded) {
        const why = (cg?.cexCount ?? 0) >= 5 ? `${cg.cexCount} centralized markets` : `${sells} on-chain sells against $${Math.round(liquidityUsd).toLocaleString()} liquidity in 24h`;
        findings.push({ claim: `honeypot.is reported a failed sell simulation, but the GoPlus on-chain check and ${why} contradict it. ARGUS treats this as a simulation artifact, not a honeypot.`, tone: "warn", source: "argus" });
      } else {
        caps.push([10, "honeypot_confirmed"]);
        findings.push({ claim: s.nonTransferable ? "Non-transferable token: holders cannot move it." : "Honeypot: the contract blocks selling.", tone: "bad", source: s.honeypotOnchain ? "goplus" : "sim" });
      }
    }
    if (s.cannotSellAll) caps.push([10, "cannot_sell_all"]);
    const cexN = cg?.cexCount ?? 0;
    const mcap = fdv;
    const established = cexN >= 5 || cexN >= 3 && mcap >= 1e7 || cexN >= 1 && mcap >= 1e8;
    const authorityTone = established ? "warn" : "bad";
    const govNote = established ? " On a token with real centralized-exchange listings this is typically a governed emissions/ops mechanism, not a rug setup. Confirm the controller." : "";
    if (s.mintable) {
      if (!established) caps.push([35, "mint_authority_active"]);
      findings.push({ claim: `Mint authority is live: supply can be minted.${govNote}`, tone: authorityTone, source: chain === "solana" ? "goplus-sol" : "goplus" });
    }
    if (s.freezable) {
      if (!established) caps.push([35, "freeze_authority_active"]);
      findings.push({ claim: `Freeze authority is live: the team can freeze token accounts.${govNote}`, tone: authorityTone, source: "goplus-sol" });
    }
    if (s.takeBack || s.hiddenOwner) {
      if (s.hiddenOwner) {
        caps.push([35, "reclaimable_ownership"]);
        findings.push({ claim: "Hidden owner detected.", tone: "bad", source: "goplus" });
      } else {
        if (!established) caps.push([35, "reclaimable_ownership"]);
        findings.push({ claim: `Ownership can be reclaimed after renouncement.${govNote}`, tone: authorityTone, source: "goplus" });
      }
    }
    if (s.selfdestruct) findings.push({ claim: "Contract can self-destruct / be closed.", tone: "bad", source: "goplus" });
    for (const evasion of detectScannerEvasion(contractSource?.sourceCode)) {
      const concealed = evasion.kind === "concealment";
      findings.push({ claim: scannerEvasionClaim(evasion), tone: concealed ? "bad" : "warn", source: "contract source" });
      if (concealed) caps.push([55, "documented_scanner_concealment"]);
    }
    if (s.serialScammerCreator) {
      caps.push([25, "serial_scammer_creator"]);
      findings.push({ claim: "The wallet that deployed this token has created honeypot tokens before. This is a serial-scammer signal.", tone: "bad", source: "goplus" });
    }
    if (s.sellTax >= 20) findings.push({ claim: `Sell tax is ${s.sellTax.toFixed(0)}%.`, tone: "bad", source: s.simChecked ? "sim" : "goplus" });
    if (s.simChecked && !s.honeypot) findings.push({ claim: `Buying and selling worked in the test (${s.buyTax.toFixed(0)}% buy fee / ${s.sellTax.toFixed(0)}% sell fee).`, tone: "good", source: "honeypot.is" });
    if (s.ownerAssessed !== false && s.ownerRenounced && !s.hiddenOwner && !s.mintable && !s.takeBack && !s.freezable) findings.push({ claim: chain === "solana" ? "Mint and freeze authority revoked." : "Ownership renounced; no mint or take-back.", tone: "good", source: "goplus" });
    const ownerActive = !s.ownerRenounced || s.hiddenOwner || s.takeBack;
    const ownerNote = s.ownerAssessed === false ? " The owner could not be identified, so this control is treated as live." : "";
    if (s.ownerChangeBalance && ownerActive) {
      if (broadlyTraded) {
        findings.push({ claim: "GoPlus flags an owner-modify-balance capability, but broad CEX listing and deep liquidity indicate it is a governance/upgrade artifact, not an active threat.", tone: "warn", source: "argus" });
      } else {
        caps.push([20, "owner_can_modify_balance"]);
        findings.push({ claim: `Owner can modify holder balances directly; they can zero your wallet.${ownerNote}`, tone: "bad", source: "goplus" });
      }
    }
    if (s.proxy) findings.push({ claim: ownerActive ? `Upgradeable proxy with an active owner: the contract logic can be swapped out from under holders.${ownerNote}` : "Upgradeable proxy contract (logic is replaceable), though ownership is renounced.", tone: ownerActive ? "bad" : "warn", source: "goplus" });
    if (s.slippageModifiable && ownerActive) findings.push({ claim: `Tax is modifiable: a low tax now can be raised toward 100% after you buy.${ownerNote}`, tone: "bad", source: "goplus" });
    if (s.blacklist && ownerActive) findings.push({ claim: `Owner can blacklist addresses, so your wallet can be blocked from selling.${ownerNote}`, tone: "warn", source: "goplus" });
    if (s.tradingCooldown && ownerActive) findings.push({ claim: `Trading cooldown is enforceable, so sells can be delayed.${ownerNote}`, tone: "warn", source: "goplus" });
    if (s.externalCall) findings.push({ claim: "Contract makes external calls, so behavior can change via an external dependency.", tone: "warn", source: "goplus" });
    const creatorHolder = deployerAttribution && deployerAttribution.kind !== "deployer" ? "The creator or authority wallet" : "Creator";
    if (s.creatorPercent >= 5) findings.push({ claim: `${creatorHolder} still holds ~${s.creatorPercent.toFixed(0)}% of supply.`, tone: s.creatorPercent >= 15 ? "bad" : "warn", source: chain === "solana" ? "rugcheck" : "goplus" });
    if (chain === "solana") {
      if (s.balanceMutable) {
        if (broadlyTraded) findings.push({ claim: "A balance-mutable authority exists, but broad market presence indicates it is not an active threat.", tone: "warn", source: "argus" });
        else {
          caps.push([20, "balance_mutable_authority"]);
          findings.push({ claim: "Balance-mutable authority is active. The controller can rewrite your token balance.", tone: "bad", source: "goplus-sol" });
        }
      }
      if (s.transferHook) findings.push({ claim: "Transfer hook active: an external program runs on every transfer and can block sells.", tone: "bad", source: "goplus-sol" });
      if (s.transferFee) findings.push({ claim: "A Token-2022 transfer fee is configured: a built-in tax on every transfer.", tone: "warn", source: "goplus-sol" });
    }
    const lockedByRugcheck = lpLockSource === "rugcheck";
    if (s.lpBurnedPct >= 50) findings.push({ claim: `Liquidity is burned (~${s.lpBurnedPct.toFixed(0)}%) and permanently removed; it cannot be pulled.`, tone: "good", source: "goplus" });
    else if (s.lpLockedPct >= 50) findings.push({ claim: lockedByRugcheck ? `RugCheck reports liquidity is locked (~${s.lpLockedPct.toFixed(0)}%).` : `Liquidity is locked (~${s.lpLockedPct.toFixed(0)}%).`, tone: "good", source: lpLockSource });
    else if (s.lpTopUnlockedEoaPct >= 80) findings.push({ claim: `All liquidity (~${s.lpTopUnlockedEoaPct.toFixed(0)}%) sits in a single unlocked wallet and can be pulled at any time.`, tone: "bad", source: "goplus" });
    else if (s.lpTopUnlockedEoaPct >= 50) findings.push({ claim: `Most liquidity (~${s.lpTopUnlockedEoaPct.toFixed(0)}%) is in one unlocked wallet and removable at will.`, tone: "warn", source: "goplus" });
    else if (s.lpAssessed) findings.push({ claim: lockedByRugcheck ? `RugCheck reports only ~${s.lpLockedPct.toFixed(0)}% of the liquidity locked. Most liquidity is not protected by a verified lock or burn and may be removable.` : "The LP records reviewed do not show meaningful lock or burn protection. Whoever controls the liquidity may be able to remove it.", tone: "warn", source: lpLockSource });
    else findings.push({ claim: "Liquidity protection is unverified. ARGUS could not confirm that the pool's liquidity is locked or permanently burned. Until a locker record with an unlock date, a burn transaction, or equivalent on-chain custody proof is verified, whoever controls the liquidity may be able to remove it.", tone: "warn", source: "argus" });
  }
  if (rugcheck?.rugged) {
    findings.push({
      claim: "RugCheck flags this token as rugged. That is RugCheck's own verdict on the mint, not an on-chain event ARGUS reproduced.",
      tone: "bad",
      source: "rugcheck"
    });
    step({ phase: "Contract", label: "Rugged flag", detail: "RugCheck flags this mint as rugged.", source: "rugcheck", tone: "bad" });
  }
  const insiderClusterPct = rugcheck ? largestInsiderClusterPercent(rugcheck.insiderNetworks) : null;
  const linkedWallets = rugcheck?.graphInsidersDetected ?? null;
  const megaHolderBase = s.holderCount >= 5e4;
  if (!megaHolderBase && insiderClusterPct != null && linkedWallets != null && linkedWallets >= 15) {
    if (insiderClusterPct >= 30) {
      findings.push({
        claim: `RugCheck traces ${linkedWallets.toLocaleString()} wallets to a common funding source, and its largest single cluster holds ~${insiderClusterPct.toFixed(0)}% of supply. Clusters overlap, so this is the biggest one rather than a total.`,
        tone: "bad",
        source: "rugcheck"
      });
    } else if (insiderClusterPct >= 12) {
      findings.push({
        claim: `RugCheck traces ${linkedWallets.toLocaleString()} connected wallets, whose largest single cluster holds ~${insiderClusterPct.toFixed(0)}% of supply. Clusters overlap, so this is the biggest one rather than a total.`,
        tone: "warn",
        source: "rugcheck"
      });
    }
  }
  if (pair.liquidity?.usd != null && Number.isFinite(pair.liquidity.usd) && liquidityUsd < 15e3) findings.push({ claim: `Thin liquidity ($${Math.round(liquidityUsd).toLocaleString()}). Easy to drain or move.`, tone: "warn", source: "dexscreener" });
  if (ageDays != null && ageDays < 7) findings.push({ claim: `Pair is ${ageDays < 1 ? "under a day" : Math.round(ageDays) + " days"} old.`, tone: "warn", source: "dexscreener" });
  if (washSignature) findings.push({ claim: `Volume is ${volLiq.toFixed(0)}x liquidity in 24h while the price moved only ${pc24.toFixed(1)}%: a wash-trading or fake-volume signature.`, tone: "bad", source: "dexscreener" });
  if (pc24 <= -60) findings.push({ claim: `Down ${Math.abs(pc24).toFixed(0)}% in 24h. The token appears to have already dumped.`, tone: "bad", source: "dexscreener" });
  else if (pc24 >= 300 && liquidityUsd < 1e5) findings.push({ claim: `Up ${pc24.toFixed(0)}% in 24h on thin liquidity. This is a vertical pump with high reversal risk.`, tone: "warn", source: "dexscreener" });
  if (!opts?.skipSim) {
    if (cg && !cg.listed) {
      findings.push({
        claim: "No CoinGecko asset was matched. DEX market and trading data are still on record, but a global market-cap rank is not available.",
        tone: "warn",
        source: "coingecko + dexscreener"
      });
    } else if (cg) {
      findings.push({ claim: `Corroborated on CoinGecko${cg.rank ? ` (rank #${cg.rank})` : ""}, ${cg.cexCount} centralized market${cg.cexCount === 1 ? "" : "s"}.`, tone: "good", source: "coingecko" });
      if (cg.mcapUsd && fdv && fdv > cg.mcapUsd * 3) {
        findings.push({ claim: `FDV is ${(fdv / cg.mcapUsd).toFixed(1)}x circulating market cap, creating a large unlock or dilution overhang.`, tone: "warn", source: "coingecko" });
      }
    }
  }
  const evmHolders = explorerHolders ? explorerHolders.map((holder) => ({
    address: holder.address,
    percent: String(holder.percent / 100),
    is_contract: holder.isContract ? 1 : 0
  })) : GOPLUS_UNSORTED_HOLDER_CHAINS.has(chain) ? [] : gpEvm?.holders ?? [];
  const rawHolders = chain === "solana" ? sol?.holders ?? [] : evmHolders;
  const poolAddresses = [
    ...pair?.pairAddress ? [pair.pairAddress] : [],
    ...allPairs.map((candidate) => candidate.pairAddress).filter((value) => Boolean(value))
  ];
  const knownAccounts = rugcheck?.knownAccounts;
  const marketRows = [];
  const walletRows = rawHolders.filter((h) => {
    const address2 = h.address ?? h.account ?? "";
    const market = classifyMarketAddress(address2, { poolAddresses, knownAccounts });
    if (!market) return true;
    const percent = Number(h.percent) * 100;
    marketRows.push({
      address: address2,
      percent: Number.isFinite(percent) ? percent : 0,
      label: market.label,
      kind: market.kind,
      labelledByRugcheck: Boolean(knownAccounts?.[address2]?.type)
    });
    return false;
  });
  const eoaHolders = walletRows.filter(
    (h) => !(h.is_contract === 1 || h.is_contract === "1") && h.is_locked !== 1 && !/lock|burn|null|dead|pool|\blp\b|amm|cex|exchange/i.test(h.tag || "")
  );
  const topSum = eoaHolders.slice(0, 15).reduce((a, h) => a + Number(h.percent) * 100, 0);
  const holdersReliable = rawHolders.length > 0 && topSum <= 101;
  const topWalletPct = eoaHolders.length ? Number(eoaHolders[0].percent) * 100 : null;
  const concentrationTopPct = topWalletPct;
  const insiderPct = holdersReliable ? Math.round(topSum) : 0;
  const materialWalletPcts = holdersReliable ? eoaHolders.map((h) => Number(h.percent) * 100).filter((pct2) => Number.isFinite(pct2) && pct2 >= 1).sort((a, b) => b - a) : [];
  const bundleCount = materialWalletPcts.length;
  const topThreeMaterialPct = Math.round(
    materialWalletPcts.slice(0, 3).reduce((total2, pct2) => total2 + pct2, 0)
  );
  const bundleRisk = !holdersReliable ? "low" : insiderPct >= 45 ? "high" : insiderPct >= 25 ? "elevated" : "low";
  if (s.available && bundleRisk !== "low") {
    findings.push({
      claim: `Concentrated supply: ${bundleCount} non-market wallets each hold at least 1% and up to 15 of the largest non-market wallets hold ~${insiderPct}% combined. This holder snapshot does not establish whether the wallets coordinated.`,
      tone: bundleRisk === "high" ? "bad" : "warn",
      source: chain === "solana" ? "goplus-sol" : "goplus"
    });
  }
  if (holdersReliable && topWalletPct != null) {
    if (topWalletPct >= 50) caps.push([39, "single_wallet_majority_supply"]);
    else if (topWalletPct >= 25) caps.push([69, "single_wallet_concentration"]);
  }
  if (holdersReliable && topThreeMaterialPct >= 60) {
    caps.push([69, "few_wallet_concentration"]);
  }
  if (marketRows.length) {
    const named = marketRows.slice(0, 3).map((row) => `${row.label} (${row.percent.toFixed(1)}%)`).join(", ");
    const viaRugcheck = marketRows.some((row) => row.labelledByRugcheck);
    findings.push({
      claim: `Excluded from concentration: ${named}. These are the market itself, not wallets that can dump.${viaRugcheck ? " The labelled venues are RugCheck's own account labels." : ""}`,
      tone: "good",
      source: viaRugcheck ? "rugcheck" : chain === "solana" ? "goplus-sol" : "goplus"
    });
  }
  const axes = [];
  let aT1 = liquidityUsd < 2e3 ? 2 : liquidityUsd < 1e4 ? 6 : liquidityUsd < 5e4 ? 12 : liquidityUsd < 25e4 ? 18 : 22;
  let lpNote = "";
  if (s.lpBurnedPct >= 50) {
    aT1 = clamp(aT1 + 3, 0, 24);
    lpNote = ", LP burned";
  } else if (s.lpLockedPct >= 50) {
    aT1 = clamp(aT1 + 2, 0, 24);
    lpNote = ", LP locked";
  } else if (s.available && s.lpTopUnlockedEoaPct >= 80) {
    aT1 = clamp(aT1 - 6, 0, 24);
    lpNote = ", LP in one unlocked wallet";
  } else if (s.available && s.lpTopUnlockedEoaPct >= 50) {
    aT1 = clamp(aT1 - 4, 0, 24);
    lpNote = ", LP mostly in one wallet";
  } else if (s.available && s.lpAssessed) {
    aT1 = clamp(aT1 - 3, 0, 24);
    lpNote = ", LP not locked";
  } else if (s.available) {
    lpNote = ", liquidity protection unverified";
  }
  axes.push({ key: "T1", label: "Liquidity & lock", score: aT1, weight: 24, rationale: `$${Math.round(liquidityUsd).toLocaleString()} pooled${lpNote}.` });
  let aT2 = 26;
  if (!s.available) aT2 = 9;
  else if (chain === "solana") {
    if (s.metadataMutable) aT2 -= 8;
    if (!s.ownerRenounced) aT2 -= 6;
    if (s.transferHook) aT2 -= 8;
  } else {
    if (!s.openSource) aT2 -= 8;
    if (s.pausable) aT2 -= 8;
    if (s.selfdestruct) aT2 -= 10;
    if (!s.ownerRenounced) aT2 -= 4;
    if (s.proxy) aT2 -= s.ownerRenounced ? 3 : 6;
    if (s.externalCall) aT2 -= 3;
    if (!s.ownerRenounced && (s.blacklist || s.tradingCooldown)) aT2 -= 3;
  }
  aT2 = clamp(aT2, 0, 26);
  axes.push({ key: "T2", label: "Contract safety", score: aT2, weight: 26, rationale: s.available ? chain === "solana" ? `${s.ownerRenounced ? "authorities revoked" : "mint/freeze authority active"}${s.metadataMutable ? ", metadata mutable" : ""}.` : `${s.openSource ? "verified" : "unverified"} source, ${s.ownerRenounced ? "ownership renounced" : "owner active"}${s.pausable ? ", pausable" : ""}.` : "On-chain safety not verifiable keyless on this chain." });
  const tax = s.buyTax + s.sellTax;
  let aT3 = !s.available ? 6 : tax === 0 ? 12 : tax <= 10 ? 10 : tax <= 20 ? 7 : tax <= 40 ? 3 : 0;
  if (s.cannotSellAll || s.nonTransferable) aT3 = 0;
  if (s.slippageModifiable && !s.ownerRenounced) aT3 = clamp(aT3 - 5, 0, 12);
  if (s.transferFee) aT3 = clamp(aT3 - 5, 0, 12);
  const solanaTaxRationale = s.transferFee ? "a Token-2022 transfer fee is configured on this mint." : "no Token-2022 transfer fee is configured.";
  axes.push({ key: "T3", label: "Taxes & tradeability", score: aT3, weight: 12, rationale: s.available ? chain === "solana" ? solanaTaxRationale : `buy ${s.buyTax.toFixed(0)}% / sell ${s.sellTax.toFixed(0)}%${s.simChecked ? " (simulated)" : ""}.` : "Tax not verifiable keyless." });
  const topPct = holdersReliable ? concentrationTopPct : null;
  let aT4 = s.holderCount < 50 ? 3 : s.holderCount < 500 ? 7 : s.holderCount < 5e3 ? 11 : 14;
  if (topPct != null) {
    if (topPct > 50) aT4 -= 8;
    else if (topPct > 25) aT4 -= 4;
    else if (topPct > 10) aT4 -= 2;
    else aT4 += 2;
  }
  if (bundleRisk === "high") aT4 = clamp(aT4 - 8, 0, 16);
  else if (bundleRisk === "elevated") aT4 = clamp(aT4 - 4, 0, 16);
  if (s.creatorPercent >= 15) aT4 = clamp(aT4 - 5, 0, 16);
  else if (s.creatorPercent >= 5) aT4 = clamp(aT4 - 2, 0, 16);
  aT4 = clamp(aT4, 0, 16);
  const t4Note = !s.available ? "Holder data not verifiable keyless." : !holdersReliable ? `${s.holderCount.toLocaleString()} holders; distribution not reliably reported by the free data tier.` : `${s.holderCount.toLocaleString()} holders${topPct != null ? `, top holder ${topPct < 10 ? topPct.toFixed(2) : topPct.toFixed(0)}%` : ""}${bundleRisk !== "low" ? `, ~${insiderPct}% across ${bundleCount} non-market wallets holding at least 1% each` : ""}.`;
  axes.push({ key: "T4", label: "Holder distribution", score: aT4, weight: 16, rationale: t4Note });
  let aT5 = vol24 < 500 ? 4 : volLiq > 25 ? 4 : volLiq > 8 ? 7 : volLiq < 0.02 ? 5 : 11;
  const total = buys + sells;
  if (washSignature) aT5 = 2;
  else if (total > 20 && sells / total > 0.8) aT5 = clamp(aT5 - 2, 0, 12);
  if (pc24 <= -60) aT5 = clamp(aT5 - 3, 0, 12);
  axes.push({ key: "T5", label: "Trading authenticity", score: aT5, weight: 12, rationale: washSignature ? `vol/liquidity ${volLiq.toFixed(1)}x but price flat (${pc24.toFixed(1)}%): wash-trade signature.` : `24h vol/liquidity ${volLiq.toFixed(2)}x, ${buys} buys / ${sells} sells (DexScreener, the selected pair, rolling 24h).` });
  const socials = [
    ...(pair.info?.websites ?? []).map((w) => ({ label: "site", url: w.url })),
    ...(pair.info?.socials ?? []).map((x) => ({ label: x.type, url: x.url }))
  ];
  const hasWebsite = socials.some((x) => /^https?:\/\//i.test(x.url) && !/x\.com|twitter\.com|t\.me|discord|github/i.test(x.url));
  const hasTwitter = socials.some((x) => /x\.com|twitter/i.test(x.url) || /twitter|^x$/i.test(x.label));
  if (cg?.homepage && !hasWebsite) socials.push({ label: "site", url: cg.homepage });
  if (cg?.twitter && !hasTwitter) socials.push({ label: "twitter", url: `https://x.com/${cg.twitter}` });
  let aT6 = ageDays == null ? 4 : ageDays < 1 ? 2 : ageDays < 7 ? 4 : ageDays < 30 ? 6 : ageDays < 180 ? 8 : 10;
  if (socials.length) aT6 = clamp(aT6 + 1, 0, 10);
  if (cg?.cexCount) aT6 = clamp(aT6 + 2, 0, 10);
  axes.push({ key: "T6", label: "Maturity & presence", score: aT6, weight: 10, rationale: `${ageDays != null ? (ageDays < 1 ? "<1 day" : Math.round(ageDays) + " days") + " old" : "age unknown"}${socials.length ? `, ${socials.length} socials` : ", no socials"}${cg?.cexCount ? `, ${cg.cexCount} CEX listings` : cg && !cg.listed ? ", not on CoinGecko" : ""}.` });
  const measured = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0;
  const assessed = [
    measured(pair.liquidity?.usd),
    s.contractPropertiesAssessed === true,
    s.taxesAssessed === true,
    s.holderCountAssessed === true && holdersReliable,
    measured(pair.volume?.h24) && measured(pair.liquidity?.usd) && measured(pair.txns?.h24?.buys) && measured(pair.txns?.h24?.sells) && typeof pair.priceChange?.h24 === "number" && Number.isFinite(pair.priceChange.h24),
    measured(pair.pairCreatedAt)
  ];
  for (const [index, axis] of axes.entries()) {
    axis.nominalWeight = axis.weight;
    axis.assessed = assessed[index];
    const measurementPaths = [
      ["marketEvidence.liquidityUsd"],
      ["safety.contractPropertiesAssessed"],
      ["safety.taxesAssessed"],
      ["safety.holderCountAssessed", "topHolders"],
      ["marketEvidence.vol24", "marketEvidence.liquidityUsd", "priceChange"],
      ["marketEvidence.ageDays"]
    ];
    axis.evidenceRefs = axis.assessed ? measurementPaths[index] : [];
    if (!axis.assessed) {
      axis.weight = 0;
      axis.score = 0;
      axis.rationale = "Evidence needed to assess this area was not returned. Excluded from the score.";
    }
  }
  const assessedWeight = axes.reduce((sum, axis) => sum + axis.weight, 0);
  const assessment = { assessedWeight, applicableWeight: 100, provisional: assessedWeight < 100, gaps: axes.filter((axis) => !axis.assessed).map((axis) => axis.label) };
  const raw = assessedWeight > 0 ? Math.round(100 * axes.reduce((a, x) => a + x.score, 0) / assessedWeight) : null;
  let capApplied = null;
  let score = raw;
  let verdict;
  if (caps.length) {
    const [ceiling, key] = caps.reduce((m, c) => c[0] < m[0] ? c : m);
    score = raw == null ? null : Math.min(raw, ceiling);
    capApplied = key;
    verdict = ceiling <= 10 ? "AVOID" : score == null ? "UNVERIFIABLE" : band(score);
  } else verdict = score == null ? "UNVERIFIABLE" : band(score);
  const projectX = handleFromUrl((pair.info?.socials ?? []).find((x) => /twitter|x/i.test(x.type))?.url) || handleFromUrl((pair.info?.websites ?? []).map((w) => w.url).find((u) => /x\.com|twitter\.com/i.test(u))) || (cg?.twitter ? "@" + cg.twitter : null);
  opts?.signal?.throwIfAborted();
  const socialActivity = projectX && opts?.collectSocialActivity ? await opts.collectSocialActivity({
    handle: projectX,
    ticker: pair.baseToken.symbol,
    projectName: pair.baseToken.name,
    contractAddress: pair.baseToken.address
  }, { fetchImpl: fetcher, deadlineAt: opts?.deadlineAt }).catch(() => void 0) : void 0;
  const githubOrg = socials.map((x) => x.url.match(/github\.com\/([A-Za-z0-9_.-]{1,39})/i)?.[1]).find((g) => !!g && !/^(orgs|sponsors|topics|features|about|marketplace|explore|pricing|apps|collections)$/i.test(g));
  let shipping;
  if (githubOrg && opts?.collectShipping) {
    step({ phase: "Corroborate", label: "Development", detail: `Reading github.com/${githubOrg}: cadence, committers, substance, whether the code reaches production.`, tone: "neutral" });
    opts?.signal?.throwIfAborted();
    shipping = await opts.collectShipping(githubOrg, {
      fetchImpl: fetcher,
      deadlineAt: opts?.deadlineAt,
      token: { address, chain, deployer: deployerAttribution?.address ?? null },
      sectorText: [pair.baseToken.name, cg?.description].filter(Boolean).join(" \xB7 ") || null
    }).catch(() => void 0);
    if (shipping) {
      step({ phase: "Corroborate", label: "Development read", detail: shipping.headline, tone: shipping.grade === "stalled" ? "bad" : shipping.grade === "thin" ? "warn" : shipping.grade === "unknown" ? "neutral" : "good" });
      if (shipping.market === "price-without-shipping") findings.push({ claim: "The token's price rose over the last quarter while commits to the linked repositories fell: the move is not backed by visible development.", tone: "warn", source: "github" });
      if (shipping.leadDeparted) findings.push({ claim: "The lead committer of the prior two months has stopped while the repository carried on: a departure signal, not yet a departure.", tone: "warn", source: "github" });
      if (shipping.grade === "stalled") findings.push({ claim: `Development has stalled in the linked GitHub: ${shipping.headline}`, tone: "warn", source: "github" });
      if (shipping.grade === "shipping-team" && shipping.live === "live") findings.push({ claim: `A team is shipping and the code is reaching production: ${shipping.headline}`, tone: "good", source: "github" });
    } else {
      step({ phase: "Corroborate", label: "Development read", detail: `github.com/${githubOrg} could not be read; the development lane is unassessed, not failed.`, tone: "neutral" });
    }
  }
  const deployer = deployerAttribution?.address ?? null;
  const deployerRole = deployerRoleLabel(deployerAttribution, "wallet");
  const topHolders = rawHolders.slice(0, 10).map((h) => ({
    address: h.address ?? h.account ?? "",
    percent: Number(h.percent) * 100,
    tag: h.tag || void 0,
    isContract: h.is_contract === 1 || h.is_contract === "1"
  })).filter((h) => h.address);
  const screenFn = opts?.screenSanctions ?? ((chain2, addresses) => screenAddressSanctions(chain2, addresses, fetcher));
  const deployerRiskFn = opts?.screenDeployerRisk ?? ((address2) => screenDeployerRisk(address2, fetcher));
  const deployerRiskEnabled = Boolean(opts?.screenDeployerRisk) || arkhamProviderEnabled();
  step({
    phase: "Screen",
    label: "Deployer forensics",
    detail: deployerRiskEnabled ? "Screening deployer and top holders against OFAC, and tracing funding provenance." : "Screening deployer and top holders against OFAC.",
    tone: "neutral"
  });
  opts?.signal?.throwIfAborted();
  const deployerWallet = deployerWalletAddress({ deployer, deployerAttribution: deployerAttribution ?? void 0 });
  const [sanctionsScreen, deployerRisk, priceHistory] = await Promise.all([
    screenFn(chain, [deployer, ...topHolders.map((h) => h.address)], fetcher, opts?.signal),
    // Best-effort enrichment: a deployer-risk failure must never break a scan
    // (unlike OFAC, it carries no verdict cap), so it always degrades to undefined.
    // Contract-as-wallet gate: do not Arkham-risk the token mint/CA, or the
    // factory that minted it, as if it were a team wallet.
    deployerWallet && deployerRiskEnabled && !sameWalletAddress(deployerWallet, address) ? deployerRiskFn(deployerWallet).catch(() => void 0) : Promise.resolve(void 0),
    fetchPriceHistory(address, chain, pair.pairAddress, fetcher).catch(() => null)
  ]);
  if (deployerRisk?.available && deployerRisk.paths.length) {
    for (const p of deployerRisk.paths.slice(0, 3)) {
      const severe = SEVERE_RISK_CATEGORY.test(p.category ?? "");
      const who = p.seedName || p.category || "a flagged entity";
      const hopStr = p.hops ? `, ${p.hops} hop${p.hops === 1 ? "" : "s"} away` : "";
      const amt = p.usd >= 1 ? `~$${Math.round(p.usd).toLocaleString()} ` : "";
      findings.push({
        claim: p.direction === "backward" ? `${deployerRole} received ${amt}traceable to ${who}${hopStr}. ${severe ? "This is a serious funding-provenance risk." : "Worth scrutiny on where the launch capital came from."}` : `${deployerRole} sent ${amt}to ${who}${hopStr}. ${severe ? "This is a serious counterparty risk." : "Worth scrutiny on where the funds moved."}`,
        tone: severe ? "bad" : "warn",
        source: "arkham"
      });
    }
    const lead = deployerRisk.paths[0];
    step({ phase: "Finalize", label: "Funding trace", detail: `${deployerRole} ${lead.direction === "backward" ? "funded via" : "exposed to"} ${lead.seedName || lead.category || "a flagged entity"}${lead.hops ? ` (${lead.hops} hop${lead.hops === 1 ? "" : "s"})` : ""}.`, tone: SEVERE_RISK_CATEGORY.test(lead.category ?? "") ? "bad" : "warn" });
  }
  if (sanctionsScreen?.available && sanctionsScreen.sanctioned.length) {
    findings.push({
      claim: sanctionsScreen.sanctioned.length === 1 ? `OFAC SDN hit: screened address ${sanctionsScreen.sanctioned[0].slice(0, 10)}\u2026 is on the US Treasury sanctions list. Touching this token is a legal-exposure risk.` : `OFAC SDN hit: ${sanctionsScreen.sanctioned.length} screened addresses are on the US Treasury sanctions list. Touching this token is a legal-exposure risk.`,
      tone: "bad",
      source: "ofac"
    });
    score = score == null ? null : Math.min(score, 5);
    capApplied = "ofac_sanctioned_address";
    verdict = "AVOID";
    step({ phase: "Finalize", label: "OFAC sanctions", detail: `${sanctionsScreen.sanctioned.length} sanctioned address(es): verdict forced to AVOID.`, tone: "bad" });
  }
  const cloneCheck = pair.dexId === "unlisted" && pair.baseToken.symbol === "TOKEN" ? null : await checkForClones({
    mint: address,
    symbol: pair.baseToken.symbol,
    chain,
    pairCreatedAt: pair.pairCreatedAt ?? null,
    liquidityUsd
  }, { fetchImpl: fetcher }).catch(() => null);
  if (cloneCheck?.checked && cloneCheck.clones.length) {
    if (cloneCheck.audited === "later") {
      findings.push({ claim: cloneCheck.note, tone: "bad", source: "dexscreener" });
    } else {
      findings.push({
        claim: `${cloneCheck.clones.length} other ${cloneCheck.clones.length === 1 ? "mint trades" : "mints trade"} under the ticker $${pair.baseToken.symbol}. Verify you hold the address in this report before buying.`,
        tone: "warn",
        source: "dexscreener"
      });
    }
    step({
      phase: "Finalize",
      label: "Ticker collision",
      detail: cloneCheck.note,
      tone: cloneCheck.audited === "later" ? "bad" : "warn"
    });
  }
  const graph = buildGraph(chain, address, pair.baseToken.symbol, verdict, projectX, deployerAttribution, topHolders, socials);
  const decisionBoundary = deriveTokenDecisionBoundary({ score, capApplied, axes });
  const headline = assessment.provisional && !capApplied ? `Score based on ${assessedWeight}/100 of the assessment weight. Evidence gaps: ${assessment.gaps.join(", ")}.` : buildHeadline(verdict, capApplied, s, liquidityUsd, projectX);
  step({ phase: "Finalize", label: "Verdict", detail: `${verdict} \xB7 ${score}/100${capApplied ? ` (cap: ${capApplied})` : ""}`, tone: verdict === "PASS" ? "good" : verdict === "CAUTION" ? "warn" : "bad" });
  return {
    address,
    chain,
    dexId: pair.dexId,
    dexLabels: pair.labels ?? [],
    pairAddress: pair.pairAddress,
    symbol: pair.baseToken.symbol,
    name: pair.baseToken.name,
    imageUrl: pair.info?.imageUrl ?? cg?.image ?? void 0,
    priceUsd: pair.priceUsd ? Number(pair.priceUsd) : void 0,
    mcap: fdv,
    fdv: fullyDilutedValuation,
    liquidityUsd,
    vol24,
    ageDays,
    marketEvidence: {
      mcap: pair.marketCap != null && Number.isFinite(pair.marketCap),
      fdv: pair.fdv != null && Number.isFinite(pair.fdv),
      liquidityUsd: pair.liquidity?.usd != null && Number.isFinite(pair.liquidity.usd),
      vol24: pair.volume?.h24 != null && Number.isFinite(pair.volume.h24),
      ageDays: pair.pairCreatedAt != null && Number.isFinite(pair.pairCreatedAt)
    },
    // Keep the raw instant, not just the day count derived from it above. The
    // operator trace ages the deployer wallet against this launch, and a wallet
    // minutes older than the token it launched is 0 days old in every direction.
    pairCreatedAt: pair.pairCreatedAt ?? null,
    priceChange: pair.priceChange,
    ...priceHistory ? { priceHistory } : {},
    // The pool exclusion has to reach the number a reader actually sees. Leaving
    // the raw provider top holder on the dossier put "top holder 37%" on the same
    // page as the finding explaining that the 37% line is the pool itself.
    verdict,
    score,
    assessment,
    capApplied,
    headline,
    axes,
    ...decisionBoundary ? { decisionBoundary } : {},
    safety: { ...s, topHolderPct: concentrationTopPct },
    socials,
    holdersAssessed: holdersReliable,
    projectX,
    ...socialActivity ? { socialActivity } : {},
    ...shipping ? { shipping } : {},
    deployer,
    ...deployerAttribution ? { deployerAttribution } : {},
    topHolders,
    insiderPct,
    bundleCount,
    bundleRisk,
    cg,
    graph,
    findings,
    trace,
    live: true,
    safetyChecked: s.available,
    sanctionsScreen,
    deployerRisk,
    ...cloneCheck ? { cloneCheck } : {}
  };
}
function buildGraph(chain, address, symbol, verdict, projectX, attribution, holders, socials) {
  const center = tokenEntityKey(chain, address);
  const nodes = [{
    type: "Token",
    key: center,
    label: "$" + symbol,
    symbol,
    chain,
    address,
    subject: true,
    was_rug: verdict === "AVOID"
  }];
  const edges = [];
  if (projectX) {
    const projectXSourceUrl = socials.find((social) => {
      const handle = social.url.match(/(?:x|twitter)\.com\/([A-Za-z0-9_]{2,30})/i)?.[1];
      return Boolean(handle && `@${handle}`.toLowerCase() === projectX.toLowerCase());
    })?.url;
    nodes.push({ type: "Person", key: projectX });
    edges.push({
      src: center,
      dst: projectX,
      type: "TEAM",
      ...projectXSourceUrl ? { source_url: projectXSourceUrl, evidence_origin: "deterministic", artifact_verified: true } : {}
    });
  }
  if (attribution) {
    const k = walletEntityKey(chain, attribution.address);
    nodes.push({ type: "Identity", subtype: "Wallet", key: k, label: "wallet:" + attribution.address.slice(0, 8), chain, address: attribution.address });
    edges.push({
      src: center,
      dst: k,
      type: attribution.kind === "deployer" ? "DEPLOYED_BY" : "ATTRIBUTED_CREATOR",
      source: attribution.source,
      .../^https?:\/\//i.test(attribution.source) ? { source_url: attribution.source, evidence_origin: "deterministic", artifact_verified: true } : {}
    });
  }
  holders.slice(0, 4).forEach((h) => {
    const k = walletEntityKey(chain, h.address);
    nodes.push({ type: "Identity", subtype: "Wallet", key: k, label: (h.tag || "holder") + ":" + h.address.slice(0, 8), chain, address: h.address, concentration: h.percent });
    edges.push({
      src: center,
      dst: k,
      type: "HELD_BY",
      ...h.percent > 25 ? { risk: "high_concentration" } : {}
    });
  });
  socials.slice(0, 3).forEach((x) => {
    const xh = x.url.match(/(?:x\.com|twitter\.com)\/([A-Za-z0-9_]{2,30})/i)?.[1];
    const key = xh ? "@" + xh : x.url.match(/^https?:\/\/(?:www\.)?([^/]+)/i)?.[1];
    if (!key || projectX && key.toLowerCase() === projectX.toLowerCase()) return;
    nodes.push({ type: "Company", key });
    edges.push({
      src: center,
      dst: key,
      type: "LINKS",
      source_url: x.url,
      evidence_origin: "deterministic",
      artifact_verified: true
    });
  });
  return { nodes, edges };
}
function buildHeadline(verdict, cap, s, liq, projectX) {
  if (cap === "ofac_sanctioned_address") return "A screened address is on the US Treasury OFAC sanctions list. Touching this token is a legal-exposure risk. Do not touch.";
  if (s.honeypot) return s.nonTransferable ? "Non-transferable: holders are locked in. Do not touch." : "Honeypot: buyers cannot sell. Do not touch.";
  if (cap === "mint_authority_active") return "Mint authority is live, the team can dilute holders to zero.";
  if (cap === "freeze_authority_active") return "Freeze authority is live, the team can freeze your tokens at any time.";
  if (cap === "reclaimable_ownership") return "Ownership can be reclaimed after renouncement, a classic rug setup.";
  if (cap === "owner_can_modify_balance") return "Owner can rewrite holder balances, they can zero your wallet at will.";
  if (cap === "balance_mutable_authority") return "A balance-mutable authority can rewrite your token balance at will.";
  if (verdict === "PASS") return `Clears the forensic bar: ${s.ownerRenounced ? "authorities revoked" : "owned"}, ${s.lpLocked ? "LP locked" : "tradeable"}, with real depth${projectX ? `. Team: ${projectX}` : "."}`;
  if (verdict === "CAUTION") return `Tradeable but with reservations${liq < 15e3 ? "; liquidity is thin" : ""}. Size accordingly.`;
  if (!s.available) return "Scored on market data only; on-chain contract safety could not be verified keyless on this chain.";
  return "Falls short on the forensic checks. Treat as high risk.";
}

// server/cost.ts
import { AsyncLocalStorage as AsyncLocalStorage2 } from "node:async_hooks";
var PRICE = {
  // Fallback only. Successful xAI responses now return their exact billed
  // cost in usage.cost_in_usd_ticks, which always takes precedence. Grok 4.3
  // is the current redirect target for retired grok-4-fast model slugs.
  grokIn: 1.25 / 1e6,
  grokOut: 2.5 / 1e6,
  grokToolCall: 5 / 1e3,
  claudeIn: 3 / 1e6,
  claudeOut: 15 / 1e6,
  claudeWebSearch: 10 / 1e3,
  haikuIn: 1 / 1e6,
  haikuOut: 5 / 1e6,
  serperQuery: 1 / 1e3,
  twitterapiCall: 2e-4,
  pdlMatch: 0.1,
  heliusCall: 1e-4
};
var createState = () => ({
  ledger: /* @__PURE__ */ new Map(),
  grok: { in: 0, out: 0, calls: 0, sources: 0 },
  claude: { in: 0, out: 0, calls: 0 }
});
var auditCostState = new AsyncLocalStorage2();
var fallbackState = createState();
var currentState = () => auditCostState.getStore() ?? fallbackState;
function withCostLedger(work) {
  return auditCostState.run(createState(), work);
}
var round4 = (n) => Math.round(n * 1e4) / 1e4;
function getCost() {
  const { ledger, grok, claude } = currentState();
  const lines = [...ledger.values()].map((l) => ({ ...l, usd: round4(l.usd) })).sort((a, b) => b.usd - a.usd || b.calls - a.calls);
  const grokUsd = lines.filter((l) => l.provider === "grok").reduce((a, l) => a + l.usd, 0);
  const claudeUsd = lines.filter((l) => l.provider === "claude").reduce((a, l) => a + l.usd, 0);
  const total = lines.reduce((a, l) => a + l.usd, 0);
  const round2 = (n) => Math.round(n * 100) / 100;
  return {
    schemaVersion: 1,
    usd: round2(total),
    grokUsd: round2(grokUsd),
    claudeUsd: round2(claudeUsd),
    grokCalls: grok.calls,
    claudeCalls: claude.calls,
    sources: grok.sources,
    estimated: true,
    calls: lines
  };
}

// src/lib/subjectRef.ts
var EVM_ADDRESS4 = /^0x[0-9a-f]{40}$/i;
var SOLANA_ADDRESS3 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
function normalizeSubjectRef(value) {
  const clean = (value ?? "").trim().replace(/^https?:\/\//i, "").replace(/^[@$]+/, "").replace(/\/$/, "");
  const qualified = clean.match(/^([a-z0-9_-]+):(.+)$/i);
  if (qualified && (EVM_ADDRESS4.test(qualified[2]) || SOLANA_ADDRESS3.test(qualified[2]) || !/^https?$/i.test(qualified[1]) && /^[A-Za-z0-9._-]{10,128}$/.test(qualified[2]))) {
    return `${qualified[1].toLowerCase()}:${EVM_ADDRESS4.test(qualified[2]) ? qualified[2].toLowerCase() : qualified[2]}`;
  }
  if (SOLANA_ADDRESS3.test(clean)) return clean;
  if (EVM_ADDRESS4.test(clean)) return clean.toLowerCase();
  return clean.toLowerCase();
}

// src/lib/reportCheckContract.ts
var TOKEN_REQUIRED_CHECK_IDS = /* @__PURE__ */ new Set([
  "contract-safety",
  "buy-sell-simulation",
  "holder-distribution",
  "wallet-clustering",
  "market-intelligence",
  "ofac-sanctions-address"
]);
var INVESTIGATION_REQUIRED_CHECK_IDS = /* @__PURE__ */ new Set([
  ...TOKEN_REQUIRED_CHECK_IDS,
  "trust-graph-connections"
]);
var TOKEN_REQUIRED_CHECK_LABELS = Object.freeze({
  "contract-safety": "Contract safety",
  "buy-sell-simulation": "Tradeability check",
  "holder-distribution": "Holder distribution",
  "wallet-clustering": "Wallet clustering",
  "market-intelligence": "Market intelligence",
  "ofac-sanctions-address": "OFAC sanctions screen",
  "trust-graph-connections": "Trust-graph reconciliation"
});
var TOKEN_SUPPLEMENTAL_CHECK_IDS = /* @__PURE__ */ new Set([
  "operator-funding-trace",
  "deployer-trail-evm",
  "bytecode-fingerprint-evm",
  "documents-audits",
  "news-press",
  "github-forensics",
  "trust-graph-connections"
]);
var PERSON_SUPPLEMENTAL_CHECK_IDS = /* @__PURE__ */ new Set([
  "profile-photo-authenticity",
  "code-footprint-github",
  "identity-continuity",
  "news-press",
  "project-leadership-currency",
  "founder-repeat-backing",
  "investor-fund-scale"
]);
function isUnboundInvestigationGraphRow(check, checkId) {
  return checkId === "trust-graph-connections" && check.provider === "project-account-audit" && check.retryable === false;
}
function applyReportCheckContract(kind, checks) {
  const requiredIds = kind === "investigation" ? INVESTIGATION_REQUIRED_CHECK_IDS : TOKEN_REQUIRED_CHECK_IDS;
  const normalized = checks.map((check) => {
    const checkId = check.checkId?.trim() ?? "";
    if (kind === "token" || kind === "investigation") {
      if (kind === "investigation" && isUnboundInvestigationGraphRow(check, checkId)) {
        return { ...check, decisionCritical: false };
      }
      if (checkId && requiredIds.has(checkId)) {
        return { ...check, decisionCritical: true };
      }
      if (checkId && TOKEN_SUPPLEMENTAL_CHECK_IDS.has(checkId)) {
        return { ...check, decisionCritical: false };
      }
      return {
        ...check,
        ...check.decisionCritical === void 0 ? {} : { decisionCritical: check.decisionCritical }
      };
    }
    if (check.decisionCritical !== void 0) return { ...check };
    return {
      ...check,
      decisionCritical: !checkId || !PERSON_SUPPLEMENTAL_CHECK_IDS.has(checkId)
    };
  });
  if (kind === "person") return normalized;
  const present = new Set(normalized.map((check) => check.checkId).filter(Boolean));
  const missingRequired = [...requiredIds].filter((checkId) => !present.has(checkId)).map((checkId) => ({
    checkId,
    label: TOKEN_REQUIRED_CHECK_LABELS[checkId] ?? checkId,
    status: "unknown",
    decisionCritical: true,
    note: "required completion outcome was not saved"
  }));
  return [...normalized, ...missingRequired];
}
function hasExplicitReportCheckContract(kind, checks) {
  if (kind === "token" || kind === "investigation") {
    const ids = new Set(checks.map((check) => check.checkId).filter(Boolean));
    const requiredIds = kind === "investigation" ? INVESTIGATION_REQUIRED_CHECK_IDS : TOKEN_REQUIRED_CHECK_IDS;
    return [...requiredIds].every((checkId) => ids.has(checkId));
  }
  return checks.length > 0 && checks.every((check) => typeof check.decisionCritical === "boolean") && checks.some((check) => check.decisionCritical === true);
}

// src/lib/scanChecklist.ts
var POST_SCAN_ENRICHMENT_CHECK_IDS = /* @__PURE__ */ new Set([
  "deployer-trail-evm",
  "bytecode-fingerprint-evm"
]);
function decisionCriticalChecks(checks) {
  const hasExplicitCriticality = checks.some((check) => check.decisionCritical !== void 0);
  return hasExplicitCriticality ? checks.filter((check) => check.decisionCritical === true && (check.checkId !== "operator-funding-trace" || arkhamProviderEnabled()) && (!check.checkId || !POST_SCAN_ENRICHMENT_CHECK_IDS.has(check.checkId))) : checks;
}
var SUCCESSFUL = /* @__PURE__ */ new Set(["confirmed", "reported", "finding", "checked-empty"]);
var NEVER_WAIVE_RECORDED = /* @__PURE__ */ new Set(["confirmed", "finding", "checked-empty", "complete"]);
var UNKNOWN_OR_FAILED = /* @__PURE__ */ new Set(["unknown", "unavailable", "stale"]);
function neverWaiveCheckRecorded(checkId, status) {
  return checkId === "organization-registration" ? status === "confirmed" : NEVER_WAIVE_RECORDED.has(status);
}
var NEVER_WAIVE_CHECK_IDS = /* @__PURE__ */ new Set([
  "identity-resolution",
  "ofac-sanctions-name",
  // Person-name checks are not substitutes for the audited company's own
  // legal-entity and sanctions questions.
  "organization-registration",
  "organization-sanctions",
  // A sanctioned deployer or holder wallet is a legal-exposure flag no market
  // signal can offset; the address screen is never waivable on token subjects.
  "ofac-sanctions-address",
  "trust-graph-connections",
  // An unresolved token/security candidacy is a capital-risk unknown (the core
  // scam vector), never an enrichment gap.
  "founder-asset-distinction"
]);
var CLEARANCE_COVERAGE_FLOOR_PERCENT = 100;
function coveragePercentOf(recorded, applicable) {
  if (!(applicable > 0)) return 0;
  return Math.floor(recorded / applicable * 1e3) / 10;
}
function clearanceCoverage(checks) {
  const governing = decisionCriticalChecks(checks);
  const applicableRows = governing.filter((check) => check.status !== "not-applicable");
  const recordedRows = applicableRows.filter((check) => SUCCESSFUL.has(check.status));
  const hasStableIds = applicableRows.some((check) => typeof check.checkId === "string" && check.checkId);
  const openNeverWaive = hasStableIds ? applicableRows.filter((check) => check.checkId && NEVER_WAIVE_CHECK_IDS.has(check.checkId) && !neverWaiveCheckRecorded(check.checkId, check.status)).map((check) => check.checkId) : [];
  const applicable = applicableRows.length;
  const recorded = recordedRows.length;
  const recordedPercent = coveragePercentOf(recorded, applicable);
  const sufficient = applicable > 0 && (hasStableIds ? openNeverWaive.length === 0 && recordedPercent >= CLEARANCE_COVERAGE_FLOOR_PERCENT : recorded === applicable);
  return { applicable, recorded, openNeverWaive, recordedPercent, sufficient };
}
var shortAddr = (address) => address.length > 12 ? `${address.slice(0, 5)}\u2026${address.slice(-4)}` : address;
function contractSafetyConcerns(dossier) {
  const safety = dossier.safety;
  const concerns = [];
  if (safety.serialScammerCreator) concerns.push("prior honeypots by creator");
  if (safety.honeypot || safety.honeypotOnchain) concerns.push("honeypot indicator");
  if (safety.nonTransferable || safety.cannotSellAll) concerns.push("transfer restriction");
  if (safety.mintable) concerns.push("mint authority active");
  if (safety.freezable) concerns.push("freeze authority active");
  if (safety.contractPropertiesAssessed !== false && !safety.ownerRenounced) concerns.push(dossier.chain === "solana" ? "authorities retained" : "owner active");
  if (safety.hiddenOwner || safety.takeBack) concerns.push("owner-control risk");
  if (safety.contractPropertiesAssessed !== false && dossier.chain !== "solana" && !safety.openSource) concerns.push("source not verified");
  if (safety.selfdestruct) concerns.push("contract can self-destruct/close");
  if (safety.pausable) concerns.push("transfers can be paused");
  if (safety.proxy) concerns.push("upgradeable proxy");
  if (safety.metadataMutable) concerns.push("metadata mutable");
  if (safety.balanceMutable || safety.ownerChangeBalance) concerns.push("balances can be changed");
  if (safety.transferHook || safety.transferFee) concerns.push("programmable transfer controls");
  if (safety.slippageModifiable) concerns.push("tax/slippage modifiable");
  if (safety.blacklist || safety.tradingCooldown) concerns.push("wallet/trading restrictions");
  if (safety.externalCall) concerns.push("external calls enabled");
  return concerns;
}
function contractSafetyNote(dossier) {
  const concerns = contractSafetyConcerns(dossier);
  if (concerns.length) return concerns.slice(0, 3).join(" \xB7 ");
  return "provider response recorded; no surfaced contract-control concern";
}
var outcomeNotRecorded = "completion outcome not recorded";
var CHAIN_DISPLAY_NAMES = Object.freeze({
  robinhood: "Robinhood Chain",
  ethereum: "Ethereum",
  base: "Base",
  solana: "Solana",
  arbitrum: "Arbitrum",
  bsc: "BNB Chain",
  polygon: "Polygon"
});
function chainDisplayName(chain) {
  const key = (chain ?? "").trim().toLowerCase();
  if (!key) return "this chain";
  return CHAIN_DISPLAY_NAMES[key] ?? `the ${key} chain`;
}
function shippingCheck(dossier, outcomeNotRecorded2) {
  const ship = dossier.shipping;
  const linked = (dossier.socials ?? []).some((x) => /github\.com\//i.test(x.url));
  if (ship && ship.grade !== "unknown") {
    const finding = ship.grade === "stalled" || ship.market === "price-without-shipping" || ship.leadDeparted || ship.stars === "suspect" || ship.claimsUnsupported >= 2 && ship.claimsUnsupported > ship.claimsSupported;
    return {
      checkId: "github-forensics",
      decisionCritical: true,
      label: "GitHub forensics",
      status: finding ? "finding" : "confirmed",
      note: `${ship.headline} ${ship.distinctHuman} human committer${ship.distinctHuman === 1 ? "" : "s"}, cadence ${ship.cadenceStatus}, code ${ship.live === "live" ? "reaching production" : ship.live === "committed-only" ? "committed only" : ship.live === "deploys-without-code" ? "shipped from an unseen source" : "production status unread"}; ${ship.reposRead} repos and ${ship.commitsRead} commits read.`
    };
  }
  if (ship) return { checkId: "github-forensics", decisionCritical: true, label: "GitHub forensics", status: "unavailable", note: "a GitHub account is linked but could not be read" };
  if (linked) return { checkId: "github-forensics", decisionCritical: true, label: "GitHub forensics", status: "unknown", note: `a GitHub account is linked; ${outcomeNotRecorded2}` };
  return { checkId: "github-forensics", decisionCritical: true, label: "GitHub forensics", status: "unknown", note: "no public repository is linked from the project's official sources; teams that build in private are read through on-chain deploys instead" };
}
function tokenChecks(dossier) {
  const evm = dossier.chain !== "solana";
  const safety = dossier.safety;
  const checks = [];
  checks.push(
    safety.contractPropertiesAssessed === true || contractSafetyConcerns(dossier).length > 0 ? {
      checkId: "contract-safety",
      decisionCritical: true,
      label: "Contract safety",
      status: contractSafetyConcerns(dossier).length ? "finding" : "confirmed",
      note: contractSafetyNote(dossier)
    } : {
      checkId: "contract-safety",
      decisionCritical: true,
      label: "Contract safety",
      status: "unavailable",
      note: `no contract-safety provider response recorded for ${dossier.chain}`
    }
  );
  const tradeabilityAssessed = safety.tradeabilityAssessed === true || safety.simChecked;
  const tradeabilityFinding = safety.honeypot || safety.cannotSellAll || safety.blacklist || safety.pausable || safety.tradingCooldown || safety.ownerChangeBalance;
  const tradeabilityNote = safety.tradeabilityMethod === "observed-market" ? `${(safety.observedBuys24h ?? 0).toLocaleString()} buys and ${(safety.observedSells24h ?? 0).toLocaleString()} sells were recorded in the selected pool over 24 hours. Trading occurred, but this does not rule out wallet-specific restrictions.${tradeabilityFinding ? " Contract controls can still restrict particular holders or future trading." : ""}` : safety.tradeabilityMethod === "goplus-screen" ? `GoPlus tradeability screen completed \xB7 buy ${safety.buyTax}% \xB7 sell ${safety.sellTax}%` : `Buy and sell simulation completed \xB7 buy ${safety.buyTax}% \xB7 sell ${safety.sellTax}%`;
  checks.push(
    tradeabilityAssessed ? {
      checkId: "buy-sell-simulation",
      decisionCritical: true,
      label: "Tradeability check",
      status: tradeabilityFinding ? "finding" : "confirmed",
      note: tradeabilityNote
    } : evm ? safety.available ? { checkId: "buy-sell-simulation", decisionCritical: true, label: "Tradeability check", status: "unknown", note: outcomeNotRecorded } : { checkId: "buy-sell-simulation", decisionCritical: true, label: "Tradeability check", status: "unavailable", note: `no tradeability provider or two-sided market receipt covers ${chainDisplayName(dossier.chain)}` } : { checkId: "buy-sell-simulation", decisionCritical: true, label: "Tradeability check", status: "not-applicable", note: "Solana: static flags only" }
  );
  const holderCount = safety.holderCount || dossier.topHolders.length;
  const topHolderPct = safety.topHolderPct ?? dossier.topHolders.find((h) => !h.isContract)?.percent ?? null;
  checks.push(
    holderCount > 0 ? {
      checkId: "holder-distribution",
      decisionCritical: true,
      label: "Holder distribution",
      status: (topHolderPct ?? 0) > 50 ? "finding" : "confirmed",
      note: `${holderCount.toLocaleString()} holder${holderCount === 1 ? "" : "s"} \xB7 top ${topHolderPct == null ? "unknown" : `${Math.round(topHolderPct)}%`}`
    } : safety.available ? { checkId: "holder-distribution", decisionCritical: true, label: "Holder distribution", status: "unknown", note: "safety data returned, but no holder-query outcome was recorded" } : { checkId: "holder-distribution", decisionCritical: true, label: "Holder distribution", status: "unavailable", note: "holder provider response unavailable" }
  );
  const hasHolderRows = dossier.topHolders.length > 0;
  const hasClusteringOutcome = hasHolderRows && (dossier.holdersAssessed === true || dossier.bundleRisk === "elevated" || dossier.bundleRisk === "high" || dossier.bundleCount > 0 || dossier.insiderPct > 0);
  checks.push(
    hasClusteringOutcome ? {
      checkId: "wallet-clustering",
      decisionCritical: true,
      label: "Wallet clustering",
      status: dossier.bundleRisk === "elevated" || dossier.bundleRisk === "high" ? "finding" : "confirmed",
      note: dossier.bundleRisk === "elevated" || dossier.bundleRisk === "high" ? `${dossier.bundleCount} concentrated wallets \xB7 ~${Math.round(dossier.insiderPct)}% (${dossier.bundleRisk} risk)` : `${dossier.topHolders.length} assessed non-market holder rows; no elevated concentration surfaced`
    } : hasHolderRows ? { checkId: "wallet-clustering", decisionCritical: true, label: "Wallet clustering", status: "unknown", note: "holder rows exist, but clustering completion/reliability is not recorded" } : safety.available ? { checkId: "wallet-clustering", decisionCritical: true, label: "Wallet clustering", status: "unknown", note: "no holder rows available to establish a clustering result" } : { checkId: "wallet-clustering", decisionCritical: true, label: "Wallet clustering", status: "unavailable", note: "requires holder-provider data" }
  );
  const deployerRisk = dossier.deployerRisk;
  const backwardRisk = deployerRisk?.available ? deployerRisk.paths.filter((path) => path.direction === "backward") : [];
  checks.push(
    deployerRisk?.available ? backwardRisk.length ? {
      checkId: "operator-funding-trace",
      decisionCritical: true,
      label: "Operator / funding trace",
      status: "finding",
      note: `Deployer funding traced on Arkham: exposure to ${backwardRisk[0].seedName || backwardRisk[0].category || "a flagged entity"}${backwardRisk[0].hops ? ` (${backwardRisk[0].hops} hop${backwardRisk[0].hops === 1 ? "" : "s"})` : ""}`,
      provider: "arkham",
      completedAt: deployerRisk.completedAt
    } : {
      checkId: "operator-funding-trace",
      decisionCritical: true,
      label: "Operator / funding trace",
      status: "confirmed",
      // "funding source" is inbound only (backward); any outbound exposure
      // still surfaces as a finding, so this note does not overclaim.
      note: dossier.deployer ? `Deployer ${shortAddr(dossier.deployer)} funding traced on Arkham; no flagged-entity funding source surfaced` : "Deployer funding traced on Arkham; no flagged-entity funding source surfaced",
      provider: "arkham",
      completedAt: deployerRisk.completedAt
    } : arkhamProviderEnabled() ? {
      checkId: "operator-funding-trace",
      decisionCritical: true,
      label: "Operator / funding trace",
      status: "unknown",
      note: dossier.deployer ? `deployer ${shortAddr(dossier.deployer)} resolved; trace ${outcomeNotRecorded}` : `deployer unresolved; trace ${outcomeNotRecorded}`
    } : {
      checkId: "operator-funding-trace",
      decisionCritical: false,
      label: "Operator / funding trace",
      status: "not-applicable",
      note: "Supplemental provider trace is currently disabled and does not affect report readiness"
    }
  );
  checks.push(evm ? { checkId: "deployer-trail-evm", decisionCritical: false, label: "Creator wallet details", status: "unknown", note: "Checked after the saved score; the latest wallet result is shown below" } : { checkId: "deployer-trail-evm", decisionCritical: false, label: "Creator wallet details", status: "not-applicable", note: "Solana" });
  checks.push(evm ? { checkId: "bytecode-fingerprint-evm", decisionCritical: false, label: "Known scam code comparison", status: "unknown", note: "Checked after the saved score; the latest contract-code result is shown below" } : { checkId: "bytecode-fingerprint-evm", decisionCritical: false, label: "Known scam code comparison", status: "not-applicable", note: "Solana" });
  checks.push(
    dossier.cg?.listed ? {
      checkId: "market-intelligence",
      decisionCritical: true,
      label: "Market intelligence",
      status: dossier.cg.cexCount > 0 ? "confirmed" : "finding",
      note: `CoinGecko listing \xB7 ${dossier.cg.cexCount} CEX listing${dossier.cg.cexCount === 1 ? "" : "s"}${dossier.cg.rank ? ` \xB7 rank #${dossier.cg.rank}` : ""}`
    } : dossier.cg ? { checkId: "market-intelligence", decisionCritical: true, label: "Market intelligence", status: "checked-empty", note: "CoinGecko returned no matching asset" } : { checkId: "market-intelligence", decisionCritical: true, label: "Market intelligence", status: "unknown", note: outcomeNotRecorded }
  );
  const sanctionsScreen = dossier.sanctionsScreen;
  checks.push(
    sanctionsScreen?.available ? {
      checkId: "ofac-sanctions-address",
      decisionCritical: true,
      label: "OFAC sanctions screen",
      status: sanctionsScreen.sanctioned.length ? "finding" : "confirmed",
      note: sanctionsScreen.sanctioned.length ? `${sanctionsScreen.sanctioned.length} of ${sanctionsScreen.checked} screened addresses are on the US Treasury SDN list` : `${sanctionsScreen.checked} address${sanctionsScreen.checked === 1 ? "" : "es"} (deployer + top holders) screened against the${sanctionsScreen.listSize ? ` ${sanctionsScreen.listSize.toLocaleString()}-entry` : ""} OFAC SDN list; no matches`,
      provider: "ofac-sdn",
      completedAt: sanctionsScreen.completedAt
    } : sanctionsScreen?.reason === "no_screenable_addresses" ? {
      checkId: "ofac-sanctions-address",
      decisionCritical: true,
      label: "OFAC sanctions screen",
      status: "unavailable",
      // A rescan cannot conjure addresses this chain never exposed, so
      // the report must not offer one as the remedy.
      retryable: false,
      note: `No creator or holder address could be resolved on ${chainDisplayName(dossier.chain)}, so there was nothing to screen against the sanctions list. This is a coverage limit of that chain, not a clean result.`,
      provider: "ofac-sdn",
      completedAt: sanctionsScreen.completedAt
    } : sanctionsScreen ? { checkId: "ofac-sanctions-address", decisionCritical: true, label: "OFAC sanctions screen", status: "unavailable", note: "The U.S. sanctions list was unavailable, so this check did not finish" } : { checkId: "ofac-sanctions-address", decisionCritical: true, label: "OFAC sanctions screen", status: "unknown", note: `token creator + largest holders; ${outcomeNotRecorded}` }
  );
  checks.push({ checkId: "documents-audits", decisionCritical: true, label: "Documents & audits", status: "unknown", note: `whitepaper, security audits, and documents; ${outcomeNotRecorded}` });
  checks.push({ checkId: "news-press", decisionCritical: true, label: "News & press", status: "unknown", note: outcomeNotRecorded });
  checks.push(shippingCheck(dossier, outcomeNotRecorded));
  checks.push({ checkId: "trust-graph-connections", decisionCritical: true, label: "Trust-graph reconciliation", status: "unknown", note: `shared token creators or funders with flagged projects; ${outcomeNotRecorded}` });
  return checks;
}
var INVESTIGATION_CHECK_BRIDGE = [
  { tokenCheckId: "news-press", tokenLabel: "News & press", projectCheckId: "news-press", projectLabel: "News & press" },
  { tokenCheckId: "github-forensics", tokenLabel: "GitHub forensics", projectCheckId: "code-footprint-github", projectLabel: "Code footprint (GitHub)" },
  { tokenCheckId: "documents-audits", tokenLabel: "Documents & audits", projectCheckId: "project-transparency", projectLabel: "Transparency and disclosures" },
  { tokenCheckId: "trust-graph-connections", tokenLabel: "Trust-graph reconciliation", projectCheckId: "trust-graph-connections", projectLabel: "Trust-graph connections" }
];
function reconcileInvestigationChecks(tokenRows, tokenAddress, projectAccount, projectAccountAudit, projectAccountBinding) {
  const rows = tokenRows.map((row) => ({ ...row }));
  const projectRows = projectAccount?.checkRuns;
  if (!projectRows || !projectRows.length) {
    if (projectAccountAudit) {
      const note = projectAccountAudit.state === "complete" ? "Embedded project-account audit completed without a stored check ledger." : projectAccountAudit.note;
      const unbound = projectAccountAudit.state === "unavailable";
      for (const bridge of INVESTIGATION_CHECK_BRIDGE) {
        const target = rows.find((row) => row.checkId === bridge.tokenCheckId || row.label === bridge.tokenLabel);
        if (!target || !UNKNOWN_OR_FAILED.has(target.status)) continue;
        target.status = "unavailable";
        target.note = note;
        target.provider = "project-account-audit";
        if (unbound) target.retryable = false;
      }
    }
    return rows;
  }
  const handle = (projectAccount?.handle ?? "").trim();
  const provenance = handle ? `the bound project account scan (${handle})` : "the bound project account scan";
  const annotateOpenBridgeRows = (reason) => {
    for (const bridge of INVESTIGATION_CHECK_BRIDGE) {
      const target = rows.find((row) => row.checkId === bridge.tokenCheckId || row.label === bridge.tokenLabel);
      if (!target || !UNKNOWN_OR_FAILED.has(target.status)) continue;
      target.note = reason;
    }
    return rows;
  };
  const binding = projectRows.find((row) => row.checkId === "project-token-identity" || row.label === "Canonical project token");
  const projectSideConfirmed = binding?.status === "confirmed";
  const normalizeHandle = (value) => String(value ?? "").replace(/^@/, "").trim().toLowerCase();
  const tokenSideVerified = Boolean(
    projectAccountBinding && projectAccountBinding.status === "verified" && normalizeHandle(projectAccount?.handle) && normalizeHandle(projectAccountBinding.handle) === normalizeHandle(projectAccount?.handle)
  );
  if (!projectSideConfirmed && !tokenSideVerified) {
    if (!binding) {
      return annotateOpenBridgeRows(
        `resolves through ${provenance}, which recorded no canonical-token binding check, so its outcomes cannot be credited to this token`
      );
    }
    return annotateOpenBridgeRows(
      `resolves through ${provenance}, but that scan did not confirm this project's canonical token (${binding.note ?? `binding status: ${binding.status}`}), so its outcomes cannot be credited to this token`
    );
  }
  const boundAddress = (projectAccount?.projectToken?.address ?? "").trim().toLowerCase();
  const subjectAddress = (tokenAddress ?? "").trim().toLowerCase();
  if (boundAddress && boundAddress !== subjectAddress) {
    return annotateOpenBridgeRows(
      `resolves through ${provenance}, but that scan bound a different token contract (${boundAddress.slice(0, 10)}\u2026), so its outcomes cannot be credited to this token`
    );
  }
  const creditLicense = projectSideConfirmed ? "" : ` \xB7 account\u2194token binding verified from the token side (${projectAccountBinding?.via === "linked-page" ? "CA published on the account's linked page" : "CA published by the account's X bio"})`;
  for (const bridge of INVESTIGATION_CHECK_BRIDGE) {
    const target = rows.find((row) => row.checkId === bridge.tokenCheckId || row.label === bridge.tokenLabel);
    if (!target || !UNKNOWN_OR_FAILED.has(target.status)) continue;
    const source = projectRows.find((row) => row.checkId === bridge.projectCheckId || row.label === bridge.projectLabel);
    if (!source) continue;
    if (!SUCCESSFUL.has(source.status)) {
      target.note = `resolves through ${provenance}, where it also did not finish (${source.status}${source.note ? `: ${source.note}` : ""})`;
      continue;
    }
    target.status = source.status;
    target.note = `recorded on ${provenance}${creditLicense}: ${source.note ?? "completed"}`;
    if (source.provider) target.provider = source.provider;
    if (source.completedAt) target.completedAt = source.completedAt;
    if (typeof source.sourceCount === "number") target.sourceCount = source.sourceCount;
  }
  return rows;
}
function personChecks(opts) {
  const { identityConfidence, realName, roles, hasAssociates } = opts;
  const resolved = identityConfidence === "Confirmed" || identityConfidence === "Probable";
  const checks = [];
  checks.push(
    identityConfidence === "Confirmed" ? { label: "Identity resolution", status: "confirmed", note: "confirmed confidence" } : identityConfidence ? { label: "Identity resolution", status: "finding", note: `${identityConfidence.toLowerCase()} confidence` } : { label: "Identity resolution", status: "unknown", note: outcomeNotRecorded }
  );
  checks.push({ label: "Profile-photo authenticity", status: "unknown", note: `AI / stock / celebrity / logo; ${outcomeNotRecorded}` });
  checks.push({ label: "Code footprint (GitHub)", status: "unknown", note: `resolved from handle / name / bio; ${outcomeNotRecorded}` });
  checks.push({ label: "Identity continuity", status: "unknown", note: `prior handles, cross-platform accounts; ${outcomeNotRecorded}` });
  checks.push(hasAssociates ? { label: "Affiliations & associates", status: "confirmed", note: "associate records present in the dossier" } : { label: "Affiliations & associates", status: "unknown", note: "no collection outcome recorded; an empty dossier is not a confirmed clean result" });
  checks.push(roles.includes("KOL") ? { label: "Promoted-token performance", status: "unknown", note: `eligible by role; ${outcomeNotRecorded}` } : { label: "Promoted-token performance", status: "not-applicable", note: "not a KOL" });
  checks.push(roles.includes("INVESTOR") ? { label: "Portfolio track record", status: "unknown", note: `eligible by role; ${outcomeNotRecorded}` } : { label: "Portfolio track record", status: "not-applicable", note: "not a fund/investor" });
  const projectChecks = [
    { label: "Canonical project token", status: "unknown", note: outcomeNotRecorded },
    { label: "Product and website substance", status: "unknown", note: outcomeNotRecorded },
    { label: "Project team identity", status: "unknown", note: outcomeNotRecorded },
    { label: "Backing and partners", status: "unknown", note: outcomeNotRecorded },
    { label: "Traction and liveness", status: "unknown", note: outcomeNotRecorded },
    { label: "Transparency and disclosures", status: "unknown", note: outcomeNotRecorded }
  ];
  checks.push(...projectChecks.map((check) => roles.includes("PROJECT") ? check : { ...check, status: "not-applicable", note: "not a project account" }));
  checks.push({ label: "News & press", status: "unknown", note: outcomeNotRecorded });
  checks.push(resolved && realName ? { label: "US legal history", status: "unknown", note: `eligible by resolved name; ${outcomeNotRecorded}` } : { label: "US legal history", status: "not-applicable", note: "needs a resolved real name" });
  checks.push(resolved && realName ? { label: "OFAC sanctions (name)", status: "unknown", note: `eligible by resolved name; ${outcomeNotRecorded}` } : { label: "OFAC sanctions (name)", status: "not-applicable", note: "needs a resolved real name" });
  checks.push({ label: "Trust-graph connections", status: "unknown", note: `ties to other audited subjects; ${outcomeNotRecorded}` });
  return checks;
}

// src/lib/reports.ts
function reportChecks(kind, payload) {
  if (kind === "token") {
    const dossier = payload;
    const checks = dossier.versionContext ? dossier.versionContext.checks.map((check) => ({ ...check })) : tokenChecks(dossier);
    return applyReportCheckContract("token", checks);
  }
  if (kind === "investigation") {
    const investigation = payload;
    const base = investigation.versionContext ? investigation.versionContext.checks.map((check) => ({ ...check })) : tokenChecks(investigation.token);
    return applyReportCheckContract("investigation", reconcileInvestigationChecks(
      base,
      investigation.token.address,
      investigation.projectAccount,
      investigation.projectAccountAudit,
      investigation.projectAccountBinding
    ));
  }
  if (kind === "person") {
    const dossier = payload;
    if (Array.isArray(dossier.checkRuns) && dossier.checkRuns.length) {
      return dossier.checkRuns.map((check) => ({ ...check }));
    }
    if (dossier.versionContext) {
      return dossier.versionContext.checks.map((check) => ({ ...check }));
    }
    return personChecks({
      identityConfidence: dossier.report.identity_confidence ?? void 0,
      realName: (dossier.display_name ?? "").trim().split(/\s+/).filter(Boolean).length >= 2,
      roles: dossier.report.roles ?? [],
      hasAssociates: (dossier.evidence.associates ?? []).length > 0
    });
  }
  return [];
}
function reportCompleteness(kind, payload, checks = reportChecks(kind, payload)) {
  const tokenAssessment = payload && typeof payload === "object" ? kind === "token" ? payload.assessment : kind === "investigation" ? payload.token?.assessment : void 0 : void 0;
  if (tokenAssessment?.provisional) return "partial";
  const dossier = kind === "person" ? payload : null;
  if (dossier?.checkRuns?.length && dossier.completeness_state === "failed") return "failed";
  if (dossier?.checkRuns?.length && dossier.completeness_state === "partial" && !hasExplicitReportCheckContract("person", checks)) return "partial";
  const contractedChecks = kind === "site" ? checks : applyReportCheckContract(kind, checks);
  if (kind !== "site") return clearanceCoverage(contractedChecks).sufficient ? "complete" : "partial";
  const inScope = checks.filter((check) => check.status !== "not-applicable");
  return inScope.length > 0 && inScope.every(
    (check) => check.status === "confirmed" || check.status === "reported" || check.status === "finding" || check.status === "checked-empty"
  ) ? "complete" : "partial";
}

// src/threat/shipping.ts
var DAY = 864e5;
var BOT_NAME = /\[bot\]$|^(github-actions|dependabot|renovate|snyk-bot|greenkeeper|mergify|semantic-release|codecov|imgbot)/i;
var NOREPLY = /noreply\.github\.com$|^noreply@|^no-reply@/i;
var MIRROR_HEADLINE = /^(sync(ed|ing)?|mirror(ed)?|export(ed)?|publish(ed)?|import(ed)?)\b.*\b(from|to|of)\b|^sync from\b|^automated sync\b/i;
var GENERIC_HEADLINE = /^(update|updates|updated|fix|fixes|fixed|wip|changes|change|misc|stuff|test|tests|tmp|temp|asdf|\.+|init|initial commit|first commit|commit|save|cleanup|minor)\.?$/i;
var DOCS_HEADLINE = /\b(docs?|readme|typo|changelog|license|comment(s)?)\b/i;
var AI_TRAILER = /co-authored-by:[^\n]*\b(claude|copilot|chatgpt|openai|cursor|codex|devin|gemini|aider|sweep|windsurf)\b|generated with \[?claude|🤖 generated with|made with (cursor|copilot)/i;
var SHIP_CLAIM = /\b(launch(ed|ing|es)?|releas(ed|e|es|ing)|shipp(ed|ing)|v\d+(\.\d+)+|mainnet|is live|now live|went live|deploy(ed|ing)|beta|alpha|new version|update is (out|live)|rolled out|rolling out)\b/i;
var PERMISSIVE = /^(MIT|Apache-2\.0|BSD-[23]-Clause|ISC|MPL-2\.0|Unlicense|CC0-1\.0|0BSD|Zlib)$/i;
var COPYLEFT = /^(GPL|AGPL|LGPL)/i;
var SOURCE_AVAILABLE = /^(BUSL|BSL|SSPL|Elastic|Commons-Clause)/i;
var MONTHS = "january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec";
var ROADMAP_RE = new RegExp(`\\b(Q[1-4]\\s*['\u2019]?(?:20)?\\d{2}|H[12]\\s*['\u2019]?(?:20)?\\d{2}|(?:${MONTHS})\\.?\\s+20\\d{2}|(?:end of|by|before|in)\\s+20\\d{2})\\b`, "gi");
var BULK_LINES = 1500;
var BULK_FILES = 15;
var TRIVIAL_LINES = 5;
var pct = (n, d) => d > 0 ? Math.round(n / d * 1e3) / 10 : 0;
var round1 = (n) => Math.round(n * 10) / 10;
var median = (xs) => {
  if (!xs.length) return void 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
var parse = (iso) => iso ? Date.parse(iso) : NaN;
var isoDate = (ms) => new Date(ms).toISOString().slice(0, 10);
function committerKind(c) {
  const name = c.authorName ?? "";
  if (BOT_NAME.test(name) || BOT_NAME.test(c.authorLogin ?? "")) return "bot";
  if (MIRROR_HEADLINE.test(c.headline) && (NOREPLY.test(c.authorKey) || !c.authorKey.includes("@"))) return "mirror";
  return "human";
}
function positionOf(value, med) {
  if (!Number.isFinite(med) || med <= 0) return "unknown";
  if (value < med * 0.5) return "below";
  if (value > med * 1.5) return "above";
  return "within";
}
function statusFromDays(days) {
  if (days == null) return "unknown";
  if (days <= 7) return "shipping";
  if (days <= 30) return "active";
  if (days <= 60) return "quiet";
  return "dormant";
}
function licenseClass(id) {
  if (!id) return "none";
  if (PERMISSIVE.test(id)) return "permissive";
  if (COPYLEFT.test(id)) return "copyleft";
  if (SOURCE_AVAILABLE.test(id)) return "source-available";
  return "unknown";
}
function roadmapDue(phrase, fallbackYearFrom) {
  const p = phrase.trim().toLowerCase().replace(/['’]/g, "");
  const year = (y) => y.length === 2 ? 2e3 + Number(y) : Number(y);
  let m = p.match(/^q([1-4])\s*(\d{2,4})$/);
  if (m) return Date.UTC(year(m[2]), Number(m[1]) * 3, 0, 23, 59, 59);
  m = p.match(/^h([12])\s*(\d{2,4})$/);
  if (m) return Date.UTC(year(m[2]), Number(m[1]) * 6, 0, 23, 59, 59);
  m = p.match(new RegExp(`^(${MONTHS})\\.?\\s+(\\d{4})$`));
  if (m) {
    const idx = "jan feb mar apr may jun jul aug sep oct nov dec".split(" ").indexOf(m[1].slice(0, 3));
    return Date.UTC(Number(m[2]), idx + 1, 0, 23, 59, 59);
  }
  m = p.match(/(\d{4})$/);
  if (m) return Date.UTC(Number(m[1]), 12, 0, 23, 59, 59);
  return fallbackYearFrom ? parse(fallbackYearFrom) : NaN;
}
function extractRoadmapClaims(text, max = 12) {
  if (!text) return [];
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  const sentences = text.replace(/\s+/g, " ").split(/(?<=[.!?•\n])\s+|\s{2,}|\s[-–—]\s/);
  for (const sentence of sentences) {
    const hits = sentence.match(ROADMAP_RE);
    if (!hits) continue;
    const due = roadmapDue(hits[0]);
    if (!Number.isFinite(due)) continue;
    const clean = sentence.trim().slice(0, 160);
    const key = `${hits[0].toLowerCase()}|${clean.toLowerCase().slice(0, 60)}`;
    if (seen.has(key) || clean.length < 12) continue;
    seen.add(key);
    out.push({ text: clean, due: new Date(due).toISOString() });
    if (out.length >= max) break;
  }
  return out;
}
function assessShipping(input) {
  const nowMs = parse(input.now);
  const windowMs = input.windowDays * DAY;
  const windowStart = nowMs - windowMs;
  const evidence = [];
  const caveats = [];
  const commits = input.commits.filter((c) => Number.isFinite(parse(c.date)) && parse(c.date) >= windowStart && parse(c.date) <= nowMs + DAY).sort((a, b) => parse(a.date) - parse(b.date));
  const weekCount = Math.max(1, Math.ceil(input.windowDays / 7));
  const weeks = [];
  for (let i = weekCount - 1; i >= 0; i--) {
    const start = nowMs - (i + 1) * 7 * DAY;
    const end = start + 7 * DAY;
    const n = commits.filter((c) => parse(c.date) >= start && parse(c.date) < end).length;
    weeks.push({ weekStart: isoDate(start), commits: n });
  }
  const activeWeeks = weeks.filter((w) => w.commits > 0).length;
  const lastCommitMs = commits.length ? parse(commits[commits.length - 1].date) : NaN;
  const pushTimes = input.repos.map((r) => parse(r.pushedAt)).filter((t) => Number.isFinite(t) && t <= nowMs + DAY);
  const lastPushMs = pushTimes.length ? Math.max(...pushTimes) : NaN;
  const recencyMs = Number.isFinite(lastCommitMs) ? lastCommitMs : lastPushMs;
  const lastCommitDaysAgo = Number.isFinite(recencyMs) ? Math.max(0, Math.round((nowMs - recencyMs) / DAY)) : void 0;
  const gaps = [];
  for (let i = 1; i < commits.length; i++) gaps.push((parse(commits[i].date) - parse(commits[i - 1].date)) / DAY);
  if (commits.length) gaps.push((nowMs - lastCommitMs) / DAY);
  const longestGapDays = gaps.length ? round1(Math.max(...gaps)) : void 0;
  const medianGapDays = gaps.length ? round1(median(gaps) ?? 0) : void 0;
  const releasesInWindow = input.repos.reduce((n, r) => n + r.releases.filter((rel) => parse(rel.publishedAt) >= windowStart && parse(rel.publishedAt) <= nowMs + DAY).length, 0);
  const status = input.repos.length === 0 && commits.length === 0 ? "unknown" : statusFromDays(lastCommitDaysAgo);
  const roster = /* @__PURE__ */ new Map();
  const last30Start = nowMs - 30 * DAY;
  const prior60Start = nowMs - 90 * DAY;
  const identities = input.identities ?? {};
  for (const c of commits) {
    const kind = committerKind(c);
    const key = kind === "mirror" ? `mirror:${c.authorKey}` : c.authorKey;
    let row = roster.get(key);
    if (!row) {
      const createdMs = parse(c.authorAccountCreatedAt);
      row = {
        key,
        name: c.authorName || c.authorLogin || c.authorKey,
        login: c.authorLogin,
        commits: 0,
        sharePct: 0,
        kind,
        accountCreatedAt: c.authorAccountCreatedAt,
        freshAccount: Number.isFinite(createdMs) && createdMs >= windowStart,
        last30: 0,
        prior60: 0
      };
      roster.set(key, row);
    }
    row.commits++;
    const t = parse(c.date);
    if (t >= last30Start) row.last30++;
    else if (t >= prior60Start) row.prior60++;
    if (!row.login && c.authorLogin) row.login = c.authorLogin;
  }
  for (const row of roster.values()) {
    const id = row.login ? identities[row.login.toLowerCase()] : void 0;
    if (!id) continue;
    if (id.twitter) row.twitter = id.twitter.replace(/^@/, "");
    if (id.company) row.company = id.company;
    if (id.website) row.website = id.website;
    if (id.orgs?.length) row.orgs = id.orgs.slice(0, 5);
    if (id.name && (!row.name || row.name === row.login)) row.name = id.name;
    if (id.createdAt && !row.accountCreatedAt) {
      row.accountCreatedAt = id.createdAt;
      row.freshAccount = parse(id.createdAt) >= windowStart;
    }
  }
  const rows = [...roster.values()].sort((a, b) => b.commits - a.commits);
  const total = commits.length;
  for (const r of rows) r.sharePct = pct(r.commits, total);
  const humans = rows.filter((r) => r.kind === "human");
  const humanCommits = humans.reduce((n, r) => n + r.commits, 0);
  const botCommits = rows.filter((r) => r.kind === "bot").reduce((n, r) => n + r.commits, 0);
  const mirrorCommits = rows.filter((r) => r.kind === "mirror").reduce((n, r) => n + r.commits, 0);
  const attributable = humanCommits + mirrorCommits;
  const top1SharePct = attributable ? pct(Math.max(...rows.filter((r) => r.kind !== "bot").map((r) => r.commits)), attributable) : 0;
  const hhi = attributable ? Math.round(rows.filter((r) => r.kind !== "bot").reduce((s, r) => s + Math.pow(r.commits / attributable, 2), 0) * 1e3) / 1e3 : 0;
  let concentration;
  if (total === 0) concentration = "unknown";
  else if (humans.length === 0) concentration = "unattributed";
  else if (top1SharePct >= 85) concentration = "single-author";
  else if (top1SharePct >= 50) concentration = "lead-plus";
  else concentration = "team";
  const priorLead = [...humans].sort((a, b) => b.prior60 - a.prior60)[0];
  const priorTotal = humans.reduce((n, r) => n + r.prior60, 0);
  const recentTotal = humans.reduce((n, r) => n + r.last30, 0);
  const leadPriorSharePct = priorLead && priorTotal ? pct(priorLead.prior60, priorTotal) : 0;
  const departed = !!priorLead && priorLead.prior60 >= 5 && priorLead.last30 === 0 && recentTotal >= 3;
  const goneQuiet = humans.filter((h) => h.prior60 >= 3 && h.last30 === 0).map((h) => h.login ? `@${h.login}` : h.name);
  const churnDetail = !priorLead || priorTotal === 0 ? "Not enough history before the last 30 days to read committer churn." : departed ? `${priorLead.login ? `@${priorLead.login}` : priorLead.name} wrote ${leadPriorSharePct}% of the prior 60 days' commits and none in the last 30 while ${recentTotal} commits landed from others: the lead has stopped and the repository has not.` : goneQuiet.length ? `${goneQuiet.length} committer${goneQuiet.length === 1 ? "" : "s"} active in the prior 60 days ${goneQuiet.length === 1 ? "has" : "have"} no commits in the last 30 (${goneQuiet.slice(0, 3).join(", ")}).` : `${priorLead.login ? `@${priorLead.login}` : priorLead.name} carried ${leadPriorSharePct}% of the prior 60 days and is still committing (${priorLead.last30} in the last 30).`;
  const measured = commits.filter((c) => c.additions != null && c.deletions != null);
  const lines = measured.map((c) => (c.additions ?? 0) + (c.deletions ?? 0));
  const files = measured.map((c) => c.files ?? 0).filter((n) => n > 0);
  const trivial = measured.filter((c) => (c.additions ?? 0) + (c.deletions ?? 0) <= TRIVIAL_LINES).length;
  const docsOnly = commits.filter((c) => DOCS_HEADLINE.test(c.headline) && !/\b(feat|feature|add|implement|fix)\b/i.test(c.headline)).length;
  const bulkDrops = measured.filter((c) => (c.additions ?? 0) + (c.deletions ?? 0) >= BULK_LINES && (c.files ?? 0) >= BULK_FILES);
  const substance = {
    measuredCommits: measured.length,
    medianLinesChanged: median(lines),
    meanLinesChanged: lines.length ? Math.round(lines.reduce((a, b) => a + b, 0) / lines.length) : void 0,
    medianFiles: median(files),
    trivialSharePct: measured.length ? pct(trivial, measured.length) : void 0,
    docsOnlySharePct: total ? pct(docsOnly, total) : void 0,
    bulkDropCount: bulkDrops.length
  };
  const aiTrailerCount = commits.filter((c) => AI_TRAILER.test(`${c.headline}
${c.body ?? ""}`)).length;
  const generic = commits.filter((c) => GENERIC_HEADLINE.test(c.headline.trim())).length;
  const mirroredSharePct = total ? pct(mirrorCommits, total) : 0;
  const authorshipEvidence = [];
  let authorship;
  if (total === 0) authorship = "unknown";
  else if (mirroredSharePct >= 80) {
    authorship = "mirrored";
    authorshipEvidence.push(`${mirroredSharePct}% of commits are sync/mirror exports from a private repository, so the public history says who published, not who wrote.`);
  } else {
    const aiShare = pct(aiTrailerCount, total);
    const genericShare = pct(generic, total);
    if (aiShare >= 30 || bulkDrops.length >= 3 && genericShare >= 30) authorship = "machine-heavy";
    else if (aiShare > 0 || genericShare >= 30 || bulkDrops.length >= 2) authorship = "mixed";
    else authorship = "hand-authored";
    if (aiTrailerCount) authorshipEvidence.push(`${aiTrailerCount} commit${aiTrailerCount === 1 ? "" : "s"} carry an AI co-author trailer (Claude, Copilot, Cursor or similar).`);
    if (genericShare >= 30) authorshipEvidence.push(`${genericShare}% of commit messages are placeholders ("update", "fix", "wip").`);
    if (bulkDrops.length) authorshipEvidence.push(`${bulkDrops.length} bulk drop${bulkDrops.length === 1 ? "" : "s"} of ${BULK_LINES}+ lines across ${BULK_FILES}+ files landed as single commits.`);
    if (authorship === "hand-authored") authorshipEvidence.push("Commit messages are specific and the change sizes are incremental, consistent with hand-authored work.");
  }
  const forks = input.repos.filter((r) => r.isFork).map((r) => ({ repo: r.nameWithOwner, parent: r.parent ?? "unknown upstream" }));
  const templates = input.repos.filter((r) => r.isTemplate).map((r) => r.nameWithOwner);
  const forkSharePct = input.repos.length ? pct(forks.length, input.repos.length) : 0;
  const bulkImports = [];
  for (const r of input.repos) {
    const first = commits.find((c) => c.repo === r.nameWithOwner);
    if (!first) continue;
    const opensWithDrop = (first.additions ?? 0) >= BULK_LINES && (first.files ?? 0) >= BULK_FILES && parse(r.createdAt) >= windowStart;
    if (opensWithDrop) bulkImports.push(r.nameWithOwner);
  }
  let origin;
  if (input.repos.length === 0) origin = "unknown";
  else if (forkSharePct >= 80 || forks.length > 0 && forks.length === input.repos.length) origin = "derivative";
  else if (forks.length > 0 || bulkImports.length > 0) origin = "partly-derivative";
  else origin = "original";
  const sample = input.stargazers ?? [];
  const starTotal = input.repos.reduce((n, r) => n + r.stars, 0);
  const starEvidence = [];
  let starVerdict;
  let lowActivitySharePct;
  let burstSharePct;
  let burstWindowStart;
  let historyStars;
  let launchBurst = false;
  const flagship = input.repos.find((r) => r.nameWithOwner === (input.starHistoryRepo ?? input.stargazerRepo)) ?? [...input.repos].sort((a, b) => b.stars - a.stars)[0];
  const proportion = (() => {
    if (!flagship || flagship.stars < 100) return null;
    const forkRatio = flagship.forks / flagship.stars;
    const watchRatio = flagship.watchers != null ? flagship.watchers / flagship.stars : void 0;
    const commitsOnFlagship = commits.filter((c) => c.repo === flagship.nameWithOwner).length;
    const thinWork = commitsOnFlagship < 5 && (flagship.commitsInWindow ?? commitsOnFlagship) < 5;
    const disproportionate = forkRatio < 0.02 && (watchRatio == null || watchRatio < 0.01) && (thinWork || flagship.stars >= 1e3);
    const line = `${flagship.nameWithOwner} has ${flagship.stars} stars against ${flagship.forks} forks${flagship.watchers != null ? ` and ${flagship.watchers} watchers` : ""}${thinWork ? " with under five commits in the window" : ""}.`;
    return { disproportionate, line };
  })();
  const history = (input.starHistory ?? []).filter((d) => Number.isFinite(parse(d.date)) && Number.isFinite(d.stars) && d.stars >= 0).sort((a, b) => parse(a.date) - parse(b.date));
  if (history.length) {
    historyStars = history.reduce((n, d) => n + d.stars, 0);
    if (historyStars >= 30) {
      let best = 0;
      let bestStart = history[0].date;
      for (let i = 0; i < history.length; i++) {
        let n = 0;
        for (let j = i; j < history.length && parse(history[j].date) - parse(history[i].date) < 3 * DAY; j++) n += history[j].stars;
        if (n > best) {
          best = n;
          bestStart = history[i].date;
        }
      }
      burstSharePct = pct(best, historyStars);
      burstWindowStart = bestStart;
      const repoAgeAtBurstDays = flagship ? (parse(bestStart) - parse(flagship.createdAt)) / DAY : void 0;
      launchBurst = repoAgeAtBurstDays != null && repoAgeAtBurstDays <= 30;
    }
  }
  if (starTotal === 0) {
    starVerdict = "none";
    starEvidence.push("No stars on the reviewed repositories, so there is nothing to authenticate.");
  } else if (sample.length >= 20) {
    const low = sample.filter((s) => {
      const created = parse(s.createdAt);
      const starred = parse(s.starredAt);
      const youngAccount = Number.isFinite(created) && Number.isFinite(starred) && starred - created <= 30 * DAY;
      const empty = (s.repos ?? 1) === 0 && (s.followers ?? 1) === 0;
      return youngAccount || empty;
    }).length;
    lowActivitySharePct = pct(low, sample.length);
    const times = sample.map((s) => parse(s.starredAt)).filter(Number.isFinite).sort((a, b) => a - b);
    let best = 0;
    let bestStart = times[0];
    for (let i = 0, j = 0; i < times.length; i++) {
      while (times[i] - times[j] > 72 * 36e5) j++;
      const n = i - j + 1;
      if (n > best) {
        best = n;
        bestStart = times[j];
      }
    }
    burstSharePct = pct(best, times.length);
    burstWindowStart = Number.isFinite(bestStart) ? new Date(bestStart).toISOString() : void 0;
    const sampledRepo = input.repos.find((r) => r.nameWithOwner === input.stargazerRepo);
    const repoAgeAtBurstDays = sampledRepo && Number.isFinite(bestStart) ? (bestStart - parse(sampledRepo.createdAt)) / DAY : void 0;
    launchBurst = repoAgeAtBurstDays != null && repoAgeAtBurstDays <= 30;
    const suspect = lowActivitySharePct >= 40 || burstSharePct >= 50 && !launchBurst;
    starVerdict = suspect ? "suspect" : "organic";
    starEvidence.push(`${lowActivitySharePct}% of ${sample.length} sampled stargazers are low-activity accounts (created within 30 days of starring, or no repos and no followers).`);
    starEvidence.push(`${burstSharePct}% of sampled stars landed inside one 72-hour window${launchBurst ? " during the repository's first month, which is a normal launch pattern" : ""}.`);
    if (suspect) starEvidence.push("This is the signature StarScout (Six Million Suspected Fake Stars, ICSE 2026) associates with purchased stars.");
  } else if (burstSharePct != null && historyStars != null && flagship) {
    const timedBurst = burstSharePct >= 50 && !launchBurst;
    const softBurst = burstSharePct >= 30 && !launchBurst;
    const suspect = timedBurst || softBurst && !!proportion?.disproportionate || !!proportion?.disproportionate && burstSharePct >= 15;
    starVerdict = suspect ? "suspect" : "organic";
    starEvidence.push(`${burstSharePct}% of ${flagship.nameWithOwner}'s ${historyStars.toLocaleString("en-US")} stars arrived inside one three-day window starting ${burstWindowStart}${launchBurst ? ", inside the repository's first month, which is a normal launch pattern" : ""}.`);
    if (proportion) starEvidence.push(proportion.line + (proportion.disproportionate ? " Organic attention brings forks, watchers and contributors along with stars; this repository has the stars alone." : ""));
    if (suspect) starEvidence.push("A star burst outside launch week, with nothing else growing alongside it, is the lockstep signature StarScout associates with purchased stars. GitHub no longer exposes who starred, so the accounts themselves cannot be checked.");
    else starEvidence.push("Star timing is spread across the history; the accounts behind the stars are no longer readable since GitHub restricted stargazer lists in June 2026.");
  } else if (proportion) {
    starVerdict = proportion.disproportionate ? "suspect" : "insufficient";
    starEvidence.push(`No star history or stargazer sample was available, so the read is proportional: ${proportion.line}`);
    if (proportion.disproportionate) starEvidence.push("Organic attention brings forks, watchers and contributors along with stars; this repository has the stars alone.");
    else starEvidence.push("The proportions are ordinary; nothing here separates bought stars from earned ones without the star history.");
  } else {
    starVerdict = "insufficient";
    starEvidence.push(historyStars != null && historyStars < 30 ? `The star history holds ${historyStars} star${historyStars === 1 ? "" : "s"}; a timing read needs at least 30.` : `Only ${sample.length} stargazer${sample.length === 1 ? "" : "s"} could be sampled; a star-authenticity read needs at least 20.`);
  }
  const hyg = {
    reposReviewed: input.repos.length,
    withLicense: input.repos.filter((r) => !!r.license).length,
    withReadme: input.repos.filter((r) => r.hasReadme).length,
    withCi: input.repos.filter((r) => r.hasCi).length,
    withTests: input.repos.filter((r) => r.hasTests).length,
    archived: input.repos.filter((r) => r.isArchived).length,
    openIssues: input.repos.reduce((n, r) => n + (r.openIssues ?? 0), 0),
    openPullRequests: input.repos.reduce((n, r) => n + (r.openPullRequests ?? 0), 0)
  };
  let hygieneVerdict = "unknown";
  if (input.repos.length) {
    const score = [hyg.withLicense, hyg.withReadme, hyg.withCi, hyg.withTests].filter((n) => n > 0).length;
    hygieneVerdict = score >= 3 ? "maintained" : score >= 1 ? "partial" : "neglected";
  }
  const price = (input.priceSeries ?? []).filter((p) => Number.isFinite(p.close) && Number.isFinite(parse(p.date)) && parse(p.date) >= windowStart).sort((a, b) => parse(a.date) - parse(b.date));
  let marketRead = "insufficient";
  let priceChangePct;
  let commitTrendPct;
  let marketDetail = "Not enough price history or commits to compare the chart with the commit log.";
  if (price.length >= 4 && total > 0) {
    priceChangePct = round1((price[price.length - 1].close - price[0].close) / price[0].close * 100);
    const mid = nowMs - windowMs / 2;
    const firstHalf = commits.filter((c) => parse(c.date) < mid).length;
    const secondHalf = total - firstHalf;
    commitTrendPct = firstHalf > 0 ? round1((secondHalf - firstHalf) / firstHalf * 100) : secondHalf > 0 ? 100 : 0;
    const shippingUp = secondHalf >= firstHalf && secondHalf > 0;
    const shippingDown = secondHalf < firstHalf * 0.5;
    if (priceChangePct <= -15 && shippingUp) {
      marketRead = "shipping-into-weakness";
      marketDetail = `Price is down ${Math.abs(priceChangePct)}% over the window while commits held or rose (${firstHalf} then ${secondHalf} per half): the team kept building through the drawdown.`;
    } else if (priceChangePct >= 30 && (shippingDown || secondHalf === 0)) {
      marketRead = "price-without-shipping";
      marketDetail = `Price is up ${priceChangePct}% while commits fell (${firstHalf} then ${secondHalf} per half): the move is not backed by visible development.`;
    } else if (priceChangePct >= 0 && shippingUp) {
      marketRead = "aligned-up";
      marketDetail = `Price (${priceChangePct >= 0 ? "+" : ""}${priceChangePct}%) and commit cadence (${firstHalf} then ${secondHalf} per half) rose together.`;
    } else if (priceChangePct < 0 && shippingDown) {
      marketRead = "aligned-down";
      marketDetail = `Price (${priceChangePct}%) and commit cadence (${firstHalf} then ${secondHalf} per half) fell together: a project going quiet, not one being ignored.`;
    } else {
      marketRead = "mixed";
      marketDetail = `Price moved ${priceChangePct >= 0 ? "+" : ""}${priceChangePct}% with commits at ${firstHalf} then ${secondHalf} per half: no clean relationship.`;
    }
  } else if (total === 0 && price.length >= 4) {
    priceChangePct = round1((price[price.length - 1].close - price[0].close) / price[0].close * 100);
    marketRead = priceChangePct >= 30 ? "price-without-shipping" : "insufficient";
    marketDetail = priceChangePct >= 30 ? `Price is up ${priceChangePct}% over a window with no commits at all.` : "No commits in the window, so there is no development to set against the chart.";
  }
  const claimsIn = (input.claims ?? []).filter((c) => SHIP_CLAIM.test(c.text) && Number.isFinite(parse(c.date)));
  const releases = input.repos.flatMap((r) => r.releases.map((rel) => ({ ...rel, repo: r.nameWithOwner })));
  const graded = claimsIn.map((claim) => {
    const at = parse(claim.date);
    const matchedCommits = commits.filter((c) => parse(c.date) >= at - 7 * DAY && parse(c.date) <= at + 2 * DAY).length;
    const rel = releases.find((r) => Math.abs(parse(r.publishedAt) - at) <= 7 * DAY);
    const grade2 = rel || matchedCommits >= 3 ? "supported" : matchedCommits > 0 ? "context" : "unsupported";
    return { ...claim, grade: grade2, matchedCommits, matchedRelease: rel?.tag };
  });
  const supported = graded.filter((g) => g.grade === "supported").length;
  const context2 = graded.filter((g) => g.grade === "context").length;
  const unsupported = graded.filter((g) => g.grade === "unsupported").length;
  const claimDetail = !graded.length ? "No shipping claims were found in the project's posts inside the window." : `${graded.length} shipping claim${graded.length === 1 ? "" : "s"} in the project's posts: ${supported} backed by a release or a burst of commits, ${context2} near light activity, ${unsupported} with nothing in the public repositories within a week.`;
  let peers;
  if (input.peers && input.peers.repos.length) {
    const subject = {
      commitsInWindow: total,
      authorsInWindow: humans.length,
      stars: starTotal
    };
    const med = {
      commitsInWindow: median(input.peers.repos.map((r) => r.commitsInWindow)) ?? 0,
      authorsInWindow: median(input.peers.repos.map((r) => r.authorsInWindow)) ?? 0,
      stars: median(input.peers.repos.map((r) => r.stars)) ?? 0
    };
    const position = {
      commits: positionOf(subject.commitsInWindow, med.commitsInWindow),
      authors: positionOf(subject.authorsInWindow, med.authorsInWindow),
      stars: positionOf(subject.stars, med.stars)
    };
    const word = (p) => p === "below" ? "below" : p === "above" ? "above" : p === "within" ? "in line with" : "not comparable to";
    peers = {
      sector: input.peers.sector,
      label: input.peers.label,
      subject,
      median: med,
      position,
      rows: input.peers.repos,
      detail: `Against ${input.peers.label} (${input.peers.repos.map((r) => r.nameWithOwner).join(", ")}): ${subject.commitsInWindow} commits is ${word(position.commits)} the peer median of ${Math.round(med.commitsInWindow)}, ${subject.authorsInWindow} human author${subject.authorsInWindow === 1 ? "" : "s"} is ${word(position.authors)} the median of ${Math.round(med.authorsInWindow)}, and ${starTotal} stars is ${word(position.stars)} the median of ${Math.round(med.stars)}.`
    };
  }
  const deploys = (input.deploys ?? []).filter((d) => Number.isFinite(parse(d.date)) && parse(d.date) >= windowStart);
  const publishes = (input.packages ?? []).flatMap((pk) => pk.versions.filter((v) => Number.isFinite(parse(v.date)) && parse(v.date) >= windowStart).map((v) => ({ ...v, name: pk.name })));
  const releaseTimes = input.repos.flatMap((r) => r.releases.map((rel) => parse(rel.publishedAt))).filter((t) => Number.isFinite(t) && t <= nowMs + DAY);
  const followsCode = (t) => releaseTimes.some((r) => t >= r && t - r <= 14 * DAY) || commits.filter((c) => parse(c.date) <= t && t - parse(c.date) <= 14 * DAY).length >= 3;
  const codeToChain = [...deploys.map((d) => parse(d.date)), ...publishes.map((p) => parse(p.date))].filter(followsCode).length;
  const verifiedDeploys = deploys.filter((d) => d.verified).length;
  let liveVerdict;
  if (!input.deploys && !input.packages) liveVerdict = "unknown";
  else if ((deploys.length || publishes.length) && codeToChain > 0) liveVerdict = "live";
  else if (deploys.length || publishes.length) liveVerdict = "deploys-without-code";
  else liveVerdict = total > 0 ? "committed-only" : "unknown";
  const liveDetail = liveVerdict === "unknown" ? "No deployer history or package registry was read, so whether the code reached production is not known." : liveVerdict === "live" ? `${deploys.length} on-chain deploy${deploys.length === 1 ? "" : "s"}${verifiedDeploys ? ` (${verifiedDeploys} verified)` : ""} and ${publishes.length} package publish${publishes.length === 1 ? "" : "es"} in the window; ${codeToChain} followed a release or a burst of commits within two weeks, so the public code is what is going live.` : liveVerdict === "deploys-without-code" ? `${deploys.length} deploy${deploys.length === 1 ? "" : "s"} and ${publishes.length} publish${publishes.length === 1 ? "" : "es"} in the window with no matching activity in the public repositories: the shipping happens somewhere this read cannot see.` : `${total} commits in the window and no on-chain deploy or package publish: work committed, nothing visibly shipped to users yet.`;
  const prsSampled = input.repos.reduce((n, r) => n + (r.pullRequestsSampled ?? 0), 0);
  const externalPrs = input.repos.reduce((n, r) => n + (r.externalPullRequests ?? 0), 0);
  const issuesSampled = input.repos.reduce((n, r) => n + (r.issuesSampled ?? 0), 0);
  const externalIssues = input.repos.reduce((n, r) => n + (r.externalIssues ?? 0), 0);
  const activeForks = input.repos.reduce((n, r) => n + (r.activeForks ?? 0), 0);
  const packageDownloads = (input.packages ?? []).reduce((n, pk) => pk.downloadsLastMonth == null ? n : (n ?? 0) + pk.downloadsLastMonth, void 0);
  const externalPrSharePct = prsSampled ? pct(externalPrs, prsSampled) : void 0;
  const externalIssueSharePct = issuesSampled ? pct(externalIssues, issuesSampled) : void 0;
  let adoptionVerdict = "unknown";
  const adoptionRead = prsSampled > 0 || issuesSampled > 0 || input.repos.some((r) => r.activeForks != null) || packageDownloads != null;
  if (adoptionRead) {
    const strong = externalPrs >= 3 || (packageDownloads ?? 0) >= 1e3 || activeForks >= 5;
    const some = externalPrs >= 1 || externalIssues >= 3 || (packageDownloads ?? 0) >= 100 || activeForks >= 1;
    adoptionVerdict = strong ? "used" : some ? "noticed" : "unused";
  }
  const adoptionDetail = !adoptionRead ? "No pull-request, issue, fork or download data was read." : `${externalPrs} of ${prsSampled} sampled pull requests and ${externalIssues} of ${issuesSampled} sampled issues came from outside the team; ${activeForks} fork${activeForks === 1 ? "" : "s"} pushed to in the window${packageDownloads != null ? `; ${packageDownloads.toLocaleString("en-US")} package downloads last month` : ""}. ${adoptionVerdict === "used" ? "Outsiders are contributing, which is the hardest attention signal to fake." : adoptionVerdict === "noticed" ? "Some outside attention, not yet outside contribution." : "Nobody outside the team is contributing, filing or forking."}`;
  const flagshipForHealth = flagship ?? input.repos[0];
  const ci = flagshipForHealth?.ciState ?? "unknown";
  const licenseId = flagshipForHealth?.license;
  const license = flagshipForHealth ? licenseClass(licenseId) : "unknown";
  const auditInTree = input.repos.some((r) => r.hasAudit);
  const lockfileAgeDays = flagshipForHealth?.lockfileUpdatedAt && Number.isFinite(parse(flagshipForHealth.lockfileUpdatedAt)) ? Math.max(0, Math.round((nowMs - parse(flagshipForHealth.lockfileUpdatedAt)) / DAY)) : void 0;
  let healthVerdict = "unknown";
  if (input.repos.length) {
    let good = 0;
    let bad = 0;
    if (ci === "success") good++;
    else if (ci === "failure") bad++;
    if (license === "permissive") good++;
    else if (license === "none") bad++;
    if (auditInTree) good++;
    if (lockfileAgeDays != null) {
      if (lockfileAgeDays <= 90) good++;
      else if (lockfileAgeDays > 365) bad++;
    }
    healthVerdict = bad === 0 && good >= 2 ? "sound" : bad >= 2 ? "poor" : "mixed";
  }
  const healthDetail = !input.repos.length ? "No repository to assess." : [
    ci === "success" ? "Latest default-branch checks pass" : ci === "failure" ? "Latest default-branch checks FAIL" : ci === "pending" ? "Latest checks still running" : "No check status exposed",
    license === "permissive" ? `${licenseId} licence (permissive)` : license === "copyleft" ? `${licenseId} licence (copyleft; derivative work must be shared)` : license === "source-available" ? `${licenseId} (source-available, not open source)` : license === "none" ? "no licence file, so the code cannot legally be reused" : `${licenseId ?? "unrecognised"} licence`,
    auditInTree ? "an audit report is in the tree" : "no audit report in the tree",
    lockfileAgeDays != null ? `dependencies last locked ${lockfileAgeDays} days ago` : "no lockfile read"
  ].join("; ") + ".";
  const weeklyMap = /* @__PURE__ */ new Map();
  let trendSource = "none";
  for (const r of input.repos) for (const w of r.weeklyCommits ?? []) {
    weeklyMap.set(w.weekStart, (weeklyMap.get(w.weekStart) ?? 0) + w.commits);
    trendSource = "provider-weekly";
  }
  if (trendSource === "none" && commits.length) {
    for (const w of weeks) weeklyMap.set(w.weekStart, w.commits);
    trendSource = "window-commits";
  }
  const trendKeys = [...weeklyMap.keys()].sort().slice(-52);
  const weekOf = (t) => trendKeys.find((k, i) => t >= parse(k) && (i === trendKeys.length - 1 || t < parse(trendKeys[i + 1])));
  const priceByWeek = /* @__PURE__ */ new Map();
  for (const pt of input.priceSeries ?? []) {
    const k = weekOf(parse(pt.date));
    if (k) {
      priceByWeek.set(k, [...priceByWeek.get(k) ?? [], pt.close]);
    }
  }
  const releasesByWeek = /* @__PURE__ */ new Map();
  for (const t of releaseTimes) {
    const k = weekOf(t);
    if (k) releasesByWeek.set(k, (releasesByWeek.get(k) ?? 0) + 1);
  }
  const deploysByWeek = /* @__PURE__ */ new Map();
  for (const d of input.deploys ?? []) {
    const k = weekOf(parse(d.date));
    if (k) deploysByWeek.set(k, (deploysByWeek.get(k) ?? 0) + 1);
  }
  const trendWeeks = trendKeys.map((k) => ({ weekStart: k, commits: weeklyMap.get(k) ?? 0, price: median(priceByWeek.get(k) ?? []), releases: releasesByWeek.get(k) ?? 0, deploys: deploysByWeek.get(k) ?? 0 }));
  const lifeCommits = trendWeeks.reduce((n, w) => n + w.commits, 0);
  const activeWeeksLife = trendWeeks.filter((w) => w.commits > 0).length;
  const trendDetail = trendSource === "none" ? "No weekly history was read." : `${lifeCommits} commits across ${activeWeeksLife} of the last ${trendWeeks.length} weeks${trendSource === "window-commits" ? " (window only; the provider's yearly statistics were not available)" : ""}.`;
  const roadmapClaims = extractRoadmapClaims(input.docsText).map((c) => {
    const due = parse(c.due);
    const from = due - 30 * DAY;
    const to = due + 30 * DAY;
    const rel = releaseTimes.filter((t) => t >= from && t <= to).length;
    const dep = deploys.filter((d) => parse(d.date) >= from && parse(d.date) <= to).length;
    const com = commits.filter((c2) => parse(c2.date) >= from && parse(c2.date) <= to).length;
    const weekly = trendWeeks.filter((w) => parse(w.weekStart) >= from - 7 * DAY && parse(w.weekStart) <= to).reduce((n, w) => n + w.commits, 0);
    let grade2;
    let evidence2;
    if (due > nowMs) {
      grade2 = "pending";
      evidence2 = `Due ${c.due.slice(0, 10)}; not yet reached.`;
    } else if (rel || dep) {
      grade2 = "met";
      evidence2 = `${rel} release${rel === 1 ? "" : "s"} and ${dep} deploy${dep === 1 ? "" : "s"} within a month of ${c.due.slice(0, 10)}.`;
    } else if (com >= 5 || weekly >= 10) {
      grade2 = "met";
      evidence2 = `${Math.max(com, weekly)} commits within a month of ${c.due.slice(0, 10)}; no tagged release or deploy to name.`;
    } else if (due < windowStart - 30 * DAY && trendSource !== "provider-weekly") {
      grade2 = "unclear";
      evidence2 = `Due ${c.due.slice(0, 10)}, before this read's history begins.`;
    } else {
      grade2 = "missed";
      evidence2 = `Nothing in the repositories within a month of ${c.due.slice(0, 10)}.`;
    }
    return { text: c.text, due: c.due, grade: grade2, evidence: evidence2 };
  });
  const roadmapMet = roadmapClaims.filter((c) => c.grade === "met").length;
  const roadmapMissed = roadmapClaims.filter((c) => c.grade === "missed").length;
  const roadmapPending = roadmapClaims.filter((c) => c.grade === "pending").length;
  const roadmapDetail = !input.docsText ? "No roadmap or docs text was read." : !roadmapClaims.length ? "The docs carry no dated promises to check." : `${roadmapClaims.length} dated promise${roadmapClaims.length === 1 ? "" : "s"} in the docs: ${roadmapMet} met, ${roadmapMissed} missed, ${roadmapPending} still ahead.`;
  const cohort = input.cohort && input.cohort.size > 0 ? {
    ...input.cohort,
    detail: `Among ${input.cohort.size} ${input.cohort.label}: ${total} commits sits ${input.cohort.percentileCommits != null ? `at the ${Math.round(input.cohort.percentileCommits)}th percentile` : `against a median of ${Math.round(input.cohort.medianCommits)}`}, ${humans.length} human author${humans.length === 1 ? "" : "s"} ${input.cohort.percentileAuthors != null ? `at the ${Math.round(input.cohort.percentileAuthors)}th` : `against a median of ${Math.round(input.cohort.medianAuthors)}`}${input.cohort.shippingSharePct != null ? `; ${Math.round(input.cohort.shippingSharePct)}% of the cohort is still shipping` : ""}.`
  } : void 0;
  const commitsCounted = input.repos.reduce((n, r) => n + (r.commitsInWindow ?? 0), 0);
  const historyRepos = new Set(commits.map((c) => c.repo)).size;
  const coverageNotes = [...input.readNotes ?? []];
  if (input.reposTotal != null && input.reposTotal > input.repos.length) coverageNotes.push(`${input.repos.length} of ${input.reposTotal} repositories reviewed (most recently pushed first).`);
  if (commitsCounted > total) coverageNotes.push(`${total} of ${commitsCounted} window commits read in detail; cadence and authorship come from the read set, the count from the provider.`);
  if (!input.starHistory?.length && starTotal > 0) coverageNotes.push("No star history was read; the star read is proportional.");
  if (!input.identities) coverageNotes.push("Committer accounts were not resolved to X handles or employers.");
  if (!input.deploys && !input.packages) coverageNotes.push("No on-chain deployer history or package registry was joined.");
  if (!input.priceSeries?.length) coverageNotes.push("No price series was joined; the chart-versus-commits read is empty.");
  if (!input.claims?.length) coverageNotes.push("No project posts were joined; shipping claims were not graded.");
  if (!input.docsText) coverageNotes.push("No roadmap or docs text was joined.");
  let grade;
  if (status === "unknown") grade = "unknown";
  else if (status === "dormant") grade = "stalled";
  else if (total < 10 || total < 30 && substance.medianLinesChanged != null && substance.medianLinesChanged < 10 && releasesInWindow === 0) grade = "thin";
  else if (concentration === "team" || concentration === "lead-plus") grade = "shipping-team";
  else grade = "shipping-solo";
  const who = concentration === "team" ? `${humans.length} people` : concentration === "lead-plus" ? `${humans.length} people with one carrying ${top1SharePct}%` : concentration === "single-author" ? "one person" : concentration === "unattributed" ? "an unattributed mirror account" : "nobody visible";
  const headline = grade === "unknown" ? `No public code activity could be read for ${input.target}.` : grade === "stalled" ? `Development has stalled: last commit ${lastCommitDaysAgo} days ago.` : grade === "thin" ? `Thin development: ${total} commit${total === 1 ? "" : "s"} in ${input.windowDays} days from ${who}.` : grade === "shipping-team" ? `Shipping as a team: ${total} commits in ${input.windowDays} days from ${who}.` : `Shipping, but it is ${who}: ${total} commits in ${input.windowDays} days.`;
  let delta;
  if (input.previous) {
    const prev = input.previous;
    const changePct = prev.totalCommits > 0 ? round1((total - prev.totalCommits) / prev.totalCommits * 100) : void 0;
    const stalled = (prev.grade === "shipping-team" || prev.grade === "shipping-solo") && (grade === "stalled" || grade === "thin" || status === "quiet" || status === "dormant");
    const parts = [];
    if (prev.grade !== grade) parts.push(`grade ${shippingGradeLabel(prev.grade).toLowerCase()} \u2192 ${shippingGradeLabel(grade).toLowerCase()}`);
    if (changePct != null) parts.push(`commits ${prev.totalCommits} \u2192 ${total} (${changePct >= 0 ? "+" : ""}${changePct}%)`);
    else if (prev.totalCommits !== total) parts.push(`commits ${prev.totalCommits} \u2192 ${total}`);
    if (prev.distinctHuman !== humans.length) parts.push(`human committers ${prev.distinctHuman} \u2192 ${humans.length}`);
    if (prev.cadenceStatus !== status) parts.push(`cadence ${prev.cadenceStatus} \u2192 ${status}`);
    delta = {
      capturedAt: prev.capturedAt,
      grade: { from: prev.grade, to: grade },
      commits: { from: prev.totalCommits, to: total, changePct },
      humans: { from: prev.distinctHuman, to: humans.length },
      cadence: { from: prev.cadenceStatus, to: status },
      stalled,
      detail: parts.length ? `Since the report of ${prev.capturedAt.slice(0, 10)}: ${parts.join("; ")}.${stalled ? " The project was shipping then and is not now." : ""}` : `Unchanged since the report of ${prev.capturedAt.slice(0, 10)}.`
    };
  }
  evidence.push(`${total} commits across ${activeWeeks} of ${weekCount} weeks; last activity ${lastCommitDaysAgo != null ? `${lastCommitDaysAgo} day${lastCommitDaysAgo === 1 ? "" : "s"} ago` : "unknown"}${longestGapDays != null ? `; longest gap ${longestGapDays} days` : ""}.`);
  if (rows.length) evidence.push(`${humans.length} human committer${humans.length === 1 ? "" : "s"}${botCommits ? `, ${pct(botCommits, total)}% bot commits` : ""}${mirrorCommits ? `, ${mirroredSharePct}% mirrored` : ""}; top author holds ${top1SharePct}% of attributable commits.`);
  if (substance.medianLinesChanged != null) evidence.push(`Median commit changes ${substance.medianLinesChanged} lines${substance.medianFiles != null ? ` across ${substance.medianFiles} files` : ""}; ${substance.trivialSharePct}% are trivial (${TRIVIAL_LINES} lines or fewer).`);
  if (releasesInWindow) evidence.push(`${releasesInWindow} tagged release${releasesInWindow === 1 ? "" : "s"} in the window.`);
  if (forks.length) evidence.push(`${forks.length} of ${input.repos.length} repositories are forks: ${forks.slice(0, 3).map((f) => `${f.repo.split("/")[1]} \u2190 ${f.parent}`).join("; ")}.`);
  if (bulkImports.length) evidence.push(`${bulkImports.length} repositor${bulkImports.length === 1 ? "y opens" : "ies open"} with a bulk code drop rather than incremental history: ${bulkImports.join(", ")}.`);
  evidence.push(...authorshipEvidence);
  if (starVerdict === "suspect") evidence.push(`Star authenticity is suspect: ${starEvidence[0]}`);
  if (departed) evidence.push(churnDetail);
  if (liveVerdict === "live" || liveVerdict === "deploys-without-code") evidence.push(liveDetail);
  if (adoptionVerdict === "used") evidence.push(adoptionDetail);
  if (roadmapMissed) evidence.push(`${roadmapMissed} dated roadmap promise${roadmapMissed === 1 ? "" : "s"} passed with nothing in the repositories to show for ${roadmapMissed === 1 ? "it" : "them"}.`);
  if (ci === "failure") evidence.push("The latest default-branch checks fail.");
  if (delta?.stalled) evidence.push(delta.detail);
  const fresh = humans.filter((h) => h.freshAccount);
  if (fresh.length) caveats.push(`${fresh.length} committer account${fresh.length === 1 ? " was" : "s were"} created inside the window; new accounts are not new people, but they carry no history to check.`);
  if (authorship === "mirrored") caveats.push("A mirrored repository can hide a real team or a single contractor equally well; ask for the private repository's contributor list.");
  if (input.repos.length && input.repos.every((r) => parse(r.createdAt) >= windowStart)) caveats.push("Every reviewed repository was created inside the window, so cadence cannot be distinguished from a launch push.");
  if (starVerdict === "insufficient") caveats.push(starEvidence[0]);
  return {
    target: input.target,
    windowDays: input.windowDays,
    grade,
    headline,
    evidence,
    caveats,
    cadence: { status, totalCommits: total, activeWeeks, weeks, lastCommitDaysAgo, longestGapDays, medianGapDays, releasesInWindow },
    committers: {
      concentration,
      distinctHuman: humans.length,
      distinctAll: rows.length,
      top1SharePct,
      botSharePct: total ? pct(botCommits, total) : 0,
      mirrorSharePct: mirroredSharePct,
      hhi,
      roster: rows.slice(0, 25),
      churn: { leadLogin: priorLead?.login, leadName: priorLead?.name, leadPriorSharePct, leadLast30: priorLead?.last30 ?? 0, departed, goneQuiet, detail: churnDetail }
    },
    substance,
    authorship: { verdict: authorship, aiTrailerCount, genericMessageSharePct: total ? pct(generic, total) : void 0, bulkDropCount: bulkDrops.length, mirroredSharePct, evidence: authorshipEvidence },
    origin: { verdict: origin, forks, forkSharePct, templates, bulkImports },
    stars: { verdict: starVerdict, total: starTotal, sampled: sample.length, repo: input.starHistoryRepo ?? input.stargazerRepo, lowActivitySharePct, burstSharePct, burstWindowStart, historyStars, launchBurst, evidence: starEvidence },
    hygiene: { verdict: hygieneVerdict, ...hyg },
    market: { read: marketRead, priceChangePct, commitTrendPct, detail: marketDetail },
    claims: { graded, supported, context: context2, unsupported, detail: claimDetail },
    ...peers ? { peers } : {},
    ...cohort ? { cohort } : {},
    live: { verdict: liveVerdict, deploysInWindow: deploys.length, verifiedDeploys, publishesInWindow: publishes.length, codeToChain, detail: liveDetail },
    adoption: { verdict: adoptionVerdict, externalPrSharePct, externalIssueSharePct, externalPrs, externalIssues, activeForks, packageDownloadsLastMonth: packageDownloads, packages: (input.packages ?? []).map((pk) => `${pk.registry}:${pk.name}`), detail: adoptionDetail },
    health: { verdict: healthVerdict, ci, license, licenseId, auditInTree, lockfileAgeDays, detail: healthDetail },
    trend: { weeks: trendWeeks, lifeCommits, activeWeeksLife, source: trendSource, detail: trendDetail },
    roadmap: { claims: roadmapClaims, met: roadmapMet, missed: roadmapMissed, pending: roadmapPending, detail: roadmapDetail },
    ...delta ? { delta } : {},
    coverage: { reposTotal: input.reposTotal, reposRead: input.repos.length, historyRepos, commitsCounted, commitsRead: total, starHistoryDays: input.starHistory?.length ?? 0, weeklyStatsRead: trendSource === "provider-weekly", identitiesRead: Object.keys(identities).length, windowDays: input.windowDays, notes: coverageNotes }
  };
}
function summarizeShipping(a, capturedAt) {
  return {
    version: 1,
    target: a.target,
    capturedAt,
    windowDays: a.windowDays,
    grade: a.grade,
    headline: a.headline,
    cadenceStatus: a.cadence.status,
    totalCommits: a.cadence.totalCommits,
    activeWeeks: a.cadence.activeWeeks,
    distinctHuman: a.committers.distinctHuman,
    concentration: a.committers.concentration,
    authorship: a.authorship.verdict,
    origin: a.origin.verdict,
    stars: a.stars.verdict,
    market: a.market.read,
    claimsSupported: a.claims.supported,
    claimsUnsupported: a.claims.unsupported,
    live: a.live.verdict,
    adoption: a.adoption.verdict,
    health: a.health.verdict,
    leadDeparted: a.committers.churn.departed,
    reposRead: a.coverage.reposRead,
    commitsRead: a.coverage.commitsRead,
    releasesInWindow: a.cadence.releasesInWindow,
    committers: a.committers.roster.slice(0, 12).map((c) => ({
      name: c.name,
      ...c.login ? { login: c.login } : {},
      commits: c.commits,
      sharePct: c.sharePct,
      kind: c.kind,
      freshAccount: c.freshAccount,
      ...c.accountCreatedAt ? { accountCreatedAt: c.accountCreatedAt } : {},
      last30: c.last30,
      prior60: c.prior60,
      ...c.twitter ? { twitter: c.twitter } : {},
      ...c.company ? { company: c.company } : {},
      ...c.orgs && c.orgs.length ? { orgs: c.orgs } : {}
    })),
    goneQuiet: a.committers.churn.goneQuiet,
    churnDetail: a.committers.churn.detail,
    license: a.health.license,
    ...a.health.licenseId ? { licenseId: a.health.licenseId } : {},
    ci: a.health.ci,
    auditInTree: a.health.auditInTree,
    ...a.health.lockfileAgeDays != null ? { lockfileAgeDays: a.health.lockfileAgeDays } : {},
    ...a.substance.medianLinesChanged != null ? { medianLinesChanged: a.substance.medianLinesChanged } : {},
    ...a.substance.medianFiles != null ? { medianFiles: a.substance.medianFiles } : {},
    ...a.substance.trivialSharePct != null ? { trivialSharePct: a.substance.trivialSharePct } : {},
    bulkDropCount: a.substance.bulkDropCount,
    aiTrailerCount: a.authorship.aiTrailerCount,
    ...a.authorship.genericMessageSharePct != null ? { genericMessageSharePct: a.authorship.genericMessageSharePct } : {},
    mirrorSharePct: a.committers.mirrorSharePct,
    starsTotal: a.stars.total,
    ...a.stars.burstSharePct != null ? { starBurstSharePct: a.stars.burstSharePct } : {},
    ...a.stars.burstWindowStart ? { starBurstWindowStart: a.stars.burstWindowStart } : {},
    ...a.stars.launchBurst != null ? { starLaunchBurst: a.stars.launchBurst } : {},
    starHistoryDays: a.coverage.starHistoryDays,
    externalPrs: a.adoption.externalPrs,
    externalIssues: a.adoption.externalIssues,
    activeForks: a.adoption.activeForks,
    ...a.adoption.packageDownloadsLastMonth != null ? { packageDownloadsLastMonth: a.adoption.packageDownloadsLastMonth } : {},
    ...a.adoption.packages.length ? { packages: a.adoption.packages } : {},
    deploysInWindow: a.live.deploysInWindow,
    publishesInWindow: a.live.publishesInWindow,
    codeToChain: a.live.codeToChain,
    ...a.peers ? {
      peerSector: a.peers.label,
      peerPositionCommits: a.peers.position.commits,
      peerPositionAuthors: a.peers.position.authors,
      peerPositionStars: a.peers.position.stars
    } : {},
    ...a.cohort ? {
      cohortLabel: a.cohort.label,
      cohortSize: a.cohort.size,
      ...a.cohort.percentileCommits != null ? { cohortPercentileCommits: a.cohort.percentileCommits } : {},
      ...a.cohort.shippingSharePct != null ? { cohortShippingSharePct: a.cohort.shippingSharePct } : {}
    } : {},
    roadmapMet: a.roadmap.met,
    roadmapMissed: a.roadmap.missed,
    roadmapPending: a.roadmap.pending,
    coverageNotes: a.coverage.notes,
    ...a.coverage.reposTotal != null ? { reposTotal: a.coverage.reposTotal } : {},
    commitsCounted: a.coverage.commitsCounted,
    hygiene: a.hygiene.verdict,
    trendWeeks: a.trend.weeks.slice(-52).map((week) => ({
      weekStart: week.weekStart,
      commits: week.commits,
      releases: week.releases,
      deploys: week.deploys,
      ...week.price != null ? { price: week.price } : {}
    })),
    trendSource: a.trend.source,
    top1SharePct: a.committers.top1SharePct,
    botSharePct: a.committers.botSharePct
  };
}
function shippingGradeLabel(grade) {
  switch (grade) {
    case "shipping-team":
      return "Shipping \xB7 team";
    case "shipping-solo":
      return "Shipping \xB7 solo";
    case "thin":
      return "Thin";
    case "stalled":
      return "Stalled";
    default:
      return "Unread";
  }
}

// src/threat/shippingCollect.ts
var GQL = "https://api.github.com/graphql";
var REST = "https://api.github.com";
var NPM_REGISTRY = "https://registry.npmjs.org";
var NPM_DOWNLOADS = "https://api.npmjs.org/downloads/point/last-month";
var PYPI_REGISTRY = "https://pypi.org/pypi";
var PYPI_DOWNLOADS = "https://pypistats.org/api/packages";
var CRATES_REGISTRY = "https://crates.io/api/v1/crates";
var API_VERSION = "2026-03-10";
var GITHUB_LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
var LOGIN_RE = GITHUB_LOGIN_RE;
var NPM_NAME_RE = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
var PYPI_NAME_RE = /^[A-Za-z0-9]([A-Za-z0-9._-]{0,80}[A-Za-z0-9])?$/;
var CRATE_NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;
var WINDOW_DAYS = 90;
var OWNER_REPOS = 10;
var OWNER_REPOS_FALLBACK = 5;
var HISTORY_REPOS = 4;
var HISTORY_PER_REPO = 100;
var IDENTITY_MAX = 25;
var PACKAGES_MAX = 3;
var STAR_HISTORY_PAGES = 4;
var STAR_HISTORY_MIN_STARS = 30;
var LOCKFILES = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "Cargo.lock", "foundry.lock"];
var gh = (key) => ({ authorization: `Bearer ${key}`, "user-agent": "argus-due-diligence" });
var fetchImpl = (...args) => fetch(...args);
async function graphql(query, variables, key, usage) {
  usage.calls += 1;
  const r = await fetchImpl(GQL, {
    method: "POST",
    headers: { ...gh(key), "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(12e3)
  });
  if (!r.ok) throw new Error(`GitHub GraphQL ${r.status}`);
  const body = await r.json();
  const hard = (body.errors ?? []).filter((e) => e.type !== "NOT_FOUND");
  if (hard.length) throw new Error(`GitHub GraphQL: ${hard[0].message}`);
  if (!body.data) throw new Error("GitHub GraphQL returned no data");
  usage.succeeded += 1;
  return body.data;
}
async function rest(path, key, usage) {
  usage.calls += 1;
  const r = await fetchImpl(REST + path, {
    headers: { ...gh(key), accept: "application/vnd.github+json", "x-github-api-version": API_VERSION },
    signal: AbortSignal.timeout(9e3)
  });
  if (r.status === 202) {
    usage.succeeded += 1;
    return { status: 202, data: null };
  }
  if (!r.ok) throw new Error(`GitHub ${r.status}`);
  const data = await r.json();
  usage.succeeded += 1;
  return { status: r.status, data };
}
async function keyless(url, usage) {
  usage.calls += 1;
  try {
    const r = await fetchImpl(url, { headers: { accept: "application/json", "user-agent": "argus-due-diligence" }, signal: AbortSignal.timeout(8e3) });
    if (!r.ok) return null;
    const data = await r.json();
    usage.succeeded += 1;
    return data;
  } catch {
    return null;
  }
}
function flattenWeeks(rows) {
  const out = [];
  for (const row of rows) {
    if (typeof row?.week !== "number" || !Array.isArray(row.days)) continue;
    row.days.forEach((n, i) => {
      if (typeof n === "number" && Number.isFinite(n)) out.push({ date: new Date((row.week + i * 86400) * 1e3).toISOString().slice(0, 10), stars: n });
    });
  }
  return out;
}
async function readStarHistory(full, key, usage) {
  const out = [];
  for (let page = 1; page <= STAR_HISTORY_PAGES; page++) {
    const { data: rows } = await rest(`/repos/${full}/stargazers/history?per_page=30&page=${page}`, key, usage);
    if (!Array.isArray(rows)) throw new Error("GitHub star history had an invalid shape");
    out.push(...flattenWeeks(rows));
    if (rows.length < 30) break;
  }
  return out;
}
async function readWeeklyCommits(full, key, usage) {
  const { status, data } = await rest(`/repos/${full}/stats/commit_activity`, key, usage);
  if (status === 202 || !Array.isArray(data)) return null;
  return data.filter((w) => typeof w?.week === "number" && typeof w.total === "number").map((w) => ({ weekStart: new Date(w.week * 1e3).toISOString().slice(0, 10), commits: w.total })).sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}
var REPO_FIELDS = `
  nameWithOwner isFork isTemplate isArchived description
  parent { nameWithOwner }
  createdAt pushedAt stargazerCount forkCount
  watchers { totalCount }
  primaryLanguage { name }
  licenseInfo { spdxId }
  releases(first: 12, orderBy: { field: CREATED_AT, direction: DESC }) { totalCount nodes { tagName publishedAt } }
  openIssues: issues(states: OPEN) { totalCount }
  openPrs: pullRequests(states: OPEN) { totalCount }
  prSample: pullRequests(last: 20, orderBy: { field: CREATED_AT, direction: ASC }) { nodes { authorAssociation createdAt } }
  issueSample: issues(last: 20, orderBy: { field: CREATED_AT, direction: ASC }) { nodes { authorAssociation createdAt } }
  forks(first: 12, orderBy: { field: PUSHED_AT, direction: DESC }) { nodes { pushedAt } }
  readme: object(expression: "HEAD:README.md") { ... on Blob { byteSize } }
  workflows: object(expression: "HEAD:.github/workflows") { ... on Tree { entries { name } } }
  testDir: object(expression: "HEAD:test") { ... on Tree { entries { name } } }
  testsDir: object(expression: "HEAD:tests") { ... on Tree { entries { name } } }
  auditsDir: object(expression: "HEAD:audits") { ... on Tree { entries { name } } }
  auditDir: object(expression: "HEAD:audit") { ... on Tree { entries { name } } }
  pkg: object(expression: "HEAD:package.json") { ... on Blob { text } }
  pyproject: object(expression: "HEAD:pyproject.toml") { ... on Blob { text } }
  cargo: object(expression: "HEAD:Cargo.toml") { ... on Blob { text } }
  defaultBranchRef { target { ... on Commit {
    history(since: $since, until: $until) { totalCount }
    statusCheckRollup { state }
    ${LOCKFILES.map((f, i) => `lock${i}: history(first: 1, path: ${JSON.stringify(f)}) { nodes { committedDate } }`).join("\n    ")}
  } } }
`;
var INSIDER = /* @__PURE__ */ new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
var isExternal = (assoc) => !!assoc && !INSIDER.has(assoc);
function packageNameOf(text) {
  if (!text || text.length > 2e5) return void 0;
  try {
    const pkg = JSON.parse(text);
    if (pkg.private === true) return void 0;
    return typeof pkg.name === "string" && NPM_NAME_RE.test(pkg.name) ? pkg.name : void 0;
  } catch {
    return void 0;
  }
}
function tomlNameUnder(text, tables, valid) {
  if (!text || text.length > 2e5) return void 0;
  for (const table of tables) {
    const start = text.indexOf(`[${table}]`);
    if (start < 0) continue;
    const body = text.slice(start + table.length + 2);
    const end = body.search(/\n\s*\[/);
    const section = end >= 0 ? body.slice(0, end) : body;
    const m = section.match(/^\s*name\s*=\s*"([^"]+)"/m);
    if (m && valid.test(m[1])) return m[1];
  }
  return void 0;
}
function normaliseRepo(r, since) {
  const target = r.defaultBranchRef?.target;
  const ciRaw = target?.statusCheckRollup?.state;
  const ciState = ciRaw === "SUCCESS" ? "success" : ciRaw === "FAILURE" || ciRaw === "ERROR" ? "failure" : ciRaw === "PENDING" || ciRaw === "EXPECTED" ? "pending" : "unknown";
  const lockDates = LOCKFILES.map((_, i) => target?.[`lock${i}`]?.nodes?.[0]?.committedDate).filter((d) => !!d).sort();
  const sinceMs = Date.parse(since);
  const prs = r.prSample?.nodes ?? [];
  const issues = r.issueSample?.nodes ?? [];
  const hasEntries = (t) => (t?.entries?.length ?? 0) > 0;
  return {
    nameWithOwner: r.nameWithOwner,
    isFork: !!r.isFork,
    parent: r.parent?.nameWithOwner,
    isTemplate: !!r.isTemplate,
    isArchived: !!r.isArchived,
    createdAt: r.createdAt,
    pushedAt: r.pushedAt ?? void 0,
    stars: r.stargazerCount ?? 0,
    forks: r.forkCount ?? 0,
    watchers: r.watchers?.totalCount,
    language: r.primaryLanguage?.name,
    license: r.licenseInfo?.spdxId ?? void 0,
    description: r.description ?? void 0,
    releases: (r.releases?.nodes ?? []).filter((n) => n.publishedAt).map((n) => ({ tag: n.tagName, publishedAt: n.publishedAt })),
    releaseCount: r.releases?.totalCount ?? 0,
    commitsInWindow: target?.history?.totalCount,
    hasReadme: (r.readme?.byteSize ?? 0) > 0,
    hasCi: hasEntries(r.workflows ?? null),
    hasTests: hasEntries(r.testDir ?? null) || hasEntries(r.testsDir ?? null),
    hasAudit: hasEntries(r.auditsDir ?? null) || hasEntries(r.auditDir ?? null),
    openIssues: r.openIssues?.totalCount,
    openPullRequests: r.openPrs?.totalCount,
    ciState,
    lockfileUpdatedAt: lockDates.length ? lockDates[lockDates.length - 1] : void 0,
    packageName: packageNameOf(r.pkg?.text),
    pypiName: tomlNameUnder(r.pyproject?.text, ["project", "tool.poetry"], PYPI_NAME_RE),
    crateName: tomlNameUnder(r.cargo?.text, ["package"], CRATE_NAME_RE),
    pullRequestsSampled: prs.length,
    externalPullRequests: prs.filter((p) => isExternal(p.authorAssociation)).length,
    issuesSampled: issues.length,
    externalIssues: issues.filter((p) => isExternal(p.authorAssociation)).length,
    activeForks: (r.forks?.nodes ?? []).filter((f) => f.pushedAt && Date.parse(f.pushedAt) >= sinceMs).length
  };
}
function normaliseCommit(c, repo) {
  const email = (c.author?.email ?? "").trim().toLowerCase();
  const login = c.author?.user?.login;
  const name = (c.author?.name ?? "").trim();
  return {
    sha: c.oid,
    date: c.committedDate,
    authorKey: email || (login ? login.toLowerCase() : name.toLowerCase()),
    authorName: name || void 0,
    authorLogin: login ?? void 0,
    authorAccountCreatedAt: c.author?.user?.createdAt,
    additions: c.additions,
    deletions: c.deletions,
    files: c.changedFilesIfAvailable ?? void 0,
    headline: c.messageHeadline,
    body: c.messageBody ?? void 0,
    repo
  };
}
var alias = (i) => `r${i}`;
var splitRepo = (full) => {
  const [owner, name] = full.split("/");
  return { owner, name };
};
async function readOwnerRepoList(owner, key, usage) {
  const q = `query($login: String!) { light: repositoryOwner(login: $login) { repositories(first: ${OWNER_REPOS}, orderBy: { field: PUSHED_AT, direction: DESC }, ownerAffiliations: OWNER, privacy: PUBLIC) { totalCount nodes { nameWithOwner } } } }`;
  const d = await graphql(q, { login: owner }, key, usage);
  if (!d.light) throw new Error("owner_not_found");
  return { names: (d.light.repositories?.nodes ?? []).map((n) => n.nameWithOwner), total: d.light.repositories?.totalCount ?? 0 };
}
async function readOwnerRepos(owner, since, until, key, usage, notes) {
  const query = (first) => `query($login: String!, $since: GitTimestamp!, $until: GitTimestamp) { repositoryOwner(login: $login) { repositories(first: ${first}, orderBy: { field: PUSHED_AT, direction: DESC }, ownerAffiliations: OWNER, privacy: PUBLIC) { totalCount nodes { ${REPO_FIELDS} } } } }`;
  const edgeTimeout = (e) => /GraphQL 50[234]/.test(String(e));
  let d;
  try {
    d = await graphql(query(OWNER_REPOS), { login: owner, since, until }, key, usage);
  } catch (e) {
    if (!edgeTimeout(e)) throw e;
    try {
      d = await graphql(query(OWNER_REPOS_FALLBACK), { login: owner, since, until }, key, usage);
      notes?.push(`GitHub timed out on the wide read; only the ${OWNER_REPOS_FALLBACK} most recently pushed repositories were reviewed.`);
    } catch (e2) {
      if (!edgeTimeout(e2)) throw e2;
      const { names, total } = await readOwnerRepoList(owner, key, usage);
      const repos = [];
      for (const full of names.slice(0, OWNER_REPOS_FALLBACK)) {
        try {
          const one = await readSingleRepo(full, since, until, key, usage);
          repos.push(...one.repos);
        } catch (e3) {
          if (!edgeTimeout(e3)) throw e3;
          notes?.push(`${full} could not be read even on its own.`);
        }
      }
      notes?.push(`GitHub timed out on the organisation read twice; ${repos.length} of ${total} repositories were read one at a time.`);
      return { repos, total };
    }
  }
  if (!d.repositoryOwner) throw new Error("owner_not_found");
  return { repos: (d.repositoryOwner.repositories?.nodes ?? []).map((r) => normaliseRepo(r, since)), total: d.repositoryOwner.repositories?.totalCount ?? 0 };
}
async function readSingleRepo(full, since, until, key, usage) {
  const { owner, name } = splitRepo(full);
  const q = `query($owner: String!, $name: String!, $since: GitTimestamp!, $until: GitTimestamp) { repository(owner: $owner, name: $name) { ${REPO_FIELDS} } }`;
  const d = await graphql(q, { owner, name, since, until }, key, usage);
  return d.repository ? { repos: [normaliseRepo(d.repository, since)], total: 1 } : { repos: [], total: 0 };
}
var HISTORY_PER_REPO_FALLBACK = 40;
var HISTORY_FIELDS_OF = (first) => `
  nameWithOwner
  defaultBranchRef { target { ... on Commit { history(first: ${first}, since: $since, until: $until) { nodes {
    oid committedDate additions deletions changedFilesIfAvailable messageHeadline messageBody
    author { name email user { login createdAt } }
  } } } } }
`;
async function readHistory(repos, since, until, key, usage, notes) {
  if (!repos.length) return [];
  const edgeTimeout = (e) => /GraphQL 50[234]/.test(String(e));
  const collect = (d) => {
    const out2 = [];
    for (const node of Object.values(d)) {
      if (!node) continue;
      for (const c of node.defaultBranchRef?.target?.history?.nodes ?? []) out2.push(normaliseCommit(c, node.nameWithOwner));
    }
    return out2;
  };
  const one = (r, i, first) => {
    const { owner, name } = splitRepo(r.nameWithOwner);
    return `${alias(i)}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { ${HISTORY_FIELDS_OF(first)} }`;
  };
  try {
    const q = `query($since: GitTimestamp!, $until: GitTimestamp) { ${repos.map((r, i) => one(r, i, HISTORY_PER_REPO)).join("\n")} }`;
    return collect(await graphql(q, { since, until }, key, usage));
  } catch (e) {
    if (!edgeTimeout(e)) throw e;
  }
  const out = [];
  let trimmed = 0;
  for (const r of repos) {
    let got = null;
    for (const first of [HISTORY_PER_REPO, HISTORY_PER_REPO_FALLBACK]) {
      try {
        got = collect(await graphql(`query($since: GitTimestamp!, $until: GitTimestamp) { ${one(r, 0, first)} }`, { since, until }, key, usage));
        if (first !== HISTORY_PER_REPO) trimmed++;
        break;
      } catch (e) {
        if (!edgeTimeout(e)) throw e;
      }
    }
    if (got) out.push(...got);
    else notes?.push(`${r.nameWithOwner}'s commit history could not be read even on its own.`);
  }
  notes?.push(`GitHub timed out on the batched history read; repositories were read one at a time${trimmed ? `, ${trimmed} with ${HISTORY_PER_REPO_FALLBACK} commits instead of ${HISTORY_PER_REPO}` : ""}.`);
  return out;
}
async function readIdentities(logins, key, usage) {
  const out = {};
  const wanted = [...new Set(logins.map((l) => l.toLowerCase()))].filter((l) => LOGIN_RE.test(l)).slice(0, IDENTITY_MAX);
  if (!wanted.length) return out;
  const parts = wanted.map((login, i) => `u${i}: user(login: ${JSON.stringify(login)}) { login name twitterUsername company websiteUrl createdAt followers { totalCount } organizations(first: 5) { nodes { login } } }`);
  const d = await graphql(`{ ${parts.join("\n")} }`, {}, key, usage);
  for (const u of Object.values(d)) {
    if (!u?.login) continue;
    out[u.login.toLowerCase()] = {
      login: u.login,
      name: u.name ?? void 0,
      twitter: u.twitterUsername ?? void 0,
      company: u.company?.trim() || void 0,
      website: u.websiteUrl ?? void 0,
      orgs: (u.organizations?.nodes ?? []).map((o) => o.login),
      followers: u.followers?.totalCount,
      createdAt: u.createdAt
    };
  }
  return out;
}
async function readPackages(declared, usage) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const { registry, name } of declared) {
    const k = `${registry}:${name}`;
    if (seen.has(k)) continue;
    seen.add(k);
    if (out.length >= PACKAGES_MAX) break;
    if (registry === "npm") {
      const enc = encodeURIComponent(name).replace("%40", "@");
      const meta = await keyless(`${NPM_REGISTRY}/${enc}`, usage);
      if (!meta?.time) continue;
      const versions = Object.entries(meta.time).filter(([v]) => v !== "created" && v !== "modified").map(([version, date]) => ({ version, date })).filter((v) => Number.isFinite(Date.parse(v.date)));
      const dl = await keyless(`${NPM_DOWNLOADS}/${enc}`, usage);
      out.push({ name, registry, versions, downloadsLastMonth: typeof dl?.downloads === "number" ? dl.downloads : void 0 });
    } else if (registry === "pypi") {
      const meta = await keyless(`${PYPI_REGISTRY}/${encodeURIComponent(name)}/json`, usage);
      if (!meta?.releases) continue;
      const versions = Object.entries(meta.releases).map(([version, files]) => ({ version, date: files?.[0]?.upload_time_iso_8601 ?? "" })).filter((v) => Number.isFinite(Date.parse(v.date)));
      const dl = await keyless(`${PYPI_DOWNLOADS}/${encodeURIComponent(name)}/recent`, usage);
      out.push({ name, registry, versions, downloadsLastMonth: typeof dl?.data?.last_month === "number" ? dl.data.last_month : void 0 });
    } else {
      const meta = await keyless(`${CRATES_REGISTRY}/${encodeURIComponent(name)}`, usage);
      if (!meta?.versions) continue;
      const versions = meta.versions.map((v) => ({ version: v.num, date: v.created_at })).filter((v) => Number.isFinite(Date.parse(v.date)));
      out.push({ name, registry, versions, downloadsLastMonth: typeof meta.crate?.recent_downloads === "number" ? Math.round(meta.crate.recent_downloads / 3) : void 0 });
    }
  }
  return out;
}
async function readPeers(sector, since, key, usage, cache) {
  const ck = `ghpeers:${sector.id}:${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}:v1`;
  const cached = cache ? await cache.get(ck) : null;
  if (cached) return cached;
  const parts = sector.repos.map((full, i) => {
    const { owner, name } = splitRepo(full);
    return `${alias(i)}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { nameWithOwner stargazerCount defaultBranchRef { target { ... on Commit { history(first: 100, since: $since) { totalCount nodes { author { email user { login } } } } } } } }`;
  });
  const q = `query($since: GitTimestamp!) { ${parts.join("\n")} }`;
  const d = await graphql(q, { since }, key, usage);
  const rows = [];
  for (const node of Object.values(d)) {
    if (!node) continue;
    const h = node.defaultBranchRef?.target?.history;
    const authors = /* @__PURE__ */ new Set();
    for (const c of h?.nodes ?? []) {
      const k = c.author?.user?.login?.toLowerCase() || c.author?.email?.toLowerCase();
      if (k && !/\[bot\]|noreply\.github\.com$/i.test(k)) authors.add(k);
    }
    rows.push({ nameWithOwner: node.nameWithOwner, commitsInWindow: h?.totalCount ?? 0, authorsInWindow: authors.size, stars: node.stargazerCount ?? 0 });
  }
  if (rows.length && cache) await cache.set(ck, rows);
  return rows;
}
async function collectShipping(opts) {
  const { target, key, usage } = opts;
  if (opts.fetchImpl) fetchImpl = opts.fetchImpl;
  const now = opts.now ?? /* @__PURE__ */ new Date();
  const windowDays = opts.windowDays ?? WINDOW_DAYS;
  const pointInTime = !!opts.pointInTime || opts.now != null && Date.now() - opts.now.getTime() > 36e5;
  const since = new Date(now.getTime() - windowDays * 864e5).toISOString();
  const until = pointInTime ? now.toISOString() : null;
  const readNotes = [];
  const { repos, total: reposTotal } = opts.kind === "repo" ? await readSingleRepo(target, since, until, key, usage) : await readOwnerRepos(target, since, until, key, usage, readNotes);
  const ranked = [...repos].sort((a, b) => Number(a.isFork) - Number(b.isFork) || (b.commitsInWindow ?? 0) - (a.commitsInWindow ?? 0));
  const active = ranked.filter((r) => (r.commitsInWindow ?? 0) > 0).slice(0, HISTORY_REPOS);
  const commits = await readHistory(active, since, until, key, usage, readNotes);
  let identities;
  const logins = [...new Set(commits.map((c) => c.authorLogin).filter((l) => !!l && !/\[bot\]$/i.test(l)))];
  if (logins.length) {
    try {
      identities = await readIdentities(logins, key, usage);
    } catch {
      readNotes.push("Committer accounts could not be resolved.");
    }
  }
  if (!pointInTime) {
    let pending = 0;
    for (const r of active) {
      try {
        const weekly = await readWeeklyCommits(r.nameWithOwner, key, usage);
        if (weekly) r.weeklyCommits = weekly;
        else pending++;
      } catch {
        pending++;
      }
    }
    if (pending) readNotes.push(`Yearly commit statistics were still being computed for ${pending} repositor${pending === 1 ? "y" : "ies"}; the trend uses the window's commits there.`);
  } else {
    readNotes.push("Point-in-time read: yearly commit statistics and peer baselines were not read.");
  }
  const flagship = [...repos].sort((a, b) => b.stars - a.stars)[0];
  let starHistory;
  if (flagship && flagship.stars >= STAR_HISTORY_MIN_STARS) {
    try {
      const days = await readStarHistory(flagship.nameWithOwner, key, usage);
      const cut = until ? days.filter((d) => d.date <= until.slice(0, 10)) : days;
      if (cut.length) starHistory = cut;
    } catch {
      readNotes.push("The star history could not be read; the star read is proportional.");
    }
  }
  readNotes.push("GitHub restricted stargazer lists to repository admins on 2026-06-30, so the accounts behind the stars are not readable.");
  let packages;
  const declared = repos.flatMap((r) => [
    ...r.packageName ? [{ registry: "npm", name: r.packageName }] : [],
    ...r.pypiName ? [{ registry: "pypi", name: r.pypiName }] : [],
    ...r.crateName ? [{ registry: "crates", name: r.crateName }] : []
  ]);
  if (declared.length && !pointInTime) {
    packages = await readPackages(declared, usage);
    if (!packages.length) packages = void 0;
  }
  let peers;
  if (opts.sector && !pointInTime) {
    try {
      const rows = await readPeers(opts.sector, since, key, usage, opts.peerCache);
      if (rows.length) peers = { sector: opts.sector.id, label: opts.sector.label, repos: rows };
    } catch {
      readNotes.push("The sector baseline could not be read.");
    }
  }
  return {
    target,
    kind: opts.kind === "user" ? "user" : "org",
    now: now.toISOString(),
    windowDays,
    repos,
    reposTotal,
    commits,
    ...identities ? { identities } : {},
    ...starHistory && flagship ? { starHistory, starHistoryRepo: flagship.nameWithOwner } : {},
    ...packages ? { packages } : {},
    ...peers ? { peers } : {},
    readNotes
  };
}

// src/threat/shippingPeers.ts
var PEER_SECTORS = [
  {
    id: "dex",
    label: "leading decentralized exchanges",
    keywords: /\b(dex|decentrali[sz]ed exchange|swap|amm|liquidity pool|router|aggregator|concentrated liquidity)\b/i,
    repos: ["Uniswap/v4-core", "Uniswap/interface", "aerodrome-finance/contracts"]
  },
  {
    id: "perps",
    label: "leading perpetuals and derivatives venues",
    keywords: /\b(perp(etual)?s?|derivatives?|leverage|futures|options?|margin trading)\b/i,
    repos: ["gmx-io/gmx-synthetics", "dydxprotocol/v4-chain", "velocity-exchange/protocol-v2"]
  },
  {
    id: "lending",
    label: "leading lending protocols",
    keywords: /\b(lend(ing)?|borrow(ing)?|money market|collateral|cdp|vault(s)? yield)\b/i,
    repos: ["aave-dao/aave-v3-origin", "morpho-org/morpho-blue", "compound-finance/comet"]
  },
  {
    id: "ai-agents",
    label: "leading crypto AI-agent frameworks",
    keywords: /\b(ai agents?|agentic|autonomous agents?|llm|virtuals|eliza|agent framework|ai[- ]powered)\b/i,
    repos: ["elizaOS/eliza", "coinbase/agentkit", "Virtual-Protocol/protocol-contracts"]
  },
  {
    id: "analytics",
    label: "leading crypto analytics and research tooling",
    keywords: /\b(analytics|research|intelligence|dashboard|screener|scanner|discovery|data platform|on-?chain data|builder[- ]intelligence)\b/i,
    repos: ["santiment/sanbase2", "electric-capital/open-dev-data", "DefiLlama/defillama-server"]
  },
  {
    id: "trading-tools",
    label: "leading open trading bots and exchange libraries",
    keywords: /\b(trading bot|market[- ]mak(er|ing)|sniper|copy[- ]trad(e|ing)|signals?|backtest|algo(rithmic)? trading|terminal)\b/i,
    repos: ["hummingbot/hummingbot", "freqtrade/freqtrade", "ccxt/ccxt"]
  },
  {
    id: "nft",
    label: "leading NFT infrastructure",
    keywords: /\b(nfts?|collectibles?|erc-?721|erc-?1155|marketplace|mint(ing)? pass|pfp)\b/i,
    repos: ["ProjectOpenSea/seaport", "manifoldxyz/creator-core-solidity", "immutable/ts-immutable-sdk"]
  },
  {
    id: "infra",
    label: "leading chain and rollup infrastructure",
    keywords: /\b(rollup|l2|layer[- ]?2|sequencer|node client|rpc|bridge|interop|infrastructure|chain)\b/i,
    repos: ["OffchainLabs/nitro", "ethereum-optimism/optimism", "paradigmxyz/reth"]
  },
  {
    id: "wallet",
    label: "leading self-custody wallets",
    keywords: /\b(wallets?|self[- ]custody|smart account|account abstraction|passkeys?)\b/i,
    repos: ["rainbow-me/rainbow", "MetaMask/metamask-extension", "RabbyHub/Rabby"]
  },
  {
    id: "stablecoin",
    label: "leading stablecoin and payments issuers",
    keywords: /\b(stablecoins?|payments?|remittance|usd-?pegged|fiat on-?ramp|synthetic dollar)\b/i,
    repos: ["circlefin/stablecoin-evm", "sky-ecosystem/dss", "paxosglobal/pyusd-contract"]
  },
  {
    id: "prediction",
    label: "leading prediction-market protocols",
    keywords: /\b(prediction markets?|binary options|outcome tokens?|betting|wager)\b/i,
    repos: ["Polymarket/ctf-exchange", "gnosis/conditional-tokens-contracts", "Azuro-protocol/Azuro-v2-public"]
  }
];
function detectPeerSector(text) {
  const hay = (text ?? "").slice(0, 4e3);
  if (!hay.trim()) return null;
  let best = null;
  for (const sector of PEER_SECTORS) {
    const re = new RegExp(sector.keywords.source, "gi");
    const hits = hay.match(re)?.length ?? 0;
    if (hits > 0 && (!best || hits > best.hits)) best = { sector, hits };
  }
  return best?.sector ?? null;
}

// src/threat/deployTrail.ts
var ETHERSCAN = "https://api.etherscan.io/v2/api";
var CHAINID = {
  ethereum: 1,
  bsc: 56,
  base: 8453,
  polygon: 137,
  arbitrum: 42161,
  optimism: 10,
  avalanche: 43114,
  fantom: 250,
  linea: 59144,
  scroll: 534352
};
var BLOCKSCOUT = {
  robinhood: "https://robinhoodchain.blockscout.com/api",
  gnosis: "https://gnosis.blockscout.com/api"
};
var MAX_RECORDS = 50;
var isAddr = (s) => /^0x[a-fA-F0-9]{40}$/.test(s);
function deployTrailReadable(chain, etherscanKey) {
  const c = chain.toLowerCase();
  return !!BLOCKSCOUT[c] || !!CHAINID[c] && !!etherscanKey;
}
async function readDeployTrail(opts) {
  const chain = opts.chain.toLowerCase();
  const wallet = opts.wallet.trim();
  if (!isAddr(wallet)) return null;
  const f = opts.fetchImpl ?? fetch;
  const params = { module: "account", action: "txlist", address: wallet, startblock: "0", endblock: "99999999", page: "1", offset: "10000", sort: "asc" };
  let url;
  if (BLOCKSCOUT[chain]) url = `${BLOCKSCOUT[chain]}?${new URLSearchParams(params)}`;
  else if (CHAINID[chain] && opts.etherscanKey) url = `${ETHERSCAN}?${new URLSearchParams({ chainid: String(CHAINID[chain]), apikey: opts.etherscanKey, ...params })}`;
  else return null;
  try {
    const r = await f(url, { headers: { accept: "application/json", "user-agent": "argus-due-diligence" }, signal: AbortSignal.timeout(opts.timeoutMs ?? 12e3) });
    if (!r.ok) return null;
    const body = await r.json();
    const rows = Array.isArray(body.result) ? body.result : [];
    if (!rows.length && !(body.status === "0" && /no transactions found/i.test(`${body.message} ${body.result}`)) && body.status !== "1") return null;
    const seen = /* @__PURE__ */ new Map();
    for (const value of rows) {
      const tx = value ?? {};
      const to = String(tx.to ?? "");
      const created = String(tx.contractAddress ?? "");
      const from = String(tx.from ?? "").toLowerCase();
      const ts = Number(tx.timeStamp);
      if (!to && created && isAddr(created) && from === wallet.toLowerCase() && !seen.has(created.toLowerCase())) {
        seen.set(created.toLowerCase(), Number.isFinite(ts) && ts > 0 ? new Date(ts * 1e3).toISOString() : "");
      }
    }
    return [...seen.entries()].filter(([, at]) => at).map(([address, at]) => ({ address, at })).slice(-MAX_RECORDS);
  } catch {
    return null;
  }
}

// server/shippingSummary.ts
var collectShippingSummary = async (githubOrg, options) => {
  const key = env("GITHUB_TOKEN");
  if (!key) return void 0;
  const usage = { calls: 0, succeeded: 0 };
  const fetchImpl2 = options?.fetchImpl;
  const token = options?.token;
  const etherscanKey = env("ETHERSCAN_API_KEY") || void 0;
  const [input, series, trail] = await Promise.all([
    collectShipping({ target: githubOrg, kind: "org", key, usage, sector: detectPeerSector(options?.sectorText ?? null), ...fetchImpl2 ? { fetchImpl: fetchImpl2 } : {} }),
    token?.address && token.chain ? fetchOhlcv(token.address, token.chain, void 0, "day").catch(() => null) : Promise.resolve(null),
    token?.deployer && token.chain && deployTrailReadable(token.chain, etherscanKey) ? readDeployTrail({ chain: token.chain, wallet: token.deployer, etherscanKey, ...fetchImpl2 ? { fetchImpl: fetchImpl2 } : {} }) : Promise.resolve(null)
  ]);
  const priceSeries = series?.candles.length ? series.candles.map((c) => ({ date: new Date(c.ts < 1e12 ? c.ts * 1e3 : c.ts).toISOString(), close: c.close })) : void 0;
  const deploys = trail ? trail.map((d) => ({ address: d.address, date: d.at, kind: "create" })) : void 0;
  const notes = [...input.readNotes ?? []];
  if (token?.address && !priceSeries) notes.push("The token's daily price series could not be read, so the chart-versus-commits read is empty.");
  if (token?.deployer && token.chain && !deployTrailReadable(token.chain, etherscanKey)) notes.push(`No explorer is configured for ${token.chain}, so the deployer's creations were not joined.`);
  return summarizeShipping(assessShipping({ ...input, readNotes: notes, ...priceSeries ? { priceSeries } : {}, ...deploys ? { deploys } : {} }), (/* @__PURE__ */ new Date()).toISOString());
};

// server/sweep.ts
var MAX_TOKEN_CHECKS = 15;
var TOKEN_CHECK_RESERVE_MS = 2e4;
var SHIPPING_GRADES = /* @__PURE__ */ new Set(["shipping-team", "shipping-solo"]);
function creds() {
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SECRET_KEY") || env("SUPABASE_SERVICE_ROLE_KEY") || env("SUPABASE_SERVICE_KEY");
  return url && key ? { url: url.replace(/\/$/, ""), key } : null;
}
var headers = (key) => ({
  apikey: key,
  ...key.startsWith("sb_secret_") ? {} : { authorization: `Bearer ${key}` },
  "content-type": "application/json"
});
var sha = (s) => createHash("sha256").update(s).digest("hex").slice(0, 24);
async function pg(c, path, init) {
  try {
    const r = await deadlineFetch(`${c.url}/rest/v1/${path}`, { ...init, headers: { ...headers(c.key), ...init?.headers }, signal: AbortSignal.timeout(1e4) });
    if (!r.ok) return null;
    const t = await r.text();
    return t ? JSON.parse(t) : [];
  } catch {
    return null;
  }
}
async function telegram(text) {
  const token = env("TELEGRAM_BOT_TOKEN");
  const chat = env("TELEGRAM_CHAT_ID");
  if (!token || !chat) return;
  try {
    await deadlineFetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text }),
      signal: AbortSignal.timeout(8e3)
    });
  } catch {
  }
}
function runSweep(organizationId, options = {}) {
  return withCostLedger(async () => {
    const result = await runSweepInLedger(organizationId, options);
    return { ...result, cost: getCost() };
  });
}
async function runSweepInLedger(organizationId, options) {
  const c = creds();
  if (!c) return { checked: 0, alerts: [], note: "no backend configured", unavailable: true };
  if (!organizationId) return { checked: 0, alerts: [], note: "organization required", unavailable: true };
  const orgFilter = `organization_id=eq.${encodeURIComponent(organizationId)}`;
  const watchRows = await pg(c, `reports?select=ref,payload&${orgFilter}&kind=eq.watch&order=ts.desc&limit=100`);
  const watches = (watchRows ?? []).map((r) => r.payload?.item).filter(Boolean);
  if (!watches.length) return { checked: 0, alerts: [], note: "watchlist empty" };
  const graphRows = await pg(c, `graph_contributions?select=handle,verdict,nodes,edges&${orgFilter}&order=updated_at.desc&limit=300`);
  const contributions = (graphRows ?? []).map((x) => ({ handle: x.handle, verdict: x.verdict ?? void 0, nodes: x.nodes ?? [], edges: x.edges ?? [] }));
  const openCaseRows = await pg(c, `cases?select=canonical_ref&${orgFilter}&status=eq.open&kind=in.(person,token,investigation)&limit=500`);
  const openCases = new Set((openCaseRows ?? []).map((row) => normalizeSubjectRef(row.canonical_ref)).filter(Boolean));
  const found = [];
  let tokenChecks2 = 0;
  let deferred = 0;
  const deadlineAt = options.deadlineAt;
  const remainingMs = () => deadlineAt == null ? Number.POSITIVE_INFINITY : deadlineAt - Date.now();
  for (const w of watches) {
    const tokenCheckWanted = w.kind === "token" && openCases.has(normalizeSubjectRef(w.id)) && tokenChecks2 < MAX_TOKEN_CHECKS;
    if (tokenCheckWanted && remainingMs() < TOKEN_CHECK_RESERVE_MS) deferred++;
    if (tokenCheckWanted && remainingMs() >= TOKEN_CHECK_RESERVE_MS) {
      tokenChecks2++;
      const input = { kind: "token", ref: w.id.includes(":") ? w.id.split(":")[1] : w.id, chain: w.chain, via: w.via ?? "evm" };
      const d = await auditToken(input, void 0, {
        skipSim: true,
        collectShipping: collectShippingSummary,
        ...deadlineAt != null ? { deadlineAt: Math.min(deadlineAt - TOKEN_CHECK_RESERVE_MS / 2, Date.now() + 6e4) } : {}
      }).catch(() => null);
      if (d && w.snapshot) {
        const s = w.snapshot;
        if (s.verdict && d.verdict !== s.verdict) {
          found.push({ subject: w.id, label: w.label, type: "drift", detail: `verdict ${s.verdict} \u2192 ${d.verdict}${d.score != null ? ` (${d.score})` : ""}`, at: Date.now() });
        } else if (typeof s.score === "number" && typeof d.score === "number" && s.score - d.score >= 12) {
          found.push({ subject: w.id, label: w.label, type: "drift", detail: `score dropped ${s.score} \u2192 ${d.score}`, at: Date.now() });
        }
        if (typeof s.liquidityUsd === "number" && s.liquidityUsd > 5e3 && (d.liquidityUsd ?? 0) < s.liquidityUsd * 0.5) {
          found.push({ subject: w.id, label: w.label, type: "drift", detail: `liquidity halved: $${Math.round(s.liquidityUsd).toLocaleString()} \u2192 $${Math.round(d.liquidityUsd ?? 0).toLocaleString()}`, at: Date.now() });
        }
        if (s.shipping && d.shipping) {
          const was = s.shipping;
          const now = d.shipping;
          const stalled = SHIPPING_GRADES.has(was.grade) && (now.grade === "stalled" || now.grade === "thin" || now.cadenceStatus === "dormant" || now.cadenceStatus === "quiet");
          const halved = was.totalCommits >= 10 && now.totalCommits <= was.totalCommits * 0.4;
          const lost = was.distinctHuman >= 2 && now.distinctHuman <= Math.floor(was.distinctHuman / 2);
          if (stalled || halved || lost || now.leadDeparted) {
            const parts = [
              stalled ? `grade ${was.grade} \u2192 ${now.grade}` : "",
              halved ? `commits ${was.totalCommits} \u2192 ${now.totalCommits} per quarter` : "",
              lost ? `human committers ${was.distinctHuman} \u2192 ${now.distinctHuman}` : "",
              now.leadDeparted ? "lead committer has stopped" : ""
            ].filter(Boolean);
            found.push({ subject: w.id, label: w.label, type: "stall", detail: `development stalled: ${parts.join("; ")}`, at: Date.now() });
          }
        }
        const item = {
          ...w,
          snapshot: {
            verdict: d.verdict,
            score: d.score,
            completenessState: reportCompleteness("token", d),
            liquidityUsd: d.liquidityUsd,
            mcap: d.mcap,
            ...d.shipping ? { shipping: { grade: d.shipping.grade, cadenceStatus: d.shipping.cadenceStatus, totalCommits: d.shipping.totalCommits, distinctHuman: d.shipping.distinctHuman, leadDeparted: d.shipping.leadDeparted } } : {}
          }
        };
        await pg(c, "reports?on_conflict=organization_id,ref,kind", {
          method: "POST",
          headers: { prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify({ organization_id: organizationId, ref: normalizeSubjectRef(w.id), kind: "watch", query: w.label, payload: { item }, ts: (/* @__PURE__ */ new Date()).toISOString() })
        });
      }
    }
    const bad = subjectConnections(w.id, contributions, 24).filter((x) => x.otherVerdict === "FAIL" || x.otherVerdict === "AVOID");
    if (bad.length) {
      const key = bad.map((b) => b.other).sort().join(",");
      found.push({ subject: w.id, label: w.label, type: "ring", detail: `connected to ${bad.map((b) => `${b.other} (${b.otherVerdict})`).join(", ")}${bad[0].ties.length ? ` via ${bad[0].ties.slice(0, 3).map((t) => t.label).join(", ")}` : ""}::${sha(key)}`, at: Date.now() });
    }
  }
  const fresh = [];
  for (const a of found) {
    const detail = a.detail.split("::")[0];
    const ref = "al:" + sha(`${a.subject}|${a.type}|${a.detail}`);
    const inserted = await pg(c, "reports?on_conflict=organization_id,ref,kind", {
      method: "POST",
      headers: { prefer: "resolution=ignore-duplicates,return=representation" },
      body: JSON.stringify({ organization_id: organizationId, ref, kind: "alert", query: a.label, payload: { subject: a.subject, label: a.label, type: a.type, detail, at: a.at }, ts: (/* @__PURE__ */ new Date()).toISOString() })
    });
    if (Array.isArray(inserted) && inserted.length > 0) fresh.push({ ...a, detail });
  }
  if (fresh.length) {
    await telegram(`ARGUS sweep: ${fresh.length} new alert${fresh.length === 1 ? "" : "s"}
` + fresh.map((a) => `\u2022 ${a.label}: ${a.detail}`).join("\n"));
  }
  return { checked: watches.length, alerts: fresh, ...deferred ? { deferred, note: `${deferred} token check${deferred === 1 ? "" : "s"} deferred: sweep time budget reached` } : {} };
}
export {
  runSweep
};
