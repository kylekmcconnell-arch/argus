// EVM deployer forensics. GET /api/evm-deployer?address=<contract>&chain=<chainId>
//
// The EVM parallel to api/deployer.ts (which is Solana/Helius). A token contract
// names no owner on its face, but the chain records who DEPLOYED it and who funded
// that deployer's gas — and whether that same wallet has stamped out other
// contracts (a serial launcher). Etherscan's v2 multichain API gives all of it
// with one key: getcontractcreation for the deployer, txlist for the funding tx +
// the deployer's other contract creations.
//
// EVM only. Gated on ETHERSCAN_API_KEY. Bounded + graceful when unset.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { arr, rec, str } from "../src/lib/json.js";
import { EVM_CEX_WALLETS as CEX } from "../src/lib/marketAddresses.js";
import { requireArgusAuth } from "./_auth.js";
import { attachPanelCost, resolvePanelCostVersion } from "./_cache.js";

export const config = { maxDuration: 20 };

// dexscreener chainId string -> Etherscan v2 numeric chainid.
const CHAINID: Record<string, number> = {
  ethereum: 1, bsc: 56, base: 8453, polygon: 137, arbitrum: 42161,
  optimism: 10, avalanche: 43114, fantom: 250, linea: 59144, scroll: 534352,
};
// Chains Etherscan v2 does not index but a Blockscout instance does. Blockscout's
// v1 route speaks the same module/action dialect (status, message, result), no
// key needed, so the same reads run unchanged against it.
const BLOCKSCOUT: Record<string, string> = {
  robinhood: "https://robinhoodchain.blockscout.com/api",
  gnosis: "https://gnosis.blockscout.com/api",
};
type Explorer = { kind: "etherscan"; chainid: number; key: string } | { kind: "blockscout"; base: string };

// Major CEX hot wallets (lowercased). A funder match here means the deployer's gas
// traces to a KYC'd exchange withdrawal — a real subpoena target, not an anon hand.
// Ethereum-mainnet set (several are reused cross-chain by the same exchanges).

