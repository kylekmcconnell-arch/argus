// Token classification — decided at the OUTSET of a scan, before judging, so the
// rest of the assessment reads the token as what it IS rather than holding every
// token to a utility-token yardstick. A community meme coin with an anon team is
// a normal meme coin, not a failed utility project; a tokenized stock with a live
// mint authority is an issuance mechanism, not an infinite-mint rug switch.
//
// Classes:
//   meme          — community/attention coin; value is the crowd, not cash flows
//   utility       — the token does something (protocol, governance, gas, access)
//   rwa           — claims real-world-asset backing or buys/distributes RWAs
//   equity        — tokenized stock/share; tracks or represents equity
//   security-like — profit-sharing / dividend / revenue-share mechanics
//   unknown       — not enough context to call it
//
// The call is heuristic and CONTEXTUAL: CoinGecko's own taxonomy first (the
// project told CG what it is), then the code's read tokenomics (what the tax
// actually DOES outranks what the blurb says), then launch venue, description
// language, and ticker culture. Every matched signal is kept as plain English so
// the report can show its work.

import type { TokenDossier } from "../token/audit";
import type { CodeTokenomics } from "./solidity";

export type TokenKind = "meme" | "utility" | "rwa" | "equity" | "security-like" | "unknown";

export interface TokenClassification {
  kind: TokenKind;
  confidence: "high" | "medium" | "low";
  label: string; // display chip: "MEME COIN"
  signals: string[]; // plain-English evidence for the call
  lens: string; // one line: how this class of token is assessed
}

const LABEL: Record<TokenKind, string> = {
  meme: "MEME COIN",
  utility: "UTILITY",
  rwa: "RWA",
  equity: "EQUITY",
  "security-like": "SECURITY-LIKE",
  unknown: "UNCLASSIFIED",
};

// How each class is judged — shown under the verdict so the reader knows which
// yardstick the findings were measured against.
const LENS: Record<TokenKind, string> = {
  meme: "Assessed as a meme coin: its value is attention and distribution, not cash flows. An anonymous team is the norm here, not a red flag — it is judged on exit mechanics, liquidity custody, and holder spread.",
  utility: "Assessed as a utility token: it claims to do something, so it is judged on whether the code and team can deliver — source verification, docs, and a team you can find matter here.",
  rwa: "Assessed as an RWA token: the real-world backing claim IS the risk — issuer credibility and custody of the underlying matter more than the chart.",
  equity: "Assessed as tokenized equity: mint/redeem authority held by the issuer is part of the design, not a rug switch — the issuer's credibility and the tracking mechanism are the risk.",
  "security-like": "Assessed as security-like: dividend / profit-sharing mechanics add securities-law exposure on top of ordinary market risk.",
  unknown: "Class unclear from available context — assessed with full generic scrutiny.",
};

// ---- pattern banks ----
// CoinGecko category names (project-declared taxonomy).
const CAT_MEME = /meme/i;
const CAT_EQUITY = /tokenized stock|equit(y|ies)|stocks?\b/i;
const CAT_RWA = /real[- ]world|rwa|tokenized (gold|treasur|commodit|real estate|bond)/i;
const CAT_UTILITY = /defi|decentralized (exchange|finance)|infrastructure|smart contract|layer.?[0-9]|oracle|gaming|artificial intelligence|\bai\b|lending|borrowing|staking|payment|storage|identity|privacy|dex\b|derivatives|launchpad|wallet|bridge|governance|liquid staking|yield/i;

// Free-text (name + symbol + CG blurb) language.
const TXT_EQUITY = /tokenized (stock|share|equit)|\bxstocks?\b|equity token|represents? (a )?share|tracks? the (price of|stock)|mirrors? .{0,20}(stock|share|equity)|\b(dinari|backed finance)\b/i;
const TXT_RWA = /\brwa\b|real[- ]world asset|(backed|collateralized) by (gold|silver|us ?treasur|t-?bills?|real estate|bonds?|commodit)|tokenized (gold|silver|treasur|real estate|commodit|bond)/i;
const TXT_SECURITY = /dividends?|revenue.?shar(e|ing)|profit.?shar(e|ing)|share of (the )?(revenue|profits?|fees)|passive income|(pays?|earn) .{0,20}yield/i;
const TXT_MEME = /\bmeme\b|memecoin|community[- ](coin|token|driven)|for fun|no (intrinsic )?(value|utility)|just a (dog|cat|frog|coin|token)|\binu\b|\bpepe\b|\bshiba?\b|\bdoge\b|\bwojak\b|mascot/i;
const TXT_UTILITY = /protocol|governance|staking|infrastructure|oracle|layer.?[12]\b|\bdex\b|lending|borrow|payment|gas token|native token|access to|platform|network fee|ecosystem|\bdapp\b|compute|bridge|validator/i;
// Ticker culture — weak signal on its own, only ever a tiebreaker.
const TICKER_MEME = /^(.*(INU|DOGE|PEPE|SHIB|ELON|MOON|CHAD|WOJAK|BABY|CAT|WIF|BONK|TRUMP|FROG).*)$/i;

