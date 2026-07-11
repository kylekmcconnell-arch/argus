// server/sweep.ts
import { createHash } from "node:crypto";

// server/config.ts
function env(key) {
  return process.env[key];
}
var ANALYST_MODEL = process.env.ARGUS_ANALYST_MODEL || "claude-sonnet-4-6";

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
function buildAliasResolver(contributions) {
  const targets = /* @__PURE__ */ new Map();
  const add = (alias, subject) => {
    const a = canonical(alias);
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
    for (const alias of c.aliases ?? []) add(alias, subj);
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
  for (const [alias, ids] of targets) if (ids.size === 1) unique.set(alias, [...ids][0]);
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
    for (const n of c.nodes) {
      if (isGenericKey(String(n.key))) continue;
      const k = resolve(n.key);
      const label = typeof n.label === "string" && n.label.trim() ? n.label : String(n.key);
      if (k !== me) mine.set(k, { label, type: String(n.type) });
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
    if (mine.has(other)) {
      const e = ensure(other, otherLabel, c.verdict);
      e.direct = true;
    }
    for (const n of c.nodes) {
      if (isGenericKey(String(n.key))) continue;
      const k = resolve(n.key);
      if (k !== me && k !== other && mine.has(k)) {
        const e = ensure(other, otherLabel, c.verdict);
        e.ties.set(k, { key: k, label: mine.get(k).label, type: mine.get(k).type });
      }
    }
  }
  return [...byOther.entries()].map(([, v]) => ({ other: v.label, otherVerdict: v.verdict, ties: [...v.ties.values()], direct: v.direct })).filter((x) => x.ties.length > 0 || x.direct).sort((a, b) => Number(b.direct) - Number(a.direct) || b.ties.length - a.ties.length).slice(0, max);
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
  scroll: "534352"
};
async function dexByToken(address) {
  const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${address}`);
  if (!res.ok) return [];
  const d = await res.json();
  return d.pairs ?? [];
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
  const sentences = s.match(/[^.!?]+[.!?]+/g);
  if (sentences && sentences.length) s = sentences.slice(0, 2).join(" ").trim();
  if (s.length > 300) s = s.slice(0, 297).replace(/\s+\S*$/, "") + "\u2026";
  return s;
}
var CG_TIER1 = /binance|coinbase|kraken|okx|bybit|kucoin|gate|crypto\.?com|bitget|upbit|huobi|htx|mexc/i;
async function coingeckoToken(chain, address) {
  const plat = CG_PLATFORM[chain] ?? chain;
  try {
    const res = await fetch(`https://api.coingecko.com/api/v3/coins/${plat}/contract/${address}?localization=false&tickers=true&market_data=true&community_data=false&developer_data=false`);
    if (res.status === 404) return { listed: false, rank: null, mcapUsd: null, marketCount: 0, cexCount: 0, cexNames: [], homepage: null, twitter: null, image: null, description: null };
    if (!res.ok) return null;
    const d = await res.json();
    const tickers = d.tickers ?? [];
    const markets = new Set(tickers.map((t) => t.market?.name).filter(Boolean));
    const cex = new Set(tickers.filter((t) => !CG_DEX.test(t.market?.identifier || t.market?.name || "")).map((t) => t.market?.name).filter(Boolean));
    const cexNames = [...cex].sort((a, b) => (CG_TIER1.test(b) ? 1 : 0) - (CG_TIER1.test(a) ? 1 : 0)).slice(0, 12);
    const homepage = (d.links?.homepage ?? []).find((u) => typeof u === "string" && /^https?:\/\//i.test(u)) ?? null;
    const tw = typeof d.links?.twitter_screen_name === "string" ? d.links.twitter_screen_name.replace(/^@/, "").trim() : "";
    const twitter = /^[A-Za-z0-9_]{2,30}$/.test(tw) ? tw : null;
    const image = d.image?.large ?? d.image?.small ?? d.image?.thumb ?? null;
    return { listed: true, rank: d.market_cap_rank ?? null, mcapUsd: d.market_data?.market_cap?.usd ?? null, marketCount: markets.size, cexCount: cex.size, cexNames, homepage, twitter, image, description: cleanBlurb(d.description?.en) };
  } catch {
    return null;
  }
}
async function dexByPair(chain, pair) {
  const res = await fetch(`https://api.dexscreener.com/latest/dex/pairs/${chain}/${pair}`);
  if (!res.ok) return null;
  const d = await res.json();
  return d.pair ?? d.pairs?.[0] ?? null;
}
function pickPair(pairs, wantAddress) {
  if (!pairs.length) return null;
  const byLiq = [...pairs].sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
  if (wantAddress) {
    const match = byLiq.find((p) => p.baseToken?.address?.toLowerCase() === wantAddress.toLowerCase());
    if (match) return match;
  }
  return byLiq[0];
}
async function honeypotIs(chainId, address) {
  try {
    const res = await fetch(`https://api.honeypot.is/v2/IsHoneypot?address=${address}&chainID=${chainId}`);
    if (!res.ok) return null;
    const d = await res.json();
    return {
      isHoneypot: !!d.honeypotResult?.isHoneypot,
      simSuccess: !!d.simulationSuccess,
      buyTax: d.simulationResult?.buyTax ?? 0,
      sellTax: d.simulationResult?.sellTax ?? 0,
      flags: (d.flags ?? []).map((f) => f.description ?? f.flag ?? String(f))
    };
  } catch {
    return null;
  }
}
async function goplusSolana(mint) {
  try {
    const res = await fetch(`https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=${mint}`);
    if (!res.ok) return null;
    const d = await res.json();
    const row = d.result?.[mint] ?? (d.result ? Object.values(d.result)[0] : void 0);
    return row ?? null;
  } catch {
    return null;
  }
}
async function goplus(chainId, address) {
  const once = async () => {
    try {
      const res = await fetch(`https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${address}`);
      if (!res.ok) return null;
      const d = await res.json();
      return d.result?.[address.toLowerCase()] ?? (d.result ? Object.values(d.result)[0] : void 0) ?? null;
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
var clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
var num = (s) => s == null || s === "" ? null : Number(s);
var t1 = (s) => s === "1";
var solFlag = (x) => x?.status === "1";
function band(score) {
  return score >= 70 ? "PASS" : score >= 40 ? "CAUTION" : "FAIL";
}
function handleFromUrl(url) {
  if (!url) return null;
  const m = url.match(/(?:x\.com|twitter\.com)\/([A-Za-z0-9_]{2,30})/i);
  return m ? "@" + m[1].toLowerCase() : null;
}
var isBurnAddr = (a) => !!a && (/^0x0+$/.test(a) || /0*dead$/i.test(a.replace(/^0x/, "")));
var isBurnTag = (t) => /null|burn|dead|0x0{4,}/i.test(t ?? "");
function evmSafety(gp, sim) {
  const s = sim;
  const topHolderPct = gp?.holders?.length ? Number(gp.holders[0].percent) * 100 : null;
  let lpBurnedPct = 0, lpLockedPct = 0, lpTopUnlockedEoaPct = 0;
  for (const h of gp?.lp_holders ?? []) {
    const pct = Number(h.percent) * 100;
    if (!Number.isFinite(pct)) continue;
    if (isBurnAddr(h.address) || isBurnTag(h.tag)) lpBurnedPct += pct;
    else if (h.is_locked === 1) lpLockedPct += pct;
    else if (h.is_contract !== 1) lpTopUnlockedEoaPct = Math.max(lpTopUnlockedEoaPct, pct);
  }
  const lpLocked = lpBurnedPct + lpLockedPct >= 50;
  return {
    available: !!gp || !!s,
    simChecked: !!s,
    honeypot: t1(gp?.is_honeypot) || (s?.isHoneypot ?? false),
    honeypotOnchain: t1(gp?.is_honeypot) || t1(gp?.cannot_sell_all),
    serialScammerCreator: t1(gp?.honeypot_with_same_creator),
    mintable: t1(gp?.is_mintable),
    freezable: false,
    nonTransferable: false,
    ownerRenounced: !gp?.owner_address || /^0x0+$/.test(gp.owner_address || "") || gp.owner_address === "",
    takeBack: t1(gp?.can_take_back_ownership),
    hiddenOwner: t1(gp?.hidden_owner),
    selfdestruct: t1(gp?.selfdestruct),
    pausable: t1(gp?.transfer_pausable),
    openSource: t1(gp?.is_open_source),
    cannotSellAll: t1(gp?.cannot_sell_all),
    metadataMutable: false,
    buyTax: s?.simSuccess ? s.buyTax : (num(gp?.buy_tax) ?? 0) * 100,
    sellTax: s?.simSuccess ? s.sellTax : (num(gp?.sell_tax) ?? 0) * 100,
    holderCount: num(gp?.holder_count) ?? 0,
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
    creatorPercent: (num(gp?.creator_percent) ?? 0) * 100
  };
}
function solanaSafety(sol) {
  const topHolderPct = sol?.holders?.length ? Number(sol.holders[0].percent) * 100 : null;
  let lpLockedPct = 0, lpTopUnlockedEoaPct = 0;
  for (const h of sol?.lp_holders ?? []) {
    const pct = Number(h.percent) * 100;
    if (!Number.isFinite(pct)) continue;
    if (h.is_locked === 1) lpLockedPct += pct;
    else lpTopUnlockedEoaPct = Math.max(lpTopUnlockedEoaPct, pct);
  }
  const lpLocked = lpLockedPct >= 50;
  const mintable = solFlag(sol?.mintable);
  const freezable = solFlag(sol?.freezable);
  return {
    available: !!sol,
    simChecked: false,
    honeypot: !!sol?.non_transferable && sol.non_transferable === "1",
    honeypotOnchain: sol?.non_transferable === "1",
    serialScammerCreator: false,
    // GoPlus's same-creator honeypot flag is EVM-only
    mintable,
    freezable,
    nonTransferable: sol?.non_transferable === "1",
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
    holderCount: num(sol?.holder_count) ?? 0,
    topHolderPct,
    lpLocked,
    lpBurnedPct: 0,
    lpLockedPct,
    lpTopUnlockedEoaPct,
    balanceMutable: solFlag(sol?.balance_mutable_authority),
    transferHook: (sol?.transfer_hook?.length ?? 0) > 0,
    transferFee: Object.keys(sol?.transfer_fee ?? {}).length > 0,
    proxy: false,
    slippageModifiable: false,
    blacklist: false,
    tradingCooldown: false,
    externalCall: false,
    ownerChangeBalance: false,
    creatorPercent: 0
  };
}
function emptySafety() {
  return {
    available: false,
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
    creatorPercent: 0
  };
}
var _cache = /* @__PURE__ */ new Map();
var CACHE_TTL = 6e4;
async function auditToken(input, emit, opts) {
  if (input.kind !== "token") return null;
  const key = `${input.via}:${input.ref.toLowerCase()}:${opts?.skipSim ? 1 : 0}`;
  const hit = _cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.d;
  const d = await runTokenAudit(input, emit, opts);
  _cache.set(key, { at: Date.now(), d });
  return d;
}
async function runTokenAudit(input, emit, opts) {
  if (input.kind !== "token") return null;
  const trace = [];
  const step = (s2) => {
    trace.push(s2);
    emit?.(s2);
  };
  step({ phase: "P0 \xB7 Intake", label: "Resolve token", detail: `Resolving ${input.ref.slice(0, 42)} on DexScreener\u2026`, tone: "neutral" });
  let pair = null;
  if (input.via === "dexscreener") {
    const m = input.ref.match(/dexscreener\.com\/([a-z0-9]+)\/([a-zA-Z0-9]+)/i);
    if (m) pair = await dexByPair(m[1], m[2]);
    if (!pair && m) pair = pickPair(await dexByToken(m[2]), m[2]);
  } else {
    pair = pickPair(await dexByToken(input.ref), input.ref);
  }
  if (!pair || !pair.baseToken) {
    step({ phase: "P0 \xB7 Intake", label: "Not found", detail: "No DEX pair found for this contract.", tone: "warn" });
    return null;
  }
  const address = pair.baseToken.address;
  const chain = pair.chainId;
  const liquidityUsd = pair.liquidity?.usd ?? 0;
  const fdv = pair.marketCap ?? pair.fdv ?? 0;
  const vol24 = pair.volume?.h24 ?? 0;
  const buys = pair.txns?.h24?.buys ?? 0;
  const sells = pair.txns?.h24?.sells ?? 0;
  const pc24 = pair.priceChange?.h24 ?? 0;
  const ageDays = pair.pairCreatedAt ? (Date.now() - pair.pairCreatedAt) / 864e5 : void 0;
  const volLiq = liquidityUsd > 0 ? vol24 / liquidityUsd : 0;
  const washSignature = volLiq >= 15 && Math.abs(pc24) < 10 && buys + sells >= 50;
  step({ phase: "Market", label: `$${pair.baseToken.symbol}`, detail: `liquidity $${Math.round(liquidityUsd).toLocaleString()}, 24h vol $${Math.round(vol24).toLocaleString()}, mcap $${Math.round(fdv).toLocaleString()}`, source: "dexscreener", tone: liquidityUsd < 15e3 ? "warn" : "neutral" });
  const gpChain = GOPLUS_CHAIN[chain];
  let safety = emptySafety();
  let gpEvm = null;
  let sol = null;
  if (chain === "solana") {
    step({ phase: "Contract", label: "Solana safety", detail: "GoPlus Solana: mint authority, freeze authority, transfer hooks, holders\u2026", tone: "neutral" });
    sol = await goplusSolana(address);
    safety = solanaSafety(sol);
  } else if (gpChain) {
    step({ phase: "Contract", label: opts?.skipSim ? "Safety scan" : "Safety + simulation", detail: opts?.skipSim ? "GoPlus: honeypot, mint, ownership, tax, holders\u2026" : "GoPlus + honeypot.is buy/sell simulation\u2026", tone: "neutral" });
    const [gp, sim] = await Promise.all([goplus(gpChain, address), opts?.skipSim ? Promise.resolve(null) : honeypotIs(gpChain, address)]);
    gpEvm = gp;
    safety = evmSafety(gp, sim);
  } else {
    step({ phase: "Contract", label: "Limited", detail: `On-chain safety not available for ${chain} keyless; scored on market data only.`, tone: "warn" });
  }
  const findings = [];
  const caps = [];
  const s = safety;
  let cg = null;
  if (!opts?.skipSim) {
    step({ phase: "Corroborate", label: "CoinGecko cross-check", detail: "Independent listing, CEX markets, market-cap vs FDV\u2026", tone: "neutral" });
    cg = await coingeckoToken(chain, address);
  }
  const provablySellable = sells >= 10 && liquidityUsd >= 25e4;
  const broadlyTraded = (cg?.cexCount ?? 0) >= 5 || provablySellable;
  if (s.available) {
    if (s.honeypot) {
      const simOnly = !s.honeypotOnchain && !s.cannotSellAll;
      if (simOnly && broadlyTraded) {
        const why = (cg?.cexCount ?? 0) >= 5 ? `${cg.cexCount} centralized markets` : `${sells} on-chain sells against $${Math.round(liquidityUsd).toLocaleString()} liquidity in 24h`;
        findings.push({ claim: `honeypot.is reported a failed sell simulation, but the GoPlus on-chain check and ${why} contradict it \u2014 treated as a simulation artifact, not a honeypot.`, tone: "warn", source: "argus" });
      } else {
        caps.push([10, "honeypot_confirmed"]);
        findings.push({ claim: s.nonTransferable ? "Non-transferable token: holders cannot move it." : "Honeypot: the contract blocks selling.", tone: "bad", source: s.honeypotOnchain ? "goplus" : "sim" });
      }
    }
    if (s.cannotSellAll) caps.push([15, "cannot_sell_all"]);
    const cexN = cg?.cexCount ?? 0;
    const mcap = fdv;
    const established = cexN >= 5 || cexN >= 3 && mcap >= 1e7 || cexN >= 1 && mcap >= 1e8;
    const authorityTone = established ? "warn" : "bad";
    const govNote = established ? " On a token with real centralized-exchange listings this is typically a governed emissions/ops mechanism, not a rug setup \u2014 confirm the controller." : "";
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
    if (s.serialScammerCreator) {
      caps.push([25, "serial_scammer_creator"]);
      findings.push({ claim: "The wallet that deployed this token has created honeypot tokens before \u2014 a serial scammer.", tone: "bad", source: "goplus" });
    }
    if (s.sellTax >= 20) findings.push({ claim: `Sell tax is ${s.sellTax.toFixed(0)}%.`, tone: "bad", source: s.simChecked ? "sim" : "goplus" });
    if (s.simChecked && !s.honeypot) findings.push({ claim: `Sell simulation passed (buy ${s.buyTax.toFixed(0)}% / sell ${s.sellTax.toFixed(0)}%).`, tone: "good", source: "honeypot.is" });
    if (s.ownerRenounced && !s.mintable && !s.takeBack && !s.freezable) findings.push({ claim: chain === "solana" ? "Mint and freeze authority revoked." : "Ownership renounced; no mint or take-back.", tone: "good", source: "goplus" });
    const ownerActive = !s.ownerRenounced;
    if (s.ownerChangeBalance && ownerActive) {
      if (broadlyTraded) {
        findings.push({ claim: "GoPlus flags an owner-modify-balance capability, but broad CEX listing and deep liquidity indicate it is a governance/upgrade artifact, not an active threat.", tone: "warn", source: "argus" });
      } else {
        caps.push([20, "owner_can_modify_balance"]);
        findings.push({ claim: "Owner can modify holder balances directly \u2014 they can zero your wallet.", tone: "bad", source: "goplus" });
      }
    }
    if (s.proxy) findings.push({ claim: ownerActive ? "Upgradeable proxy with an active owner: the contract logic can be swapped out from under holders." : "Upgradeable proxy contract (logic is replaceable), though ownership is renounced.", tone: ownerActive ? "bad" : "warn", source: "goplus" });
    if (s.slippageModifiable && ownerActive) findings.push({ claim: "Tax is modifiable: a low tax now can be raised toward 100% after you buy.", tone: "bad", source: "goplus" });
    if (s.blacklist && ownerActive) findings.push({ claim: "Owner can blacklist addresses \u2014 your wallet can be blocked from selling.", tone: "warn", source: "goplus" });
    if (s.tradingCooldown && ownerActive) findings.push({ claim: "Trading cooldown is enforceable \u2014 sells can be delayed.", tone: "warn", source: "goplus" });
    if (s.externalCall) findings.push({ claim: "Contract makes external calls \u2014 behavior can change via an external dependency.", tone: "warn", source: "goplus" });
    if (s.creatorPercent >= 5) findings.push({ claim: `Creator still holds ~${s.creatorPercent.toFixed(0)}% of supply.`, tone: s.creatorPercent >= 15 ? "bad" : "warn", source: "goplus" });
    if (chain === "solana") {
      if (s.balanceMutable) {
        if (broadlyTraded) findings.push({ claim: "A balance-mutable authority exists, but broad market presence indicates it is not an active threat.", tone: "warn", source: "argus" });
        else {
          caps.push([20, "balance_mutable_authority"]);
          findings.push({ claim: "Balance-mutable authority is active \u2014 the controller can rewrite your token balance.", tone: "bad", source: "goplus-sol" });
        }
      }
      if (s.transferHook) findings.push({ claim: "Transfer hook active: an external program runs on every transfer and can block sells.", tone: "bad", source: "goplus-sol" });
      if (s.transferFee) findings.push({ claim: "A Token-2022 transfer fee is configured \u2014 a built-in tax on every transfer.", tone: "warn", source: "goplus-sol" });
    }
    if (s.lpBurnedPct >= 50) findings.push({ claim: `Liquidity is burned (~${s.lpBurnedPct.toFixed(0)}%) \u2014 permanently removed, it cannot be pulled.`, tone: "good", source: "goplus" });
    else if (s.lpLockedPct >= 50) findings.push({ claim: `Liquidity is locked (~${s.lpLockedPct.toFixed(0)}%).`, tone: "good", source: "goplus" });
    else if (s.lpTopUnlockedEoaPct >= 80) findings.push({ claim: `All liquidity (~${s.lpTopUnlockedEoaPct.toFixed(0)}%) sits in a single unlocked wallet \u2014 it can be pulled at any time.`, tone: "bad", source: "goplus" });
    else if (s.lpTopUnlockedEoaPct >= 50) findings.push({ claim: `Most liquidity (~${s.lpTopUnlockedEoaPct.toFixed(0)}%) is in one unlocked wallet \u2014 removable at will.`, tone: "warn", source: "goplus" });
    else findings.push({ claim: "Liquidity does not appear locked or burned.", tone: "warn", source: "goplus" });
  }
  if (liquidityUsd < 15e3) findings.push({ claim: `Thin liquidity ($${Math.round(liquidityUsd).toLocaleString()}). Easy to drain or move.`, tone: "warn", source: "dexscreener" });
  if (ageDays != null && ageDays < 7) findings.push({ claim: `Pair is ${ageDays < 1 ? "under a day" : Math.round(ageDays) + " days"} old.`, tone: "warn", source: "dexscreener" });
  if (washSignature) findings.push({ claim: `Volume is ${volLiq.toFixed(0)}x liquidity in 24h while the price moved only ${pc24.toFixed(1)}% \u2014 a wash-trading / fake-volume signature.`, tone: "bad", source: "dexscreener" });
  if (pc24 <= -60) findings.push({ claim: `Down ${Math.abs(pc24).toFixed(0)}% in 24h \u2014 the token appears to have already dumped.`, tone: "bad", source: "dexscreener" });
  else if (pc24 >= 300 && liquidityUsd < 1e5) findings.push({ claim: `Up ${pc24.toFixed(0)}% in 24h on thin liquidity \u2014 a vertical pump with high reversal risk.`, tone: "warn", source: "dexscreener" });
  if (!opts?.skipSim) {
    if (cg && !cg.listed) {
      findings.push({ claim: "Not listed on CoinGecko \u2014 no independent market-data corroboration.", tone: "warn", source: "coingecko" });
    } else if (cg) {
      findings.push({ claim: `Corroborated on CoinGecko${cg.rank ? ` (rank #${cg.rank})` : ""}, ${cg.cexCount} centralized market${cg.cexCount === 1 ? "" : "s"}.`, tone: "good", source: "coingecko" });
      if (cg.mcapUsd && fdv && fdv > cg.mcapUsd * 3) {
        findings.push({ claim: `FDV is ${(fdv / cg.mcapUsd).toFixed(1)}x circulating market cap \u2014 large unlock / dilution overhang.`, tone: "warn", source: "coingecko" });
      }
    }
  }
  const rawHolders = chain === "solana" ? sol?.holders ?? [] : gpEvm?.holders ?? [];
  const eoaHolders = rawHolders.filter(
    (h) => !(h.is_contract === 1 || h.is_contract === "1") && h.is_locked !== 1 && !/lock|burn|null|dead|pool|\blp\b|amm|cex|exchange/i.test(h.tag || "")
  );
  const topSum = eoaHolders.slice(0, 15).reduce((a, h) => a + Number(h.percent) * 100, 0);
  const holdersReliable = rawHolders.length > 0 && topSum <= 101;
  const insiderPct = holdersReliable ? Math.round(topSum) : 0;
  const bundleCount = holdersReliable ? eoaHolders.filter((h) => Number(h.percent) * 100 >= 1).length : 0;
  const bundleRisk = !holdersReliable ? "low" : insiderPct >= 45 ? "high" : insiderPct >= 25 ? "elevated" : "low";
  if (s.available && bundleRisk !== "low") {
    findings.push({
      claim: `Concentrated supply: ${bundleCount} non-contract wallets hold ~${insiderPct}% \u2014 possible bundled launch or coordinated snipe.`,
      tone: bundleRisk === "high" ? "bad" : "warn",
      source: chain === "solana" ? "goplus-sol" : "goplus"
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
  } else if (s.available) {
    aT1 = clamp(aT1 - 3, 0, 24);
    lpNote = ", LP not locked";
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
  axes.push({ key: "T3", label: "Taxes & tradeability", score: aT3, weight: 12, rationale: s.available ? chain === "solana" ? "no transfer tax detected." : `buy ${s.buyTax.toFixed(0)}% / sell ${s.sellTax.toFixed(0)}%${s.simChecked ? " (simulated)" : ""}.` : "Tax not verifiable keyless." });
  const topPct = holdersReliable ? s.topHolderPct : null;
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
  const t4Note = !s.available ? "Holder data not verifiable keyless." : !holdersReliable ? `${s.holderCount.toLocaleString()} holders; distribution not reliably reported by the free data tier.` : `${s.holderCount.toLocaleString()} holders${topPct != null ? `, top holder ${topPct.toFixed(0)}%` : ""}${bundleRisk !== "low" ? `, ~${insiderPct}% in ${bundleCount} fresh wallets` : ""}.`;
  axes.push({ key: "T4", label: "Holder distribution", score: aT4, weight: 16, rationale: t4Note });
  let aT5 = vol24 < 500 ? 4 : volLiq > 25 ? 4 : volLiq > 8 ? 7 : volLiq < 0.02 ? 5 : 11;
  const total = buys + sells;
  if (washSignature) aT5 = 2;
  else if (total > 20 && sells / total > 0.8) aT5 = clamp(aT5 - 2, 0, 12);
  if (pc24 <= -60) aT5 = clamp(aT5 - 3, 0, 12);
  axes.push({ key: "T5", label: "Trading authenticity", score: aT5, weight: 12, rationale: washSignature ? `vol/liquidity ${volLiq.toFixed(1)}x but price flat (${pc24.toFixed(1)}%) \u2014 wash-trade signature.` : `24h vol/liquidity ${volLiq.toFixed(2)}x, ${buys} buys / ${sells} sells.` });
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
  const raw = Math.round(axes.reduce((a, x) => a + x.score, 0));
  let capApplied = null;
  let score = raw;
  let verdict;
  if (caps.length) {
    const [ceiling, key] = caps.reduce((m, c) => c[0] < m[0] ? c : m);
    score = Math.min(raw, ceiling);
    capApplied = key;
    verdict = ceiling <= 10 ? "AVOID" : band(score);
  } else verdict = band(score);
  const projectX = handleFromUrl((pair.info?.socials ?? []).find((x) => /twitter|x/i.test(x.type))?.url) || handleFromUrl((pair.info?.websites ?? []).map((w) => w.url).find((u) => /x\.com|twitter\.com/i.test(u))) || (cg?.twitter ? "@" + cg.twitter : null);
  const deployer = chain === "solana" ? sol?.creators?.[0]?.address ?? null : gpEvm?.creator_address || (gpEvm?.owner_address && !/^0x0+$/.test(gpEvm.owner_address) ? gpEvm.owner_address : null) || null;
  const topHolders = rawHolders.slice(0, 10).map((h) => ({
    address: h.address ?? h.account ?? "",
    percent: Number(h.percent) * 100,
    tag: h.tag || void 0,
    isContract: h.is_contract === 1 || h.is_contract === "1"
  })).filter((h) => h.address);
  const graph = buildGraph(chain, address, pair.baseToken.symbol, verdict, projectX, deployer, topHolders, socials);
  const headline = buildHeadline(verdict, capApplied, s, liquidityUsd, projectX);
  step({ phase: "Finalize", label: "Verdict", detail: `${verdict} \xB7 ${score}/100${capApplied ? ` (cap: ${capApplied})` : ""}`, tone: verdict === "PASS" ? "good" : verdict === "CAUTION" ? "warn" : "bad" });
  return {
    address,
    chain,
    dexId: pair.dexId,
    pairAddress: pair.pairAddress,
    symbol: pair.baseToken.symbol,
    name: pair.baseToken.name,
    imageUrl: pair.info?.imageUrl ?? cg?.image ?? void 0,
    priceUsd: pair.priceUsd ? Number(pair.priceUsd) : void 0,
    mcap: fdv,
    liquidityUsd,
    vol24,
    ageDays,
    priceChange: pair.priceChange,
    verdict,
    score,
    capApplied,
    headline,
    axes,
    safety: s,
    socials,
    projectX,
    deployer,
    topHolders,
    insiderPct,
    bundleCount,
    bundleRisk,
    cg,
    graph,
    findings,
    trace,
    live: true,
    safetyChecked: s.available
  };
}
function buildGraph(chain, address, symbol, verdict, projectX, deployer, holders, socials) {
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
    nodes.push({ type: "Person", key: projectX });
    edges.push({ src: center, dst: projectX, type: "TEAM" });
  }
  if (deployer) {
    const k = walletEntityKey(chain, deployer);
    nodes.push({ type: "Identity", subtype: "Wallet", key: k, label: "wallet:" + deployer.slice(0, 8), chain, address: deployer });
    edges.push({ src: center, dst: k, type: "DEPLOYED_BY" });
  }
  holders.slice(0, 4).forEach((h) => {
    const k = walletEntityKey(chain, h.address);
    nodes.push({ type: "Identity", subtype: "Wallet", key: k, label: (h.tag || "holder") + ":" + h.address.slice(0, 8), chain, address: h.address, concentration: h.percent });
    edges.push({ src: center, dst: k, type: "HELD_BY", verdict: h.percent > 25 ? "Contradicted" : void 0 });
  });
  socials.slice(0, 3).forEach((x) => {
    const xh = x.url.match(/(?:x\.com|twitter\.com)\/([A-Za-z0-9_]{2,30})/i)?.[1];
    const key = xh ? "@" + xh : x.url.match(/^https?:\/\/(?:www\.)?([^/]+)/i)?.[1];
    if (!key || projectX && key.toLowerCase() === projectX.toLowerCase()) return;
    nodes.push({ type: "Company", key });
    edges.push({ src: center, dst: key, type: "LINKS" });
  });
  return { nodes, edges };
}
function buildHeadline(verdict, cap, s, liq, projectX) {
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

// server/sweep.ts
var MAX_TOKEN_CHECKS = 15;
function creds() {
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY") || env("SUPABASE_SERVICE_KEY");
  return url && key ? { url: url.replace(/\/$/, ""), key } : null;
}
var headers = (key) => ({ apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" });
var sha = (s) => createHash("sha256").update(s).digest("hex").slice(0, 24);
async function pg(c, path, init) {
  try {
    const r = await fetch(`${c.url}/rest/v1/${path}`, { ...init, headers: { ...headers(c.key), ...init?.headers }, signal: AbortSignal.timeout(1e4) });
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
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text }),
      signal: AbortSignal.timeout(8e3)
    });
  } catch {
  }
}
async function runSweep() {
  const c = creds();
  if (!c) return { checked: 0, alerts: [], note: "no backend configured" };
  const watchRows = await pg(c, "reports?select=ref,payload&kind=eq.watch&order=ts.desc&limit=100");
  const watches = (watchRows ?? []).map((r) => r.payload?.item).filter(Boolean);
  if (!watches.length) return { checked: 0, alerts: [], note: "watchlist empty" };
  const graphRows = await pg(c, "graph_contributions?select=handle,verdict,nodes,edges&order=updated_at.desc&limit=300");
  const contributions = (graphRows ?? []).map((x) => ({ handle: x.handle, verdict: x.verdict ?? void 0, nodes: x.nodes ?? [], edges: x.edges ?? [] }));
  const found = [];
  let tokenChecks = 0;
  for (const w of watches) {
    if (w.kind === "token" && tokenChecks < MAX_TOKEN_CHECKS) {
      tokenChecks++;
      const input = { kind: "token", ref: w.id, via: w.via ?? "evm" };
      const d = await auditToken(input, void 0, { skipSim: true }).catch(() => null);
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
        const item = { ...w, snapshot: { verdict: d.verdict, score: d.score, liquidityUsd: d.liquidityUsd, mcap: d.mcap } };
        await pg(c, "reports?on_conflict=ref,kind", {
          method: "POST",
          headers: { prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify({ ref: w.id.toLowerCase(), kind: "watch", query: w.label, payload: { item }, ts: (/* @__PURE__ */ new Date()).toISOString() })
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
    const inserted = await pg(c, "reports?on_conflict=ref,kind", {
      method: "POST",
      headers: { prefer: "resolution=ignore-duplicates,return=representation" },
      body: JSON.stringify({ ref, kind: "alert", query: a.label, payload: { subject: a.subject, label: a.label, type: a.type, detail, at: a.at }, ts: (/* @__PURE__ */ new Date()).toISOString() })
    });
    if (Array.isArray(inserted) && inserted.length > 0) fresh.push({ ...a, detail });
  }
  if (fresh.length) {
    await telegram(`ARGUS sweep: ${fresh.length} new alert${fresh.length === 1 ? "" : "s"}
` + fresh.map((a) => `\u2022 ${a.label} \u2014 ${a.detail}`).join("\n"));
  }
  return { checked: watches.length, alerts: fresh };
}
export {
  runSweep
};
