import { useEffect, useState } from "react";
import { shortAddr } from "../lib/wallets";
import { fetchPanelJson, panelRequestFailure, type PanelRequestFailure } from "../lib/panelCostHeaders";
import { PanelRequestNotice } from "./PanelRequestNotice";
import type { LiveForensicStatusHandler } from "../lib/liveForensics";

/**
 * HOW THE LAUNCH WAS BOUGHT, per GMGN.
 *
 * GMGN classifies wallets by behavior (sniper, bundler bot, insider trader) and
 * reports how much of a token's volume and holder base those wallets account
 * for. That is a launch-shape reading ARGUS has no other provider for, and it
 * is rendered here as GMGN's account: percentages and counts with attribution,
 * never the conclusion "this launch was bundled". GMGN's per-tag wallet counter
 * stops at 1,000, so a count at the cap renders as a floor.
 *
 * The one thing ARGUS adds of its own here is corroboration: when GMGN's
 * creator address matches the deployer ARGUS resolved independently, two
 * unrelated providers agree on who launched the token, and that agreement is
 * ARGUS's observation to make.
 *
 * The payload type is restated rather than imported from server/adapters/gmgn
 * for the same reason GmgnHolderCosts restates its rows: pulling a server
 * adapter into the app tsconfig drags node globals in behind it.
 */

interface TagCount {
  count: number;
  atCap: boolean;
}

export interface GmgnBundlePayload {
  available: boolean;
  note: string | null;
  holderCount: number | null;
  bundlerVolumePct: number | null;
  insiderVolumePct: number | null;
  entrapmentVolumePct: number | null;
  botVolumePct: number | null;
  botWalletCount: number | null;
  freshWalletHolderPct: number | null;
  sniperHoldPct: number | null;
  top10HolderPct: number | null;
  creatorHoldPct: number | null;
  devTeamHoldPct: number | null;
  creatorCreatedCount: number | null;
  imageDupCount: number | null;
  tagged: {
    sniper: TagCount | null;
    bundler: TagCount | null;
    insider: TagCount | null;
    fresh: TagCount | null;
  };
  creatorAddress: string | null;
  creatorStillHolds: boolean | null;
  twitterRenames: number | null;
  communityTakeover: boolean | null;
  dexscreenerBoost: number | null;
  claims: string[];
}

const fmtPct = (value: number): string => `${value >= 10 ? value.toFixed(1) : value.toFixed(2)}%`;

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10.5px] uppercase tracking-wide text-ink-faint">{label}</div>
      <div className="mono text-[12.5px] tabular text-ink">{value}</div>
    </div>
  );
}

/** "1,000+" at GMGN's counter cap, so a floor never reads as a total. */
const tagValue = (tag: TagCount | null): string | null =>
  tag === null ? null : tag.atCap ? `${tag.count.toLocaleString("en-US")}+` : tag.count.toLocaleString("en-US");

const SUPPORTED_CHAINS = new Set(["solana", "ethereum", "base", "bsc"]);

