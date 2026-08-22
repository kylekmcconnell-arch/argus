// Chronological reading spine for a token report
// (docs/REPORT-EXPERIENCE-BRIEF-2026-08-17.md, token beats).
//
// Person reports already narrate themselves through buildDossier(). Token
// reports keep a different order: launch → liquidity → holders → contract →
// presence → gaps. Headings are counts and recorded states only. A missing
// collector is an unestablished figure, never silence.

import type { TokenDossier } from "../token/audit";
import { deployerRoleLabel } from "../token/audit";
import type { DossierBeat, DossierFigure, DossierReceipt, DossierSourceRow } from "./dossierModel";
import type { ProvenanceState } from "./provenance";

export interface TokenStory {
  beats: DossierBeat[];
  gaps: string[];
  sources: DossierSourceRow[];
  headline: DossierFigure[];
}

const EMPTY = "not recorded";

function money(n?: number | null): string | null {
  if (n == null || !Number.isFinite(n)) return null;
  if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
  return "$" + n.toFixed(2);
}

function ageLabel(days: number): string {
  if (days < 1) return "under 1 day";
  const n = Math.round(days);
  return `${n} day${n === 1 ? "" : "s"}`;
}

function clock(iso?: string | null): string | null {
  if (!iso) return null;
  const match = iso.match(/T(\d{2}:\d{2}:\d{2})/);
  return match ? match[1] : iso.slice(0, 10);
}

function sourceHost(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); }
  catch { return ""; }
}

function dexUrl(d: TokenDossier): string | null {
  const chain = d.chain?.trim();
  const ref = d.pairAddress || d.address;
  if (!chain || !ref) return null;
  return `https://dexscreener.com/${encodeURIComponent(chain)}/${encodeURIComponent(ref)}`;
}

function cgUrl(d: TokenDossier): string | null {
  const id = d.cg?.id?.trim();
  return id ? `https://www.coingecko.com/en/coins/${encodeURIComponent(id)}` : null;
}

function recordedWhen(d: TokenDossier): string {
  return clock(d.versionContext?.createdAt ?? d.viewVersionContext?.createdAt) ?? "recorded";
}

function receipt(passage: string, sourceLabel: string, url: string | null, when: string): DossierReceipt {
  return {
    passage,
    sourceLabel,
    url: url ?? "",
    chain: [["Recorded in this scan", when]],
    sources: url ? [{ url, sourceLabel, passage, capturedAt: null }] : [],
  };
}

function figure(
  label: string,
  value: string,
  provenance: ProvenanceState,
  rec: DossierReceipt | null,
): DossierFigure {
  return { label, value, provenance, receipt: rec, unboundNote: null };
}

function sourced(label: string, value: string, rec: DossierReceipt): DossierFigure {
  return figure(label, value, { tier: "sourced" }, rec);
}

function derived(label: string, value: string, rec: DossierReceipt): DossierFigure {
  return figure(label, value, { tier: "derived" }, rec);
}

function unestablished(label: string, value = EMPTY): DossierFigure {
  return figure(label, value, { tier: "unestablished" }, null);
}

/**
 * Collector holes a customer can act on. Shared with the Unknowns panel so
 * the story and the later gap list cannot disagree.
 */
export function tokenDataGaps(d: TokenDossier): string[] {
  const gaps: string[] = [];
  const evm = d.chain !== "solana";
  if (!d.safety.available) {
    gaps.push("ARGUS could not check the token contract on this network. The score uses market data only.");
  } else if (evm && !d.safety.openSource) {
    gaps.push("The contract code is not public or verified, so ARGUS cannot fully inspect what it can do.");
  }
  if (evm && d.safety.available && !d.safety.simChecked) {
    gaps.push("ARGUS did not test a real buy and sell. Fees and sellability come from contract settings instead.");
  }
  if (!d.deployer) {
    gaps.push("ARGUS could not identify the wallet that created the token, so it could not trace its funding or other launches.");
  }
  if (!d.cg) {
    gaps.push("CoinGecko does not list this token, so ARGUS could not confirm its market through that independent source.");
  }
  if (!d.projectX) {
    gaps.push("No official X/social account was found linked to the token.");
  }
  if (!d.topHolders.length) {
    gaps.push("Holder distribution is unavailable. Concentration can't be assessed.");
  }
  return gaps;
}

