import { HolderIntelligencePanel } from "../HolderIntelligencePanel";
import { useEffect, useState, type ReactNode } from "react";
import { DisclosureButton, InlinePanel } from "../disclosure";
import { Badge, ChapterHead, ExtLink, Panel } from "../primitives";
import { chainLabel, findingId, floorTo, shortAddress, usd, utcDay, utcStamp } from "../model";
import { fetchVenueSnapshot, type VenueSnapshot } from "../marketVenues";
import type { ReportView } from "../view";
import { IdentityShortcuts } from "./DecisionChapter";

function Money({ value }: { value: number | null }) {
  const text = usd(value);
  return text ? <>{text}</> : <span className="contact-missing">Not available</span>;
}

function VenueTable({ view, enabled }: { view: ReportView; enabled: boolean }) {
  const token = view.token!;
  const [state, setState] = useState<{ phase: "loading" } | { phase: "ready"; snapshot: VenueSnapshot } | { phase: "failed" }>({ phase: "loading" });
  // The snapshot is taken the first time the Market chapter is opened, once.
  const pending = state.phase === "loading";
  useEffect(() => {
    if (!enabled || !pending) return;
    let active = true;
    void fetchVenueSnapshot({ chain: token.chain, address: token.address, coingeckoId: token.coingeckoId })
      .then((snapshot) => {
        if (!active) return;
        setState(snapshot ? { phase: "ready", snapshot } : { phase: "failed" });
      })
      .catch(() => {
        if (active) setState({ phase: "failed" });
      });
    return () => { active = false; };
  }, [enabled, pending, token.address, token.chain, token.coingeckoId]);

  const snapshot = state.phase === "ready" ? state.snapshot : null;
  const coingecko = token.coingeckoId ? `https://www.coingecko.com/en/coins/${encodeURIComponent(token.coingeckoId)}#markets` : null;
  const cexRows = snapshot?.rows.filter((row) => row.type === "CEX") ?? [];
  const savedDate = utcDay(view.savedAt);

  return (
    <Panel className="exchange-panel">
      <div className="section-top">
        <div>
          <div className="eyebrow">Additional market snapshot · {snapshot ? utcStamp(snapshot.capturedAt) : state.phase === "loading" ? "loading" : "unavailable"}</div>
          <h2>Where ${token.symbol} trades</h2>
        </div>
        {coingecko && <ExtLink href={coingecko}>View on CoinGecko</ExtLink>}
      </div>
      <p>
        {snapshot
          ? `${snapshot.rows.filter((row) => row.type === "DEX").length} ${chainLabel(token.chain)} pool${snapshot.rows.filter((row) => row.type === "DEX").length === 1 ? "" : "s"} returned by DexScreener. `
          : ""}
        These newer observations do not change the saved {savedDate ? `${savedDate} ` : ""}scores or market figures below.
      </p>
      {state.phase === "loading" && <p className="status-box" role="status">Retrieving current venues from DexScreener and CoinGecko…</p>}
      {state.phase === "failed" && <p className="status-box" role="status">Current venue data could not be retrieved. The saved market figures below are unaffected.</p>}
      {snapshot && snapshot.rows.length > 0 && (
        <div className="exchange-scroll" role="region" aria-label={`${token.symbol} exchange markets`} tabIndex={0}>
          <table className="exchange-table">
            <thead>
              <tr><th>Exchange / market</th><th>Type</th><th>24h volume</th><th>Pool liquidity</th><th>+2% depth</th><th>−2% depth</th><th>Pool chart</th></tr>
            </thead>
            <tbody>
              {snapshot.rows.map((row) => (
                <tr key={row.key}>
                  <td>
                    {row.venueUrl ? <ExtLink href={row.venueUrl}>{row.venue}</ExtLink> : row.venue}
                    <small>{row.pair}{row.secondary ? " · secondary pool" : ""}{row.depthNote ? ` · ${row.depthNote}` : ""}</small>
                  </td>
                  <td><Badge>{row.type}</Badge></td>
                  <td><Money value={row.volume24hUsd} /></td>
                  <td><Money value={row.liquidityUsd} /></td>
                  <td><Money value={row.depthUpUsd} /></td>
                  <td><Money value={row.depthDownUsd} /></td>
                  <td>
                    {row.chartUrl ? <ExtLink href={row.chartUrl}>DexScreener</ExtLink> : <span className="contact-missing">Not available</span>}
                    {row.poolAddress && <small>{shortAddress(row.poolAddress)}</small>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {snapshot && snapshot.rows.length === 0 && <p className="status-box">Neither provider returned a pool or market for this contract at capture.</p>}
      {snapshot && (
        <div className="status-box">
          <strong>Centralized exchanges:</strong>{" "}
          {!snapshot.cexChecked
            ? "CoinGecko market data was not available, so centralized-exchange coverage is unknown."
            : cexRows.length === 0
              ? "no CEX listing found in the CoinGecko markets checked. This is a coverage statement, not proof that none exists."
              : `${cexRows.length} CEX market${cexRows.length === 1 ? "" : "s"} returned by CoinGecko: ${cexRows.map((row) => row.venue).join(", ")}. Listings still need exchange-side verification.`}
        </div>
      )}
      <p className="subtle-note">Volume covers the preceding 24 hours. Liquidity is pool value at capture; depth estimates the trade value that moves price by ±2%. Neither is a 24-hour total. A 24-hour liquidity change and depth history are not available.</p>
      {snapshot && (
        <p className="subtle-note">
          Sources: <ExtLink href={snapshot.dexSourceUrl}>DexScreener pool volume &amp; liquidity</ExtLink>
          {coingecko && <>; <ExtLink href={coingecko}>CoinGecko venue/pair depth</ExtLink></>}. Depth is a venue/pair estimate, not a verified quote for an individual pool. Provider windows may differ; do not aggregate depth or treat it as guaranteed execution. This snapshot does not auto-refresh.
        </p>
      )}
    </Panel>
  );
}

function Holders({ view, reconciliation }: { view: ReportView; reconciliation?: ReactNode }) {
  const holders = view.market!.holders!;
  const [mode, setMode] = useState<"addresses" | "wallets">(holders.addresses.length ? "addresses" : "wallets");
  const rows = mode === "addresses" ? holders.addresses : holders.wallets;
  return (
    <>
      <div className="section-top">
        <h2>Who holds the supply?</h2>
        {holders.addresses.length > 0 && holders.wallets.length > 0 && reconciliation && <DisclosureButton id="holders-why" className="textbtn">Why views disagree ↗</DisclosureButton>}
      </div>
      <InlinePanel id="holders-why" label="Holder reconciliation">{() => reconciliation}</InlinePanel>
      {holders.addresses.length > 0 && holders.wallets.length > 0 && (
        <div className="segmented" aria-label="Holder population" role="group">
          <button type="button" aria-pressed={mode === "addresses"} onClick={() => setMode("addresses")}>Largest reported addresses</button>
          <button type="button" aria-pressed={mode === "wallets"} onClick={() => setMode("wallets")}>Assessed wallets only</button>
        </div>
      )}
      <div className="reading-line">
        {mode === "addresses"
          ? "Top addresses as recorded by the token scan. Economic control is not reconciled."
          : holders.walletsNote ?? "Assessed wallet rows after pool, contract and locked-address exclusions. A partial sample."}
      </div>
      {rows.map((row, index) => (
        <div className={`holder-row${row.alert ? " alert" : ""}`} key={`${row.label}-${index}`}>
          <span title={row.address}>{row.label}</span>
          <div className="holder-track"><i style={{ width: `${Math.min(100, Math.max(0, row.percent))}%` }} /></div>
          <strong>{row.percent.toFixed(2)}%</strong>
        </div>
      ))}
      <p className="subtle-note">
        {mode === "addresses"
          ? `${holders.largestLabel ?? "The largest address"} must be classified by contract, lock terms and beneficiary before concluding who can sell. Do not infer that one person controls it.`
          : `${holders.combinedAssessedPct != null ? `Combined assessed share: at least ${floorTo(holders.combinedAssessedPct, 2).toFixed(2)}%. ` : ""}Bar widths use total token supply as their denominator. This is not a complete concentration measure.`}
      </p>
    </>
  );
}

export function MarketChapter({ view, active, reconciliation, legacy }: { view: ReportView; active: boolean; reconciliation?: ReactNode; legacy?: ReactNode }) {
  const market = view.market;
  const token = view.token;
  if (!market || !token) {
    return (
      <>
        <ChapterHead
          eyebrow="Token & market"
          title="No token market is attributed."
          description="This saved report does not bind an official token to the subject, so no token mechanics or market economics are shown. A market registry listing alone would not establish ownership."
        />
        {legacy}
      </>
    );
  }
  const savedDay = utcDay(market.capturedAt ?? view.savedAt);
  const supply = market.supply;
  const circulatingPct = supply?.circulatingPct ?? null;
  return (
    <>
      <ChapterHead
        eyebrow={`Token & market${savedDay ? ` · saved ${savedDay}` : ""}`}
        title={`$${token.symbol}: separate mechanics from economics.`}
        description={`The ${chainLabel(token.chain)} contract is linked in the saved report. These figures describe the captured snapshot, not today's market.`}
      />
      <IdentityShortcuts view={view} />
      <VenueTable view={view} enabled={active} />
      <HolderIntelligencePanel snapshot={market.holderIntelligence} />
      {market.metrics.length > 0 && (
        <div className="metric-strip" style={{ margin: "0 0 22px", "--metric-count": Math.min(4, market.metrics.length) } as React.CSSProperties}>
          {market.metrics.slice(0, 4).map((metric) => (
            <div className="metric" key={metric.label}>
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
              {metric.note && <small>{metric.note}</small>}
            </div>
          ))}
        </div>
      )}
      <div className="chapter-grid">
        {market.holders ? (
          <Panel challenge={{ id: findingId("market", "holders"), title: "Who holds the supply?", claim: [...market.holders.addresses, ...market.holders.wallets].map((row) => `${row.label} ${row.percent.toFixed(2)}%`).join("; ") }}>
            <Holders view={view} reconciliation={reconciliation} />
          </Panel>
        ) : null}
        {(supply || market.facts.length > 0) && (
          <Panel challenge={{ id: findingId("market", "supply"), title: "Supply & dilution", claim: market.facts.map((fact) => `${fact.note ?? fact.label}: ${fact.value}`).join("; ") }}>
            <div className="eyebrow">Supply &amp; dilution</div>
            {circulatingPct != null ? (
              <>
                <h2 style={{ marginTop: 10 }}>{floorTo(circulatingPct, 1).toFixed(1)}% reported circulating</h2>
                <div className="supply-bar" role="img" aria-label={`${floorTo(circulatingPct, 1)} percent circulating; ${(100 - floorTo(circulatingPct, 1)).toFixed(1)} percent not classified as circulating`}>
                  <span style={{ width: `${Math.min(100, circulatingPct)}%` }} />
                  <span />
                </div>
                <div className="legend-row">
                  <span><strong>{supply?.circulating != null ? compact(supply.circulating) : "?"}</strong> circulating</span>
                  <span><strong>{supply?.circulating != null && supply.total != null ? compact(supply.total - supply.circulating) : "?"}</strong> outside reported float</span>
                </div>
                <p className="subtle-note">
                  Non-circulating is not synonymous with unreleased or about to unlock.
                  {supply?.burnedPct != null ? ` The report also records about ${supply.burnedPct.toFixed(1)}% at burn addresses.` : ""} Allocation and vesting need their own records.
                </p>
              </>
            ) : (
              <h2 style={{ marginTop: 10 }}>Circulating supply not recorded</h2>
            )}
            {market.facts.length > 0 && (
              <div className="data-facts">
                {market.facts.map((fact) => (
                  <div key={fact.label}><strong>{fact.value}</strong><small>{fact.note ?? fact.label}</small></div>
                ))}
              </div>
            )}
            {market.lockNote && <p className="subtle-note">{market.lockNote}</p>}
            {market.holders?.sourceUrl && <p style={{ marginTop: 10 }}><ExtLink href={market.holders.sourceUrl} className="textbtn">Inspect source scope</ExtLink></p>}
          </Panel>
        )}
      </div>
      <div className="chapter-grid space-top">
        {market.trading.length > 0 && (
          <Panel challenge={{ id: findingId("market", "trading"), title: "Trading, with the windows stated", claim: market.trading.map((row) => `${row.label}: ${row.value}`).join("; ") }}>
            <h2>Trading, with the windows stated</h2>
            <div className="math-list" style={{ marginTop: 14 }}>
              {market.trading.map((row) => <div key={row.label}><span>{row.label}</span><strong>{row.value}</strong></div>)}
            </div>
            {market.tradingNote && <p className="subtle-note">{market.tradingNote}</p>}
          </Panel>
        )}
        {market.control && (
          <Panel challenge={{ id: findingId("market", "control"), title: "Contract control", claim: market.control.facts.map((fact) => `${fact.note ?? fact.label}: ${fact.value}`).join("; ") }}>
            <h2>Contract control</h2>
            <div className="data-facts">
              {market.control.facts.map((fact) => (
                <div key={fact.label}><strong>{fact.value}</strong><small>{fact.note ?? fact.label}</small></div>
              ))}
            </div>
            {market.control.note && <p className="subtle-note">{market.control.note}</p>}
            {market.control.limitation && <div className="status-box">{market.control.limitation}</div>}
          </Panel>
        )}
      </div>
      {legacy}
    </>
  );
}

function compact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(value % 1e9 === 0 ? 0 : 2).replace(/\.?0+$/, "")}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(0)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(0)}K`;
  return value.toLocaleString("en-US");
}
