import { deployerRoleLabel, type TokenDossier } from "../token/audit";
import { MarketIntel } from "./MarketIntel";
import { HolderForensics } from "./HolderForensics";
import { WalletClusters } from "./WalletClusters";
import { OperatorNetwork } from "./OperatorNetwork";
import { EvmDeployer } from "./EvmDeployer";
import { GmgnHolderCosts } from "./GmgnHolderCosts";
import { GmgnBundlePanel } from "./GmgnBundlePanel";
import { EarlyBuyerFunding } from "./EarlyBuyerFunding";
import { BytecodeForensics } from "./BytecodeForensics";
import { SanctionsScreen } from "./SanctionsScreen";
import { EntityConcentration } from "./EntityConcentration";

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
export function OnChainForensics({ token, onAudit, panelCostToken, record = true, mintedAt }: { token: TokenDossier; onAudit: (h: string) => void; panelCostToken: string; record?: boolean; mintedAt?: string | number | null }) {
  const isEvm = token.chain !== "solana";
  const launchedAt = mintedAt ?? launchInstant(token);
  return (
    <div className="space-y-3">
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
      />
      {/* one real-world entity can spread its balance across many wallets */}
      <EntityConcentration
        address={token.address}
        chain={token.chain}
        symbol={token.symbol}
        panelCostToken={panelCostToken}
      />
      {/* how many "top holders" are one hand? */}
      <WalletClusters mint={token.address} chain={token.chain} symbol={token.symbol} panelCostToken={panelCostToken} record={record} />
      {/* recursive operator trace — isolated project or one node in a serial factory? */}
      {token.deployer && <OperatorNetwork deployer={token.deployer} chain={token.chain} label={`$${token.symbol}`} onAudit={onAudit} panelCostToken={panelCostToken} record={record} roleLabel={deployerRoleLabel(token.deployerAttribution)} mintedAt={launchedAt} />}
      {/* EVM deployer trail — who deployed it, who funded the gas, serial launcher? */}
      {/* What the top holders paid: the only source here that answers whether a
          concentrated holder is sitting on a gain and therefore has a reason to sell. */}
      <GmgnHolderCosts chain={token.chain} address={token.address} />
      {/* GMGN's launch-shape reading (bundler/sniper volume and wallet counts),
          carried as their classification, never adopted as an ARGUS finding */}
      <GmgnBundlePanel chain={token.chain} address={token.address} knownDeployer={token.deployer} />
      {/* ARGUS's own check on the same question: the wallets that took supply in
          the first transactions, traced to their seed funders (Solana only) */}
      <EarlyBuyerFunding chain={token.chain} mint={token.address} />
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
