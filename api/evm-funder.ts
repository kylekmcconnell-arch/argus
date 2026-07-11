// EVM serial-operator funder sweep. GET /api/evm-funder?wallet=<funder>&chain=<id>
//
// The forward counterpart to api/evm-deployer.ts (which runs backward: contract <-
// deployer <- funder). This runs forward from a funder: every wallet it sent ETH
// to that then went on to DEPLOY contracts. That exposes the whole launch factory
// in one query — one wallet standing behind a fan of "independent" deployers — the
// same shape as the Solana funder sweep (api/funder.ts), with identical field
// names so the client operator trace consumes both chains uniformly.
//
// EVM only, via Etherscan v2 multichain. Gated on ETHERSCAN_API_KEY. Bounded.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireArgusAuth } from "./_auth.js";
import { attachPanelCost, resolvePanelCostVersion } from "./_cache.js";

export const config = { maxDuration: 60 };

const CHAINID: Record<string, number> = {
  ethereum: 1, bsc: 56, base: 8453, polygon: 137, arbitrum: 42161,
  optimism: 10, avalanche: 43114, fantom: 250, linea: 59144, scroll: 534352,
};

const ETH = 1e18;
const MIN_SEED = 0.002 * ETH;  // ignore dust
const MAX_SEED = 20 * ETH;     // above this it's an exchange/whale flow, not gas-seeding
const MAX_CANDIDATES = 30;     // recipients we bother to check
const CHECK_CHUNK = 4;

const CEX = new Set<string>([
  "0x28c6c06298d514db089934071355e5743bf21d60", "0x21a31ee1afc51d94c2efccaa2092ad1028285549",
  "0xdfd5293d8e347dfe59e90efd55b2956a1343963d", "0x56eddb7aa87536c09ccc2793473599fd21a8b17f",
  "0x9696f59e4d72e237be84ffd425dcad154bf96976", "0x4976a4a02f38326660d17bf34b431dc6e2eb2327",
  "0x71660c4005ba85c37ccec55d0c4493e66fe775d3", "0x503828976d22510aad0201ac7ec88293211d23da",
  "0xddb1b4c4fb1e19bd353bc07d1d46c87d67b8e1e0", "0x3cd751e6b0078be393132286c442345e5dc49699",
  "0x2910543af39aba0cd09dbb2d50200b3e800a63d2", "0x6cc5f688a315f3dc28a7781717a9a798a59fda7b",
  "0xf89d7b9c864f589bbf53a82105107622b35eaa40", "0x0000000000000000000000000000000000000000",
]);

const ES = "https://api.etherscan.io/v2/api";
interface CallCounter { calls: number; succeeded: number }
const isAddr = (s: string) => /^0x[a-fA-F0-9]{40}$/.test(s);
const lc = (s: string) => s.toLowerCase();

async function txlist(chainid: number, address: string, key: string, offset: number, usage: CallCounter): Promise<any[]> {
  usage.calls += 1;
  const q = new URLSearchParams({ chainid: String(chainid), module: "account", action: "txlist", address, startblock: "0", endblock: "99999999", page: "1", offset: String(offset), sort: "asc", apikey: key });
  const r = await fetch(`${ES}?${q}`, { signal: AbortSignal.timeout(12000) }).catch(() => null);
  if (!r || !r.ok) return [];
  const d = (await r.json().catch(() => null)) as any;
  if (d != null) usage.succeeded += 1;
  return Array.isArray(d?.result) ? d.result : [];
}

// Distinct contract addresses this wallet has deployed (creation txs: empty `to`,
// populated contractAddress, sent BY the wallet).
async function deployments(chainid: number, wallet: string, key: string, usage: CallCounter): Promise<string[]> {
  const txs = await txlist(chainid, wallet, key, 10000, usage);
  const created = new Set<string>();
  for (const t of txs) {
    if ((!t.to || t.to === "") && t.contractAddress && isAddr(t.contractAddress) && lc(t.from) === lc(wallet)) created.add(lc(t.contractAddress));
  }
  return [...created];
}