function collectSourceRows(figures: DossierFigure[]): DossierSourceRow[] {
  type Acc = { url: string; className: string; citedLabels: string[]; established: boolean };
  const groups = new Map<string, Acc>();
  for (const fig of figures) {
    const rec = fig.receipt;
    if (!rec) continue;
    const listed = rec.sources.length > 0
      ? rec.sources
      : rec.url
        ? [{ url: rec.url, sourceLabel: rec.sourceLabel, passage: rec.passage, capturedAt: null }]
        : [];
    const seen = new Set<string>();
    for (const source of listed) {
      if (!source.url) continue;
      const key = source.url;
      if (seen.has(key)) continue;
      seen.add(key);
      const cls = source.sourceLabel.includes(" · ")
        ? source.sourceLabel.split(" · ").slice(1).join(" · ")
        : "collector";
      const existing = groups.get(key);
      if (!existing) {
        groups.set(key, {
          url: source.url,
          className: cls,
          citedLabels: [fig.label],
          established: fig.provenance.tier !== "unestablished",
        });
        continue;
      }
      existing.citedLabels.push(fig.label);
      if (fig.provenance.tier !== "unestablished") existing.established = true;
    }
  }
  return [...groups.values()]
    .map((group) => ({
      url: group.url,
      label: `${sourceHost(group.url) || "source"} · ${group.className}`,
      factsCited: group.citedLabels.length,
      lastCaptured: null,
      citedLabels: group.citedLabels,
      established: group.established,
    }))
    .sort((a, b) => b.factsCited - a.factsCited || a.label.localeCompare(b.label));
}

function launchBeat(d: TokenDossier, when: string): DossierBeat {
  const dex = dexUrl(d);
  const market = receipt(
    d.ageDays != null
      ? `DexScreener pair age recorded as ${ageLabel(d.ageDays)}.`
      : "DexScreener did not record a pair-creation age for this token.",
    "DexScreener · market",
    dex,
    when,
  );
  const figures: DossierFigure[] = [];
  if (d.ageDays != null) figures.push(sourced("Pair age", ageLabel(d.ageDays), market));
  else figures.push(unestablished("Pair age"));

  if (d.deployer) {
    const proven = d.deployerAttribution?.kind === "deployer";
    const role = deployerRoleLabel(d.deployerAttribution);
    const rec = receipt(
      proven
        ? `${role} ${d.deployer} named by ${d.deployerAttribution?.source ?? "the collector"} (${d.deployerAttribution?.method ?? "recorded"}).`
        : `${role} ${d.deployer} is named without a confirmed creation signature.`,
      `${d.deployerAttribution?.source ?? "collector"} · ${d.deployerAttribution?.method ?? "attribution"}`,
      dex,
      when,
    );
    figures.push(proven
      ? sourced(role, `${d.deployer.slice(0, 6)}…${d.deployer.slice(-4)}`, rec)
      : derived(role, `${d.deployer.slice(0, 6)}…${d.deployer.slice(-4)}`, rec));
  } else {
    figures.push(unestablished("Creating wallet"));
  }

  const sentences: string[] = [];
  sentences.push(d.ageDays != null ? `The pair is ${ageLabel(d.ageDays)} old.` : "Launch age was not recorded.");
  if (!d.deployer) sentences.push("The creating wallet was not identified.");
  else if (d.deployerAttribution?.kind === "deployer") sentences.push("The deployer wallet is on record.");
  else sentences.push("A creator or authority wallet is named, not a proven deployer.");

  return {
    id: "launch",
    label: "Launch",
    kicker: "Launch",
    heading: sentences.join(" "),
    figures,
  };
}