export function GmgnBundlePanel({ chain, address, knownDeployer, onStatusChange }: { chain?: string | null; address?: string | null; knownDeployer?: string | null; onStatusChange?: LiveForensicStatusHandler }) {
  const [data, setData] = useState<GmgnBundlePayload | null>(null);
  const [failure, setFailure] = useState<PanelRequestFailure | null>(null);
  const [loading, setLoading] = useState(false);

  const supported = !!chain && SUPPORTED_CHAINS.has(chain.toLowerCase());
  useEffect(() => {
    if (!supported || !chain || !address) return;
    let live = true;
    setLoading(true);
    onStatusChange?.({ id: "gmgn-launch-pattern", label: "GMGN launch-pattern reading", state: "running" });
    fetchPanelJson<GmgnBundlePayload>(`/api/gmgn-bundle?chain=${encodeURIComponent(chain)}&address=${encodeURIComponent(address)}`)
      .then((payload) => {
        if (!live) return;
        setData(payload);
        onStatusChange?.({ id: "gmgn-launch-pattern", label: "GMGN launch-pattern reading", state: payload.available ? "complete" : "unavailable" });
      })
      .catch((error) => {
        if (!live) return;
        setFailure(panelRequestFailure(error));
        onStatusChange?.({ id: "gmgn-launch-pattern", label: "GMGN launch-pattern reading", state: "unavailable" });
      })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [supported, chain, address, onStatusChange]);

  if (!supported || !chain || !address) return null;
  if (failure) return <PanelRequestNotice failure={failure} label="Launch pattern (GMGN)" />;
  if (loading && !data) {
    return (
      <div className="panel p-4">
        <div className="eyebrow mb-2">How the launch was bought</div>
        <div className="scan-bar" />
      </div>
    );
  }
  if (!data) return null;

  // A reading that did not happen says why, and publishes nothing else. An
  // absent provider is not a token with a clean launch shape.
  if (!data.available) {
    return (
      <div className="panel p-4">
        <div className="eyebrow mb-2">How the launch was bought</div>
        <p className="text-[12.5px] leading-relaxed text-ink-dim">
          {data.note ?? "GMGN's launch-pattern reading was not collected for this token."}
        </p>
      </div>
    );
  }

  const volumeStats: Array<[string, number | null]> = [
    ["Bundler-bot volume", data.bundlerVolumePct],
    ["Insider-trader volume", data.insiderVolumePct],
    ["Entrapment volume", data.entrapmentVolumePct],
    ["Bot volume", data.botVolumePct],
  ];
  const holdStats: Array<[string, number | null]> = [
    ["Sniper hold share", data.sniperHoldPct],
    ["Fresh-wallet holders", data.freshWalletHolderPct],
    ["Top 10 holders", data.top10HolderPct],
    ["Creator holds", data.creatorHoldPct],
  ];
  const tagStats: Array<[string, string | null]> = [
    ["Sniper wallets", tagValue(data.tagged.sniper)],
    ["Bundler wallets", tagValue(data.tagged.bundler)],
    ["Insider wallets", tagValue(data.tagged.insider)],
    ["Fresh wallets", tagValue(data.tagged.fresh)],
  ];
  const anyAtCap = [data.tagged.sniper, data.tagged.bundler, data.tagged.insider, data.tagged.fresh]
    .some((tag) => tag?.atCap);

  // Two unrelated providers naming the same launcher is worth a sentence of
  // ARGUS's own; a mismatch is worth one too. Compared only when both exist.
  const creatorIdentity = (value: string): string =>
    chain.toLowerCase() === "solana" ? value.trim() : value.trim().toLowerCase();
  const deployerMatch = data.creatorAddress && knownDeployer
    ? creatorIdentity(data.creatorAddress) === creatorIdentity(knownDeployer)
    : null;

  return (
    <section className="panel p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="eyebrow">How the launch was bought</span>
        <span className="mono text-[11px] text-ink-faint">GMGN</span>
      </div>

      <p className="mt-2 text-[12.5px] leading-relaxed text-ink-dim">
        Volume shares and wallet counts are GMGN's classification of trading behavior, not findings ARGUS verified independently.
        They describe how this token has been bought; they do not by themselves say who was behind the buying.
      </p>

      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        {volumeStats.map(([label, value]) => value !== null && <Stat key={label} label={label} value={fmtPct(value)} />)}
        {holdStats.map(([label, value]) => value !== null && <Stat key={label} label={label} value={fmtPct(value)} />)}
        {tagStats.map(([label, value]) => value !== null && <Stat key={label} label={label} value={value} />)}
      </div>
      {anyAtCap && (
        <p className="mt-2 text-[11.5px] text-ink-faint">
          GMGN's per-tag wallet counter stops at 1,000, so a count shown as 1,000+ is a floor, never a total.
        </p>
      )}

      {(data.creatorAddress || data.creatorStillHolds !== null) && (
        <p className="mt-3 text-[12.5px] leading-relaxed text-ink-dim">
          {data.creatorAddress && (
            <>
              GMGN names <span className="mono text-ink">{shortAddr(data.creatorAddress)}</span> as the creator
              {deployerMatch === true && ", the same address ARGUS resolved as the deployer independently, so two unrelated providers agree on who launched this token"}
              {deployerMatch === false && `, which differs from the deployer ARGUS resolved (${shortAddr(knownDeployer ?? "")}); the two providers may be describing different wallets in the launch`}
              .{" "}
            </>
          )}
          {data.creatorStillHolds === false && "GMGN reports the creator has closed its position in this token."}
          {data.creatorStillHolds === true && "GMGN reports the creator still holds this token."}
          {/* communityTakeover (GMGN's cto_flag) is deliberately NOT rendered.
              Measured 2026-08-05 across ten tokens: it is 1 on JUP, WIF, BONK,
              POPCAT, TRUMP and on three pump.fun tokens minutes old whose
              creators had launched one token each, and 0 only on USDC. A flag
              that fires on nine of ten cannot carry "the original developer
              abandoned this", which is what publishing it asserted about every
              one of those projects. The field stays in the payload as raw
              provider data; it does not reach the page. */}
        </p>
      )}

      {data.claims.map((claim) => (
        <p key={claim} className="mt-3 text-[12.5px] leading-relaxed text-ink-dim">{claim}</p>
      ))}
    </section>
  );
}