// Wallets this funder sent ETH to, in the gas-seeding band, excluding exchanges
// and itself — the candidate deployers it may have seeded.
async function seedRecipients(chainid: number, funder: string, key: string, usage: CallCounter): Promise<string[]> {
  const txs = await txlist(chainid, funder, key, 4000, usage);
  const recipients = new Set<string>();
  for (const t of txs) {
    if (lc(t.from) !== lc(funder)) continue;
    const to = t.to ? lc(t.to) : "";
    if (!to || !isAddr(to) || to === lc(funder) || CEX.has(to)) continue;
    const v = Number(t.value);
    if (v < MIN_SEED || v > MAX_SEED) continue;
    recipients.add(to);
    if (recipients.size >= MAX_CANDIDATES) break;
  }
  return [...recipients];
}

async function inChunks<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
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
  const wallet = typeof req.query.wallet === "string" ? req.query.wallet.trim() : "";
  const chain = (typeof req.query.chain === "string" ? req.query.chain : "").toLowerCase();
  const chainid = CHAINID[chain];
  if (!isAddr(wallet)) { res.status(400).json({ error: "valid EVM wallet required" }); return; }
  if (!chainid) { res.status(200).json({ wallet, available: false, note: `No Etherscan chain id for '${chain}'.` }); return; }
  if (!key) { res.status(200).json({ wallet, available: false, note: "Etherscan not configured; funder sweep unavailable." }); return; }

  const deadline = Date.now() + 50000;
  const usage: CallCounter = { calls: 0, succeeded: 0 };
  try {
    const [own, recipients] = await Promise.all([
      deployments(chainid, wallet, key, usage),
      seedRecipients(chainid, wallet, key, usage),
    ]);
    const checked = await inChunks(recipients, CHECK_CHUNK, async (w) => {
      if (Date.now() > deadline) return null;
      const created = await deployments(chainid, w, key, usage);
      return created.length ? { wallet: w, tokensCreated: created.length, sampleTokens: created.slice(0, 6).map((mint) => ({ mint })) } : null;
    });
    const seededDeployers = (checked.filter(Boolean) as { wallet: string; tokensCreated: number; sampleTokens: { mint: string }[] }[]).sort((a, b) => b.tokensCreated - a.tokensCreated);
    const totalTokens = seededDeployers.reduce((s, d) => s + d.tokensCreated, 0);

    const parts: string[] = [];
    if (own.length > 1) parts.push(`This wallet itself deployed ${own.length} contracts — a serial launcher.`);
    if (seededDeployers.length) parts.push(`It seeded ${seededDeployers.length} other deployer${seededDeployers.length === 1 ? "" : "s"} that launched ${totalTokens} contract${totalTokens === 1 ? "" : "s"}. A shared funder across launches is the signature of a serial operator.`);
    if (!parts.length) parts.push(recipients.length ? `Sent ETH to ${recipients.length} wallet${recipients.length === 1 ? "" : "s"}, none of which deployed contracts. No serial-launch pattern.` : "No launches or ETH-seeding found for this wallet.");

    res.status(200).json({
      wallet, available: true,
      ownLaunches: own.length,
      ownTokens: own.slice(0, 8).map((mint) => ({ mint })),
      seededDeployers,
      seededCount: seededDeployers.length,
      totalTokens,
      candidatesScanned: recipients.length,
      note: parts.join(" "),
    });
  } catch (e) {
    res.status(200).json({ wallet, available: true, seededDeployers: [], error: String(e), note: "Funder sweep failed." });
  } finally {
    if (usage.calls > 0) {
      await attachPanelCost(auth.organizationId, panelCostVersionId, {
        provider: "etherscan",
        op: "panel:evm-funder",
        calls: usage.calls,
        usd: 0,
        meta: "subscription/keyed",
        initiatedBy: auth.userId,
        status: usage.succeeded === usage.calls ? "succeeded" : usage.succeeded > 0 ? "partial" : "failed",
      });
    }
  }
}