function liquidityBeat(d: TokenDossier, when: string): DossierBeat {
  const s = d.safety;
  const dex = dexUrl(d);
  const liq = money(d.liquidityUsd);
  const market = receipt(
    liq ? `DexScreener liquidity recorded as ${liq}.` : "DexScreener did not record liquidity.",
    "DexScreener · market",
    dex,
    when,
  );
  const figures: DossierFigure[] = [];
  figures.push(liq ? sourced("Liquidity", liq, market) : unestablished("Liquidity"));

  const lpKnown = s.lpAssessed === true || (s.available && s.lpAssessed !== false);
  if (s.lpAssessed === false || (!s.available && s.lpAssessed !== true)) {
    figures.push(unestablished("LP lock"));
  } else if (lpKnown) {
    const lockValue = s.lpBurnedPct >= 50
      ? `burned ${s.lpBurnedPct.toFixed(0)}%`
      : s.lpLockedPct >= 50
        ? `locked ${s.lpLockedPct.toFixed(0)}%`
        : s.lpTopUnlockedEoaPct >= 50
          ? `1 wallet ${s.lpTopUnlockedEoaPct.toFixed(0)}%`
          : "not locked";
    figures.push(sourced(
      "LP lock",
      lockValue,
      receipt(`LP lock state recorded as ${lockValue}.`, "Contract / LP collector · onchain", dex, when),
    ));
  }

  const sentences: string[] = [];
  sentences.push(liq ? `Liquidity is ${liq}.` : "Liquidity was not recorded.");
  if (s.lpAssessed === false || (!s.available && s.lpAssessed !== true)) {
    sentences.push("The lock state was not assessed.");
  } else if (s.lpBurnedPct >= 50) {
    sentences.push(`${s.lpBurnedPct.toFixed(0)}% of the LP is recorded as burned.`);
  } else if (s.lpLockedPct >= 50) {
    sentences.push(`${s.lpLockedPct.toFixed(0)}% of the LP is recorded as locked.`);
  } else if (lpKnown) {
    sentences.push("The LP is not recorded as locked or burned.");
  }

  return {
    id: "liquidity",
    label: "Liquidity",
    kicker: "Liquidity",
    heading: sentences.join(" "),
    figures,
  };
}

function holdersBeat(d: TokenDossier, when: string): DossierBeat {
  const s = d.safety;
  const suppressed = d.holdersAssessed === false;
  const figures: DossierFigure[] = [];
  const rec = receipt(
    suppressed
      ? "Holder list was self-inconsistent and suppressed."
      : s.holderCount > 0
        ? `${s.holderCount.toLocaleString()} holders recorded.`
        : "No holder count was recorded.",
    "Holder collector · onchain",
    dexUrl(d),
    when,
  );

  if (suppressed) {
    figures.push(unestablished("Holders", "suppressed"));
    figures.push(unestablished("Top holder"));
  } else {
    if (s.holderCount > 0) figures.push(sourced("Holders", s.holderCount.toLocaleString(), rec));
    else figures.push(unestablished("Holders"));
    if (s.topHolderPct != null) {
      figures.push(sourced("Top holder", `${Number(s.topHolderPct).toFixed(0)}%`, rec));
    } else {
      figures.push(unestablished("Top holder"));
    }
  }

  if (s.creatorPercentAssessed) {
    const pct = s.creatorPercent >= 10 ? `${s.creatorPercent.toFixed(0)}%` : `${s.creatorPercent.toFixed(1)}%`;
    figures.push(sourced(
      "Creator holdings",
      pct,
      receipt(`Creator share recorded as ${pct}.`, "Holder collector · onchain", dexUrl(d), when),
    ));
  } else {
    figures.push(unestablished("Creator holdings"));
  }

  const sentences: string[] = [];
  if (suppressed) sentences.push("Holder distribution was suppressed as inconsistent.");
  else if (s.holderCount > 0) sentences.push(`${s.holderCount.toLocaleString()} holders are on record.`);
  else sentences.push("Holder distribution is unavailable.");
  if (!suppressed && s.topHolderPct != null) {
    sentences.push(`The largest holder is recorded at ${Number(s.topHolderPct).toFixed(0)}%.`);
  }

  return {
    id: "holders",
    label: "Holders",
    kicker: "Holders",
    heading: sentences.join(" "),
    figures,
  };
}

function contractBeat(d: TokenDossier, when: string): DossierBeat {
  const s = d.safety;
  const rec = receipt(
    s.available
      ? "Contract-internal safety was recorded by a supported collector."
      : "No supported collector returned contract-internal safety on this network.",
    "GoPlus / RugCheck · contract",
    null,
    when,
  );
  const figures: DossierFigure[] = [];
  if (!s.available) {
    figures.push(unestablished("Contract safety"));
    return {
      id: "contract",
      label: "Contract",
      kicker: "Contract",
      heading: "Contract-internal safety was not checked on this network.",
      figures,
    };
  }

  figures.push(sourced("Honeypot", s.honeypot ? "flagged" : (s.simChecked ? "simulated clean" : "not simulated"), rec));
  figures.push(sourced(d.chain === "solana" ? "Mint authority" : "Mintable", s.mintable ? "active" : "revoked", rec));
  if (d.chain === "solana") {
    figures.push(sourced("Freeze authority", s.freezable ? "active" : "revoked", rec));
  } else {
    figures.push(sourced("Ownership", s.ownerRenounced ? "renounced" : "held", rec));
    figures.push(sourced("Source code", s.openSource ? "verified" : "unverified", rec));
  }

  const recorded = figures.length;
  return {
    id: "contract",
    label: "Contract",
    kicker: "Contract",
    heading: `${recorded} contract checks are on record.`,
    figures,
  };
}

