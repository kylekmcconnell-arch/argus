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
import { requireArgusAuth } from "./_auth.js";
import { attachPanelCost, resolvePanelCostVersion } from "./_cache.js";

export const config = { maxDuration: 20 };

// dexscreener chainId string -> Etherscan v2 numeric chainid.
const CHAINID: Record<string, number> = {
  ethereum: 1, bsc: 56, base: 8453, polygon: 137, arbitrum: 42161,
  optimism: 10, avalanche: 43114, fantom: 250, linea: 59144, scroll: 534352,
};

// Major CEX hot wallets (lowercased). A funder match here means the deployer's gas
// traces to a KYC'd exchange withdrawal — a real subpoena target, not an anon hand.
// Ethereum-mainnet set (several are reused cross-chain by the same exchanges).
const CEX: Record<string, string> = {
  "0x28c6c06298d514db089934071355e5743bf21d60": "Binance", "0x21a31ee1afc51d94c2efccaa2092ad1028285549": "Binance",
  "0xdfd5293d8e347dfe59e90efd55b2956a1343963d": "Binance", "0x56eddb7aa87536c09ccc2793473599fd21a8b17f": "Binance",
  "0x9696f59e4d72e237be84ffd425dcad154bf96976": "Binance", "0x4976a4a02f38326660d17bf34b431dc6e2eb2327": "Binance",
  "0x71660c4005ba85c37ccec55d0c4493e66fe775d3": "Coinbase", "0x503828976d22510aad0201ac7ec88293211d23da": "Coinbase",
  "0xddb1b4c4fb1e19bd353bc07d1d46c87d67b8e1e0": "Coinbase", "0x3cd751e6b0078be393132286c442345e5dc49699": "Coinbase",
  "0xeb2629a2734e272bcc07bda959863f316f4bd4cf": "Coinbase", "0xa9d1e08c7793af67e9d92fe308d5697fb81d3e43": "Coinbase",
  "0x2910543af39aba0cd09dbb2d50200b3e800a63d2": "Kraken", "0x0a869d79a7052c7f1b55a8ebabbea3420f0d1e13": "Kraken",
  "0x6cc5f688a315f3dc28a7781717a9a798a59fda7b": "OKX", "0x236f9f97e0e62388479bf9e5ba4889e46b0273c3": "OKX",
  "0xf89d7b9c864f589bbf53a82105107622b35eaa40": "Bybit", "0x1522900b6dafac587d499a862861c0869be6e428": "Bitfinex",
  "0x0d0707963952f2fba59dd06f2b425ace40b492fe": "Gate.io", "0x0681d8db095565fe8a346fa0277bffde9c0edbbf": "Binance",
};