const ES = "https://api.etherscan.io/v2/api";
interface CallCounter { calls: number; succeeded: number }
async function es(x: Explorer, params: Record<string, string>, usage: CallCounter): Promise<unknown> {
  usage.calls += 1;
  const q = x.kind === "etherscan"
    ? new URLSearchParams({ chainid: String(x.chainid), apikey: x.key, ...params })
    : new URLSearchParams(params);
  const url = x.kind === "etherscan" ? `${ES}?${q}` : `${x.base}?${q}`;
  const r = await fetch(url, { headers: { accept: "application/json", "user-agent": "argus-due-diligence" }, signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`${x.kind} ${r.status}`);
  const data = await r.json();
  const record = rec(data);
  const emptyMessage = `${String(record.message)} ${String(record.result)}`;
  const measuredEmpty = record.status === "0" && (/no transactions found/i.test(emptyMessage)
    || (params.action === "getcontractcreation" && /\bno data found\b/i.test(emptyMessage)));
  if (!(record.status === "1" && Array.isArray(record.result)) && !measuredEmpty) throw new Error("etherscan_unavailable");
  usage.succeeded += 1;
  return data;
}

const isAddr = (s: string) => /^0x[a-fA-F0-9]{40}$/.test(s);
const lc = (s: string) => s.toLowerCase();

// The account that first sent ETH/gas into a wallet (its funder), from the oldest
// txs. The first INCOMING value-bearing tx from a different account is the funder.
async function fundingSource(x: Explorer, wallet: string, usage: CallCounter): Promise<{ funder: string | null; firstTs: number | null }> {
  // Read BOTH external txs and INTERNAL txs (contract-routed ETH — a disperse
  // contract, a multisig, a CEX withdrawal via proxy — invisible to txlist), then
  // take the earliest inflow across both as the true first funder.
  const [d, di] = await Promise.all([
    es(x, { module: "account", action: "txlist", address: wallet, startblock: "0", endblock: "99999999", page: "1", offset: "50", sort: "asc" }, usage),
    es(x, { module: "account", action: "txlistinternal", address: wallet, startblock: "0", endblock: "99999999", page: "1", offset: "50", sort: "asc" }, usage),
  ]);
  const txs = arr(rec(d).result);
  const itxs = arr(rec(di).result);
  const firstTs = txs.length ? Number(rec(txs[0]).timeStamp) || null : null;
  const cands: { from: string; ts: number }[] = [];
  const inflow = (value: unknown) => {
    const tx = rec(value);
    const from = str(tx.from);
    return lc(str(tx.to)) === lc(wallet) && from && lc(from) !== lc(wallet) && Number(tx.value) > 0 && tx.isError !== "1";
  };
  for (const value of txs) if (inflow(value)) { const tx = rec(value); cands.push({ from: str(tx.from), ts: Number(tx.timeStamp) }); }
  for (const value of itxs) if (inflow(value)) { const tx = rec(value); cands.push({ from: str(tx.from), ts: Number(tx.timeStamp) }); }
  cands.sort((a, b) => a.ts - b.ts);
  return { funder: cands[0]?.from ?? null, firstTs };
}

// How many contracts this wallet has DEPLOYED, from its tx history (creation txs
// have an empty `to` and a populated contractAddress). A wallet that has minted
// many contracts is a serial launcher on its own.
// The list itself (address + time) is what the shipping read joins commits to:
// a deploy that follows a release is the code going live.
export interface DeploymentRecord { address: string; at: string }
async function deploymentsBy(x: Explorer, wallet: string, usage: CallCounter): Promise<DeploymentRecord[]> {
  const d = await es(x, { module: "account", action: "txlist", address: wallet, startblock: "0", endblock: "99999999", page: "1", offset: "10000", sort: "asc" }, usage);
  const txs = arr(rec(d).result);
  const created = new Map<string, string>();
  for (const value of txs) {
    const tx = rec(value);
    const to = str(tx.to);
    const contractAddress = str(tx.contractAddress);
    const ts = Number(str(tx.timeStamp));
    if (!to && contractAddress && isAddr(contractAddress) && lc(str(tx.from)) === lc(wallet) && !created.has(lc(contractAddress))) {
      created.set(lc(contractAddress), Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000).toISOString() : "");
    }
  }
  return [...created.entries()].map(([address, at]) => ({ address, at }));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireArgusAuth(req, res, "analyst");
  if (!auth) return;
  const panelTokenHeader = req.headers["x-argus-panel-token"];
  const panelToken = Array.isArray(panelTokenHeader) ? panelTokenHeader[0] : panelTokenHeader;
  const panelCostVersionId = resolvePanelCostVersion(auth.organizationId, panelToken);
  if (!panelCostVersionId) {
    res.status(409).json({ error: "invalid_panel_context", message: "This paid supplemental check needs a fresh persisted report. Rescan before running it." });
    return;
  }

  const key = process.env.ETHERSCAN_API_KEY;
  // Two entry points: ?address=<contract> resolves the contract's deployer first;
  // ?wallet=<addr> traces that wallet DIRECTLY (this is how the operator trace
  // walks up hop by hop — each hop is a wallet, not a contract).
  const address = typeof req.query.address === "string" ? req.query.address.trim() : "";
  const walletQ = typeof req.query.wallet === "string" ? req.query.wallet.trim() : "";
  const subject = walletQ || address;
  const chain = (typeof req.query.chain === "string" ? req.query.chain : "").toLowerCase();
  const chainid = CHAINID[chain];
  const blockscout = BLOCKSCOUT[chain];
  if (!isAddr(subject)) { res.status(400).json({ error: "valid EVM address required (?address= contract or ?wallet= wallet)" }); return; }
  if (!chainid && !blockscout) { res.status(200).json({ address: subject, chain, available: false, note: `No Etherscan chain id or Blockscout instance for '${chain}'.` }); return; }
  if (chainid && !key) { res.status(200).json({ address: subject, chain, available: false, note: "Etherscan not configured; EVM deployer trail unavailable." }); return; }
  const explorer: Explorer = chainid && key ? { kind: "etherscan", chainid, key } : { kind: "blockscout", base: blockscout };

  const usage: CallCounter = { calls: 0, succeeded: 0 };
  try {
    // 1. Resolve the wallet to trace. Given a wallet, it IS the subject; given a
    //    contract, look up who deployed it.
    let deployer: string | null = walletQ && isAddr(walletQ) ? walletQ : null;
    if (!deployer) {
      const cc = await es(explorer, { module: "contract", action: "getcontractcreation", contractaddresses: address }, usage);
      const creation = rec(arr(rec(cc).result)[0]);
      const contractCreator = str(creation.contractCreator);
      deployer = contractCreator && isAddr(contractCreator) ? contractCreator : null;
    }
    if (!deployer) { res.status(200).json({ address: subject, chain, available: true, deployer: null, note: "Deployer not resolvable from contract-creation records." }); return; }

    // 2. The deployer's funder + age, and how many contracts it has deployed.
    const [fund, deployments] = await Promise.all([
      fundingSource(explorer, deployer, usage),
      deploymentsBy(explorer, deployer, usage),
    ]);
    const funderAddr = fund.funder;
    const cexLabel = funderAddr ? CEX[lc(funderAddr)] ?? null : null;
    const walletAgeDays = fund.firstTs ? Math.max(0, Math.round((Date.now() / 1000 - fund.firstTs) / 86400)) : null;
    const serialDeployer = deployments.length >= 5;

    const note = !funderAddr
      ? "No clear funding source found for the deployer in its earliest transactions."
      : cexLabel
        ? `The deployer's gas was funded from a KYC'd ${cexLabel} withdrawal, providing a traceable, real-world origin.`
        : `The deployer was funded by an anonymous wallet (${funderAddr.slice(0, 8)}…), no CEX terminus. Shared funders across launches expose a serial operator.`;

    res.status(200).json({
      address: subject, chain, available: true,
      deployer,
      funder: funderAddr ? { address: funderAddr, label: cexLabel, kind: cexLabel ? "cex" : "wallet" } : null,
      terminatesAtCex: !!cexLabel,
      deployments: deployments.length,
      // Newest fifty creations with their times, for the shipping read's
      // code-to-chain join. Older history only inflates the count above.
      deploymentList: deployments.slice(-50),
      serialDeployer,
      walletAgeDays,
      firstActivity: fund.firstTs ? new Date(fund.firstTs * 1000).toISOString().slice(0, 10) : null,
      note,
    });
  } catch (e) {
    res.status(200).json({ address, chain, available: false, error: String(e), note: "EVM deployer lookup failed." });
  } finally {
    if (usage.calls > 0) {
      await attachPanelCost(auth.organizationId, panelCostVersionId, {
        provider: explorer.kind,
        op: "panel:evm-deployer",
        calls: usage.calls,
        usd: 0,
        meta: "subscription/keyed",
        initiatedBy: auth.userId,
        status: usage.succeeded === usage.calls ? "succeeded" : usage.succeeded > 0 ? "partial" : "failed",
      });
    }
  }
}