function presenceBeat(d: TokenDossier, when: string): DossierBeat {
  const figures: DossierFigure[] = [];
  const cg = d.cg;
  if (!cg) {
    figures.push(unestablished("CoinGecko listing"));
    figures.push(unestablished("Centralized exchanges"));
  } else {
    const rec = receipt(
      cg.listed
        ? `CoinGecko lists this token${cg.cexCount ? ` on ${cg.cexCount} centralized exchanges` : ""}.`
        : "CoinGecko has a record and does not list a centralized exchange.",
      "CoinGecko · market registry",
      cgUrl(d),
      when,
    );
    figures.push(sourced("CoinGecko listing", cg.listed ? "listed" : "unlisted", rec));
    figures.push(sourced("Centralized exchanges", String(cg.cexCount), rec));
  }
  if (d.projectX) {
    figures.push(sourced(
      "Official X",
      d.projectX,
      receipt(`Project X account recorded as ${d.projectX}.`, "Token socials · first party", `https://x.com/${d.projectX.replace(/^@/, "")}`, when),
    ));
  } else {
    figures.push(unestablished("Official X"));
  }

  const sentences: string[] = [];
  if (!cg) sentences.push("No independent market listing was recorded.");
  else if (cg.listed && cg.cexCount > 0) sentences.push(`Listed on ${cg.cexCount} centralized exchange${cg.cexCount === 1 ? "" : "s"}.`);
  else sentences.push("CoinGecko has a record and does not list a centralized exchange.");
  sentences.push(d.projectX ? "An official X account is on record." : "No official X account was linked.");

  return {
    id: "presence",
    label: "Presence",
    kicker: "Presence",
    heading: sentences.join(" "),
    figures,
  };
}

function gapsBeat(gaps: string[]): DossierBeat | null {
  if (!gaps.length) return null;
  return {
    id: "gaps",
    label: "Gaps",
    kicker: "What was not verified",
    heading: gaps.length === 1
      ? "1 check could not be completed."
      : `${gaps.length} checks could not be completed.`,
    figures: gaps.map((gap, index) => figure(
      `Gap ${index + 1}`,
      gap,
      { tier: "unestablished" },
      null,
    )),
  };
}

function headlineFigures(d: TokenDossier, when: string): DossierFigure[] {
  const dex = dexUrl(d);
  const market = (label: string, value: string | null, passage: string): DossierFigure => (
    value
      ? sourced(label, value, receipt(passage, "DexScreener · market", dex, when))
      : unestablished(label, "N/A")
  );
  return [
    market("mcap", money(d.mcap), d.mcap != null ? `Market cap recorded as ${money(d.mcap)}.` : "Market cap was not recorded."),
    market("All-token value (FDV)", money(d.fdv), d.fdv != null ? `FDV recorded as ${money(d.fdv)}.` : "FDV was not recorded."),
    market("liquidity", money(d.liquidityUsd), d.liquidityUsd != null ? `Liquidity recorded as ${money(d.liquidityUsd)}.` : "Liquidity was not recorded."),
    market("24h vol", money(d.vol24), d.vol24 != null ? `24h volume recorded as ${money(d.vol24)}.` : "24h volume was not recorded."),
  ];
}

export function buildTokenStory(d: TokenDossier): TokenStory {
  const when = recordedWhen(d);
  const gaps = tokenDataGaps(d);
  const beats = [
    launchBeat(d, when),
    liquidityBeat(d, when),
    holdersBeat(d, when),
    contractBeat(d, when),
    presenceBeat(d, when),
    gapsBeat(gaps),
  ].filter((beat): beat is DossierBeat => beat != null);

  return {
    beats,
    gaps,
    sources: collectSourceRows(beats.flatMap((beat) => beat.figures)),
    headline: headlineFigures(d, when),
  };
}
