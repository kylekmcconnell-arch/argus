import { deployerRoleLabel, type TokenDossier } from "../token/audit";
import { MarketIntel } from "./MarketIntel";
import { HolderForensics } from "./HolderForensics";
import { WalletClusters } from "./WalletClusters";
import { OperatorNetwork } from "./OperatorNetwork";
import { EvmDeployer } from "./EvmDeployer";
import { GmgnHolderCosts } from "./GmgnHolderCosts";
import { GmgnBundlePanel } from "./GmgnBundlePanel";
import { EarlyBuyerFunding } from "./EarlyBuyerFunding";
import { EvmLaunchBuyers } from "./EvmLaunchBuyers";
import { GovernancePanel } from "./GovernancePanel";
import { BytecodeForensics } from "./BytecodeForensics";
import { SanctionsScreen } from "./SanctionsScreen";
import { EntityConcentration } from "./EntityConcentration";
import { arkhamProviderEnabled } from "../lib/providerCapabilities";
import { useCallback, useState } from "react";
import type { LiveForensicCheckUpdate } from "../lib/liveForensics";

// The instant this token's first pool was created, which is the launch the
// deployer wallet is being aged against. DexScreener reports it in milliseconds
// and the audit freezes it on the dossier, so a reopened report measures the
// same launch rather than measuring against the day it was reopened.
//
// It is the closest instant ARGUS holds to the mint, not the mint itself: on a
// launchpad the pool is created in the same breath as the mint, but a token that
// migrated to a new pool later would date its launch to the migration. Read
// defensively because reports frozen before the field existed do not carry it.
function launchInstant(token: TokenDossier): number | null {
  const raw = (token as TokenDossier & { pairCreatedAt?: number | null }).pairCreatedAt;
  return typeof raw === "number" && raw > 0 ? raw : null;
}

// Unified on-chain forensic suite. The token and investigation reports both ran
// the same seven panels but mounted them in different orders and hand-wired the
// same props twice, so they drifted. This renders them in ONE canonical order
// from a single TokenDossier: market intel → holder distribution → wallet
// clustering → operator trace → (EVM) deployer trail → (EVM) bytecode → OFAC
// sanctions. One source of truth for every token/investigation report.
export function OnChainForensics({ token, onAudit, panelCostToken, record = true, mintedAt, projectHandle, projectWebsite }: { token: TokenDossier; onAudit: (h: string) => void; panelCostToken: string; record?: boolean; mintedAt?: string | number | null; projectHandle?: string | null; projectWebsite?: string | null }) {
  const isEvm = token.chain !== "solana";
  const arkhamEnabled = arkhamProviderEnabled();
  const launchedAt = mintedAt ?? launchInstant(token);
  const [liveChecks, setLiveChecks] = useState<Record<string, LiveForensicCheckUpdate>>({});
  const recordLiveCheck = useCallback((update: LiveForensicCheckUpdate) => {
    setLiveChecks((current) => current[update.id]?.state === update.state
      ? current
      : { ...current, [update.id]: update });
  }, []);
  const unavailableChecks = Object.values(liveChecks).filter((check) => check.state === "unavailable");
  return (
    <div className="space-y-3">
      {unavailableChecks.length > 0 && (
        <section className="panel tint-var p-4" style={{ "--tint": "var(--color-avoid)" } as React.CSSProperties} aria-label="Current forensic coverage incomplete">
          <div className="eyebrow">Current forensic coverage incomplete</div>
          <p className="mt-2 text-[12.5px] leading-relaxed text-ink-dim">
            {unavailableChecks.map((check) => check.label).join(", ")} did not finish. These live failures do not change the frozen score, and missing results must not be read as a clean launch or healthy holder base.
          </p>
        </section>
      )}
      {/* rank, ATH drawdown, dilution, unlock flags */}
      <MarketIntel symbol={token.symbol} contract={token.address} chain={token.chain} panelCostToken={panelCostToken} />
      {/* healthy base or a rug in a costume? */}
      <HolderForensics
        address={token.address}
        chain={token.chain}
        holderCount={token.safety.holderCount}
        evmTop={token.topHolders.map((h) => ({ pct: h.percent, tag: h.tag, address: h.address, isContract: h.isContract }))}
        insiderPct={token.insiderPct}
        panelCostToken={panelCostToken}
        onStatusChange={recordLiveCheck}
      />
      {/* Put launch concentration where a diligence reader will actually see it,
          directly after holder distribution rather than below the operator tools. */}
      <GmgnBundlePanel chain={token.chain} address={token.address} knownDeployer={token.deployer} onStatusChange={recordLiveCheck} />
      <EvmLaunchBuyers chain={token.chain} address={token.address} />
      <EarlyBuyerFunding chain={token.chain} mint={token.address} onStatusChange={recordLiveCheck} />
      {/* provider-labelled entities can span several holder wallets */}
      {arkhamEnabled ? (
        <EntityConcentration
          address={token.address}
          chain={token.chain}
          symbol={token.symbol}
          panelCostToken={panelCostToken}
        />
      ) : null}
      {/* which sampled holders share a seed funder or direct transfer? */}
      <WalletClusters mint={token.address} chain={token.chain} symbol={token.symbol} panelCostToken={panelCostToken} record={record} />
      {/* recursive operator trace — isolated project or one node in a serial factory? */}
      {token.deployer && <OperatorNetwork deployer={token.deployer} chain={token.chain} label={`$${token.symbol}`} onAudit={onAudit} panelCostToken={panelCostToken} record={record} roleLabel={deployerRoleLabel(token.deployerAttribution)} mintedAt={launchedAt} />}
      {/* EVM deployer trail — who deployed it, who funded the gas, serial launcher? */}
      {/* What the top holders paid: the only source here that answers whether a
          concentrated holder is sitting on a gain and therefore has a reason to sell. */}
      <GmgnHolderCosts chain={token.chain} address={token.address} onStatusChange={recordLiveCheck} />
      {/* Who decides, not who holds: how few addresses carried the project's
          last governance votes. Publishes nothing unless the Snapshot space
          binds to this subject by contract, official account or official domain. */}
      <GovernancePanel
        name={token.name || token.symbol}
        address={token.address}
        handle={projectHandle}
        website={projectWebsite}
      />
      {isEvm && <EvmDeployer address={token.address} chain={token.chain} symbol={token.symbol} knownDeployer={token.deployer} panelCostToken={panelCostToken} record={record} />}
      {/* EVM bytecode fingerprint — rug-enabling code + byte-identical known-rug clone check */}
      {isEvm && <BytecodeForensics address={token.address} chain={token.chain} symbol={token.symbol} record={record} />}
      {/* OFAC sanctions — deployer + top holders (a hard legal signal) */}
      <SanctionsScreen
        chain={token.chain}
        addresses={[
          ...(token.deployer ? [{ address: token.deployer, role: "deployer" }] : []),
          ...token.topHolders.map((h) => ({ address: h.address, role: "top holder" })),
        ]}
      />
    </div>
  );
}