// Meme-launchpad venues (pump.fun & descendants) — where a token is BORN says a
// lot about what it is. Pump.fun mints end in "pump", LetsBonk mints in "bonk".
const MEME_LAUNCHPAD_DEX = /pump|moonshot|boop|bags|believe|launchlab|four\.?meme|sunpump|daos/i;
const MEME_MINT_SUFFIX = /(pump|bonk)$/i;

export function classifyToken(d: TokenDossier, code: CodeTokenomics | null = null): TokenClassification {
  const score: Record<Exclude<TokenKind, "unknown">, number> = { meme: 0, utility: 0, rwa: 0, equity: 0, "security-like": 0 };
  const why: Record<Exclude<TokenKind, "unknown">, string[]> = { meme: [], utility: [], rwa: [], equity: [], "security-like": [] };
  const add = (k: Exclude<TokenKind, "unknown">, pts: number, reason: string) => { score[k] += pts; why[k].push(reason); };

  // 1. CoinGecko's own taxonomy — the project told an aggregator what it is.
  const cats = d.cg?.categories ?? [];
  const cat = (re: RegExp) => cats.filter((c) => re.test(c));
  const memeCats = cat(CAT_MEME);
  const equityCats = cat(CAT_EQUITY).filter((c) => !CAT_MEME.test(c));
  const rwaCats = cat(CAT_RWA);
  const utilCats = cat(CAT_UTILITY).filter((c) => !CAT_MEME.test(c) && !CAT_RWA.test(c));
  if (memeCats.length) add("meme", 3, `CoinGecko files it under ${memeCats.map((c) => `"${c}"`).join(", ")}`);
  if (equityCats.length) add("equity", 3, `CoinGecko files it under ${equityCats.map((c) => `"${c}"`).join(", ")}`);
  if (rwaCats.length) add("rwa", 3, `CoinGecko files it under ${rwaCats.map((c) => `"${c}"`).join(", ")}`);
  if (utilCats.length) add("utility", 2, `CoinGecko files it under ${utilCats.slice(0, 3).map((c) => `"${c}"`).join(", ")}`);

  // 2. What the code actually DOES (read from verified source) — outranks blurbs.
  const dests = code?.taxDestinations ?? [];
  if (dests.includes("rwa-distribution")) {
    add("rwa", 3, "the contract's tax buys real-world assets/stocks and distributes them to holders");
    add("security-like", 2, "asset distribution to holders is a profit-sharing mechanic");
  }
  if (dests.includes("reflection")) add("security-like", 1, "reflections pay holders a share of every taxed transfer");

  // 3. Free text: name, symbol, and the project's own CG blurb.
  const txt = [d.name, d.symbol, d.cg?.description ?? ""].join(" · ");
  if (TXT_EQUITY.test(txt)) add("equity", 2, "describes itself as tokenized stock/equity");
  if (TXT_RWA.test(txt)) add("rwa", 2, "describes real-world-asset backing");
  if (TXT_SECURITY.test(txt)) add("security-like", 2, "advertises dividends / revenue share / passive income");
  if (TXT_MEME.test(txt)) add("meme", 2, "describes itself in meme/community terms");
  if (TXT_UTILITY.test(txt)) add("utility", 1, "describes protocol/platform utility");

  // 4. Launch venue: born on a meme launchpad = a meme coin until proven otherwise.
  if (MEME_LAUNCHPAD_DEX.test(d.dexId) || MEME_MINT_SUFFIX.test(d.address)) {
    add("meme", 2, `launched on a meme launchpad (${MEME_MINT_SUFFIX.test(d.address) ? "pump.fun-class mint" : d.dexId})`);
  }
  // 5. Ticker culture — a nudge, never decisive alone.
  if (TICKER_MEME.test(d.symbol)) add("meme", 1, `ticker "$${d.symbol}" reads as meme culture`);

  // ---- pick the winner ----
  // Tie-break order is deliberate: the more specific/consequential claim wins.
  // (SHIB carries both "Meme" and DeFi categories — meme outranks utility; a
  // tokenized stock with utility language is still equity.)
  const order: Exclude<TokenKind, "unknown">[] = ["equity", "rwa", "security-like", "meme", "utility"];
  let kind: TokenKind = "unknown";
  let best = 0;
  for (const k of order) if (score[k] > best) { best = score[k]; kind = k; }

  if (kind === "unknown") {
    // No positive signal anywhere. A fresh token with no listing, no description
    // and no claimed function is, in practice, a meme/community coin — that IS
    // the contextual read, held at low confidence.
    if (!d.cg?.listed && !d.cg?.description) {
      return {
        kind: "meme", confidence: "low", label: LABEL.meme,
        signals: ["no aggregator listing, no description, no claimed function — the default read for an unlabeled fresh token is a meme/community coin"],
        lens: LENS.meme,
      };
    }
    return { kind: "unknown", confidence: "low", label: LABEL.unknown, signals: ["no classification signal matched"], lens: LENS.unknown };
  }

  const runnerUp = Math.max(...order.filter((k) => k !== kind).map((k) => score[k]));
  const confidence: TokenClassification["confidence"] = best >= 3 && best - runnerUp >= 2 ? "high" : best >= 2 ? "medium" : "low";
  return { kind, confidence, label: LABEL[kind], signals: why[kind as Exclude<TokenKind, "unknown">], lens: LENS[kind] };
}
