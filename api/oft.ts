// LayerZero OFT / cross-chain detection. GET /api/oft?address=<0x…>&chain=<id>
//
// A LayerZero OmniFungible Token spreads one asset (and its liquidity) across
// many chains. A scanner that only sees one chain's pool reports "thin liquidity"
// on a token that actually has deep liquidity elsewhere — and it can't tell a
// real cross-chain project from a namesquat. This proves the mesh from first
// principles: confirm the contract is an OFT (oftVersion/endpoint getters), then
// read its on-chain peers(eid) mapping — the peer addresses the deployer
// cryptographically registered on other chains. No name-matching, so a squatter
// can never be mistaken for a sister pool.
//
// EVM source token only (reading a Solana OFT's peers is a different mechanism);
// but the peers it enumerates CAN include the Solana leg. Keyless (public RPC).
import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = { maxDuration: 25 };

// Public, keyless RPCs per dexscreener chainId.
const RPC: Record<string, string[]> = {
  ethereum: ["https://ethereum-rpc.publicnode.com", "https://cloudflare-eth.com"],
  base: ["https://base-rpc.publicnode.com", "https://mainnet.base.org"],
  bsc: ["https://bsc-rpc.publicnode.com", "https://bsc-dataseed.binance.org"],
  polygon: ["https://polygon-bor-rpc.publicnode.com", "https://polygon-rpc.com"],
  arbitrum: ["https://arbitrum-one-rpc.publicnode.com", "https://arb1.arbitrum.io/rpc"],
  optimism: ["https://optimism-rpc.publicnode.com", "https://mainnet.optimism.io"],
  avalanche: ["https://avalanche-c-chain-rpc.publicnode.com", "https://api.avax.network/ext/bc/C/rpc"],
  robinhood: ["https://rpc.mainnet.chain.robinhood.com"],
};

// LayerZero V2 mainnet Endpoint IDs → dexscreener chainId. (Verified constants.)
const EID_CHAIN: Record<number, string> = {
  30101: "ethereum", 30102: "bsc", 30106: "avalanche", 30109: "polygon",
  30110: "arbitrum", 30111: "optimism", 30184: "base", 30168: "solana",
  30416: "robinhood",
};
// The reverse, to skip querying a token's own chain.
const CHAIN_EID: Record<string, number> = Object.fromEntries(Object.entries(EID_CHAIN).map(([e, c]) => [c, Number(e)]));

// Verified 4-byte selectors.
const SEL = {
  oftVersion: "0x156a0d0f",
  endpoint: "0x5e280f11",
  token: "0xfc0c546a",
  approvalRequired: "0x9f68b964",
  peers: "0xbb0b6a53", // peers(uint32)
};

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(bytes: number[]): string {
  const digits = [0];
  for (const b of bytes) {
    let carry = b;
    for (let j = 0; j < digits.length; j++) { carry += digits[j] << 8; digits[j] = carry % 58; carry = (carry / 58) | 0; }
    while (carry) { digits.push(carry % 58); carry = (carry / 58) | 0; }
  }
  let str = "";
  for (const b of bytes) { if (b === 0) str += "1"; else break; }
  for (let k = digits.length - 1; k >= 0; k--) str += B58[digits[k]];
  return str;
}

async function ethCall(urls: string[], to: string, data: string): Promise<string | null> {
  for (const url of urls) {
    try {
      const r = await fetch(url, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }),
        signal: AbortSignal.timeout(9000),
      });
      if (!r.ok) continue;
      const d = (await r.json()) as { result?: unknown };
      if (typeof d.result === "string") return d.result;
    } catch { /* next endpoint */ }
  }
  return null;
}

const isZeroWord = (w: string) => /^0x0*$/.test(w);
const addrFromWord = (w: string) => "0x" + w.replace(/^0x/, "").padStart(64, "0").slice(24);
const bytes32ToBase58 = (w: string) => {
  const h = w.replace(/^0x/, "").padStart(64, "0");
  const arr: number[] = [];
  for (let i = 0; i < 64; i += 2) arr.push(parseInt(h.slice(i, i + 2), 16));
  return base58(arr);
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const address = String(req.query.address ?? "").toLowerCase();
  const chain = String(req.query.chain ?? "ethereum");
  if (!/^0x[a-f0-9]{40}$/.test(address)) { res.status(400).json({ available: false, error: "bad address" }); return; }
  const urls = RPC[chain];
  if (!urls) { res.status(200).json({ available: false, note: "OFT detection not available for this chain keyless" }); return; }

  try {
    // Confirm it's an OFT: oftVersion() must return non-empty.
    const ver = await ethCall(urls, address, SEL.oftVersion);
    if (ver == null || isZeroWord(ver) || ver === "0x") {
      res.status(200).json({ available: true, isOft: false });
      return;
    }
    const [endpointWord, approvalWord, tokenWord] = await Promise.all([
      ethCall(urls, address, SEL.endpoint),
      ethCall(urls, address, SEL.approvalRequired),
      ethCall(urls, address, SEL.token),
    ]);
    const endpoint = endpointWord && !isZeroWord(endpointWord) ? addrFromWord(endpointWord) : null;
    const isAdapter = approvalWord ? !isZeroWord(approvalWord) : false; // approvalRequired() true = lockbox adapter
    const underlying = isAdapter && tokenWord && !isZeroWord(tokenWord) ? addrFromWord(tokenWord) : null;

    // Read peers(eid) for every OTHER chain's EID — the registered sister OFTs.
    const selfEid = CHAIN_EID[chain];
    const eids = Object.keys(EID_CHAIN).map(Number).filter((e) => e !== selfEid);
    const peers = (await Promise.all(eids.map(async (eid) => {
      const data = SEL.peers + eid.toString(16).padStart(64, "0");
      const word = await ethCall(urls, address, data);
      if (!word || isZeroWord(word)) return null;
      const peerChain = EID_CHAIN[eid];
      const peerAddress = peerChain === "solana" ? bytes32ToBase58(word) : addrFromWord(word);
      return { eid, chain: peerChain, address: peerAddress };
    }))).filter(Boolean);

    res.status(200).json({ available: true, isOft: true, isAdapter, endpoint, underlying, chain, peers });
  } catch (e) {
    res.status(200).json({ available: false, error: String(e) });
  }
}
