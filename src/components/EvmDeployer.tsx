import { useEffect, useRef, useState } from "react";
import { shortAddr } from "../lib/wallets";
import { recordForensicEntities } from "../graph/store";
import { fetchPanelJson, panelRequestFailure, requiredPanelHeaders, type PanelRequestFailure } from "../lib/panelCostHeaders";
import { PanelRequestNotice } from "./PanelRequestNotice";

// EVM deployer forensics (/api/evm-deployer). The EVM counterpart to the Solana
// deployer trail: who deployed this contract, whether their gas traces to a KYC'd
// exchange or an anonymous wallet, and whether that wallet is a serial launcher.
// Auto-runs (a few Etherscan calls) on EVM token/investigation reports.
const EXPLORER: Record<string, string> = {
  ethereum: "etherscan.io", base: "basescan.org", bsc: "bscscan.com",
  polygon: "polygonscan.com", arbitrum: "arbiscan.io", optimism: "optimistic.etherscan.io",
  avalanche: "snowtrace.io", fantom: "ftmscan.com", linea: "lineascan.build", scroll: "scrollscan.com",
};

type Data = {
  available: boolean; deployer?: string | null;
  funder?: { address: string; label: string | null; kind: string } | null;
  terminatesAtCex?: boolean; deployments?: number; serialDeployer?: boolean;
  walletAgeDays?: number | null; note?: string;
};

export function EvmDeployer({ address, chain, symbol, knownDeployer, panelCostToken, record = true }: { address: string; chain: string; symbol?: string; knownDeployer?: string | null; panelCostToken?: string; record?: boolean }) {
  const requestKey = [address, chain, knownDeployer ?? "", panelCostToken ?? ""].join("\u0000");
  const [result, setResult] = useState<{ key: string; data: Data | null; failure?: PanelRequestFailure } | null>(null);
  const ran = useRef("");

  useEffect(() => {
    if (ran.current === requestKey || !panelCostToken || chain === "solana") return;
    ran.current = requestKey;
    let live = true;
    (async () => {
      try {
        // If the audit already resolved the deployer (e.g. via GoPlus), trace THAT
        // wallet directly — Etherscan's getcontractcreation is spotty on some L2s
        // (Base), which otherwise reads as a false "deployer not resolvable".
        const q = knownDeployer && /^0x[a-fA-F0-9]{40}$/.test(knownDeployer)
          ? `wallet=${encodeURIComponent(knownDeployer)}`
          : `address=${encodeURIComponent(address)}`;
        const d = await fetchPanelJson<Data>(
          `/api/evm-deployer?${q}&chain=${encodeURIComponent(chain)}`,
          { headers: requiredPanelHeaders(panelCostToken) },
        );
        if (!live) return;
        setResult({ key: requestKey, data: d });
        // Feed the graph: deployer + (anon) funder keyed like the Solana forensics
        // so a wallet that recurs across audits collapses to one node and bridges.
        if (record && d?.available && d.deployer) {
          // Key wallets by raw addr.slice(0,8) — the SAME convention the token-audit
          // graph + operator trace use — so an EVM deployer/funder that recurs across
          // audits collapses to one node and bridges the operations.
          const ents = [{ key: `wallet:${d.deployer.slice(0, 8)}`, type: "Identity", subtype: "Wallet", edgeType: "DEPLOYED_BY", label: shortAddr(d.deployer) }];
          if (d.funder && d.funder.kind === "wallet") ents.push({ key: `funder:${d.funder.address.slice(0, 8)}`, type: "Identity", subtype: "FunderWallet", edgeType: "FUNDED_BY", label: shortAddr(d.funder.address) });
          recordForensicEntities(symbol ? `$${symbol}` : `token:${address}`, ents);
        }
      } catch (error) {
        if (live) setResult({ key: requestKey, data: null, failure: panelRequestFailure(error) });
      }
    })();
    return () => { live = false; };
  }, [address, chain, knownDeployer, panelCostToken, record, requestKey, symbol]);

  if (chain === "solana" || !panelCostToken) return null;
  const current = result?.key === requestKey ? result : null;
  if (!current) return <div className="panel p-4 text-[12.5px] text-ink-faint">checking the token creator on the blockchain…</div>;
  if (current.failure) return <PanelRequestNotice failure={current.failure} label="Deployer intelligence" />;
  const data = current.data;
  if (!data || data.available === false || !data.deployer) {
    if (data && data.note && data.available !== false) {
      return (
        <div className="panel p-4">
          <span className="eyebrow">Deployer trail</span>
          <p className="mt-1.5 text-[12.5px] text-ink-dim">{data.note}</p>
        </div>
      );
    }
    return null;
  }

  const exp = EXPLORER[chain] ?? "etherscan.io";
  const serial = data.serialDeployer;

  return (
    <div className={`panel p-4 ${serial ? "tint-var" : ""}`} style={serial ? ({ "--tint": "var(--color-avoid)" } as React.CSSProperties) : undefined}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="eyebrow">Deployer trail</span>
        {typeof data.deployments === "number" && data.deployments > 0 && (
          <span className="mono ml-auto text-[11px] text-ink-faint">{data.deployments} contract{data.deployments === 1 ? "" : "s"} deployed by this wallet</span>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-ink-dim">
        <span>Deployer</span>
        <a href={`https://${exp}/address/${data.deployer}`} target="_blank" rel="noreferrer" className="link-ext mono">{shortAddr(data.deployer)}</a>
        {data.walletAgeDays != null && <span className="text-[11px] text-ink-faint">· {data.walletAgeDays}d old</span>}
        {data.funder && (
          <>
            <span className="text-ink-faint">← funded by</span>
            {data.funder.label ? (
              <span className="chip tint-pass">{data.funder.label}</span>
            ) : (
              <a href={`https://${exp}/address/${data.funder.address}`} target="_blank" rel="noreferrer" className="link-ext mono">{shortAddr(data.funder.address)}</a>
            )}
          </>
        )}
        {serial && <span className="chip tint-avoid"><span>serial deployer · {data.deployments}+ contracts</span></span>}
      </div>

      {data.note && <p className="mt-1.5 text-[12.5px] leading-snug" style={{ color: serial ? "var(--color-avoid)" : "var(--color-ink-dim)" }}>{data.note}</p>}
    </div>
  );
}