const ES = "https://api.etherscan.io/v2/api";
interface CallCounter { calls: number; succeeded: number }
async function es(chainid: number, params: Record<string, string>, key: string, usage: CallCounter): Promise<any> {
  usage.calls += 1;
  const q = new URLSearchParams({ chainid: String(chainid), apikey: key, ...params });
  const r = await fetch(`${ES}?${q}`, { signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`etherscan ${r.status}`);
  const data = await r.json();
  usage.succeeded += 1;
  return data;
}

const isAddr = (s: string) => /^0x[a-fA-F0-9]{40}$/.test(s);
const lc = (s: string) => s.toLowerCase();

// The account that first sent ETH/gas into a wallet (its funder), from the oldest
// txs. The first INCOMING value-bearing tx from a different account is the funder.
async function fundingSource(chainid: number, wallet: string, key: string, usage: CallCounter): Promise<{ funder: string | null; firstTs: number | null }> {
  // Read BOTH external txs and INTERNAL txs (contract-routed ETH — a disperse
  // contract, a multisig, a CEX withdrawal via proxy — invisible to txlist), then
  // take the earliest inflow across both as the true first funder.
  const [d, di] = await Promise.all([
    es(chainid, { module: "account", action: "txlist", address: wallet, startblock: "0", endblock: "99999999", page: "1", offset: "50", sort: "asc" }, key, usage).catch(() => null),
    es(chainid, { module: "account", action: "txlistinternal", address: wallet, startblock: "0", endblock: "99999999", page: "1", offset: "50", sort: "asc" }, key, usage).catch(() => null),
  ]);
  const txs: any[] = Array.isArray(d?.result) ? d.result : [];
  const itxs: any[] = Array.isArray(di?.result) ? di.result : [];
  const firstTs = txs.length ? Number(txs[0].timeStamp) || null : null;
  const cands: { from: string; ts: number }[] = [];
  const inflow = (t: any) => lc(t.to) === lc(wallet) && t.from && lc(t.from) !== lc(wallet) && Number(t.value) > 0 && t.isError !== "1";
  for (const t of txs) if (inflow(t)) cands.push({ from: t.from, ts: Number(t.timeStamp) });
  for (const t of itxs) if (inflow(t)) cands.push({ from: t.from, ts: Number(t.timeStamp) });
  cands.sort((a, b) => a.ts - b.ts);
  return { funder: cands[0]?.from ?? null, firstTs };
}

// How many contracts this wallet has DEPLOYED, from its tx history (creation txs
// have an empty `to` and a populated contractAddress). A wallet that has minted
// many contracts is a serial launcher on its own.
async function deploymentsBy(chainid: number, wallet: string, key: string, usage: CallCounter): Promise<number> {
  const d = await es(chainid, { module: "account", action: "txlist", address: wallet, startblock: "0", endblock: "99999999", page: "1", offset: "10000", sort: "asc" }, key, usage).catch(() => null);
  const txs: any[] = Array.isArray(d?.result) ? d.result : [];
  const created = new Set<string>();
  for (const t of txs) {
    if ((!t.to || t.to === "") && t.contractAddress && isAddr(t.contractAddress) && lc(t.from) === lc(wallet)) created.add(lc(t.contractAddress));
  }
  return created.size;
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
  if (!isAddr(subject)) { res.status(400).json({ error: "valid EVM address required (?address= contract or ?wallet= wallet)" }); return; }
  if (!chainid) { res.status(200).json({ address: subject, chain, available: false, note: `No Etherscan chain id for '${chain}'.` }); return; }
  if (!key) { res.status(200).json({ address: subject, chain, available: false, note: "Etherscan not configured; EVM deployer trail unavailable." }); return; }

  const usage: CallCounter = { calls: 0, succeeded: 0 };
  try {
    // 1. Resolve the wallet to trace. Given a wallet, it IS the subject; given a
    //    contract, look up who deployed it.
    let deployer: string | null = walletQ && isAddr(walletQ) ? walletQ : null;
    if (!deployer) {
      const cc = await es(chainid, { module: "contract", action: "getcontractcreation", contractaddresses: address }, key, usage);
      const rec = Array.isArray(cc?.result) ? cc.result[0] : null;
      deployer = rec?.contractCreator && isAddr(rec.contractCreator) ? rec.contractCreator : null;
    }
    if (!deployer) { res.status(200).json({ address: subject, chain, available: true, deployer: null, note: "Deployer not resolvable from contract-creation records." }); return; }

    // 2. The deployer's funder + age, and how many contracts it has deployed.
    const [fund, deployments] = await Promise.all([
      fundingSource(chainid, deployer, key, usage),
      deploymentsBy(chainid, deployer, key, usage),
    ]);
    const funderAddr = fund.funder;
    const cexLabel = funderAddr ? CEX[lc(funderAddr)] ?? null : null;
    const walletAgeDays = fund.firstTs ? Math.max(0, Math.round((Date.now() / 1000 - fund.firstTs) / 86400)) : null;
    const serialDeployer = deployments >= 5;

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
      deployments,
      serialDeployer,
      walletAgeDays,
      firstActivity: fund.firstTs ? new Date(fund.firstTs * 1000).toISOString().slice(0, 10) : null,
      note,
    });
  } catch (e) {
    res.status(200).json({ address, chain, available: true, error: String(e), note: "EVM deployer lookup failed." });
  } finally {
    if (usage.calls > 0) {
      await attachPanelCost(auth.organizationId, panelCostVersionId, {
        provider: "etherscan",
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
