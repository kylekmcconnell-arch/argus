import type { TokenDossier } from "../token/audit";
import { MarketIntel } from "./MarketIntel";
import { HolderForensics } from "./HolderForensics";
import { WalletClusters } from "./WalletClusters";
import { OperatorNetwork } from "./OperatorNetwork";
import { EvmDeployer } from "./EvmDeployer";
import { BytecodeForensics } from "./BytecodeForensics";
import { SanctionsScreen } from "./SanctionsScreen";

// Unified on-chain forensic suite. The token and investigation reports both ran
// the same seven panels but mounted them in different orders and hand-wired the
// same props twice, so they drifted. This renders them in ONE canonical order
// from a single TokenDossier: market intel → holder distribution → wallet
// clustering → operator trace → (EVM) deployer trail → (EVM) bytecode → OFAC
// sanctions. One source of truth for every token/investigation report.
export function OnChainForensics({ token, onAudit, panelCostToken, record = true }: { token: TokenDossier; onAudit: (h: string) => void; panelCostToken: string; record?: boolean }) {
  const isEvm = token.chain !== "solana";
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
      {/* how many "top holders" are one hand? */}
      <WalletClusters mint={token.address} chain={token.chain} symbol={token.symbol} panelCostToken={panelCostToken} record={record} />
      {/* recursive operator trace — isolated project or one node in a serial factory? */}
      {token.deployer && <OperatorNetwork deployer={token.deployer} chain={token.chain} label={`$${token.symbol}`} onAudit={onAudit} panelCostToken={panelCostToken} record={record} />}
      {/* EVM deployer trail — who deployed it, who funded the gas, serial launcher? */}
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
