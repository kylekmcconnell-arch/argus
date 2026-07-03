// Contract bytecode fingerprinting. GET /api/bytecode?address=<0x…>&chain=<chainId>
//
// Rug tokens are rarely hand-written — they're stamped out from a template: the
// same ERC-20 with a hidden mint / blacklist / pausable-trading switch, deployed
// again and again under new names. Two tokens with byte-identical runtime code are
// the SAME contract, so if one rugged the other is the same trap wearing a new
// ticker. This fetches the deployed bytecode, strips the compiler-metadata tail
// (which differs per build even for identical source), fingerprints the rest, and
// reads the function-selector table for the capabilities that actually enable a
// rug (a callable mint, a blacklist, a trading pause). The fingerprint is recorded
// as a graph node client-side, so byte-identical contracts bridge automatically —
// a fresh token that clones a known-AVOID rug lights up on its own.
//
// EVM only (Solana SPL tokens all share the one token program — no per-token code).
// Keyless: public RPC per chain. Self-contained, graceful on unknown chains.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createHash } from "crypto";

export const config = { maxDuration: 15 };

// Public, keyless RPCs per dexscreener chainId (publicnode primary — reliable from
// Vercel egress — then the chain-official RPC as fallback). Tried in order until
// one returns code; llamarpc was dropped after it 521'd from Vercel.
const RPC: Record<string, string[]> = {
  ethereum: ["https://ethereum-rpc.publicnode.com", "https://cloudflare-eth.com"],
  base: ["https://base-rpc.publicnode.com", "https://mainnet.base.org"],
  bsc: ["https://bsc-rpc.publicnode.com", "https://bsc-dataseed.binance.org"],
  polygon: ["https://polygon-bor-rpc.publicnode.com", "https://polygon-rpc.com"],
  arbitrum: ["https://arbitrum-one-rpc.publicnode.com", "https://arb1.arbitrum.io/rpc"],
  optimism: ["https://optimism-rpc.publicnode.com", "https://mainnet.optimism.io"],
  avalanche: ["https://avalanche-c-chain-rpc.publicnode.com", "https://api.avax.network/ext/bc/C/rpc"],
};

// Verified 4-byte selectors for the functions that actually enable a rug. Kept to
// selectors we're certain of (public constants); absence proves nothing, presence
// is a real, callable capability that corroborates the safety audit's own flags.
const KNOWN: Record<string, { name: string; risk: "bad" | "warn" | "info" }> = {
  "40c10f19": { name: "mint(address,uint256)", risk: "bad" },   // post-launch dilution
  a0712d68: { name: "mint(uint256)", risk: "bad" },
  "8456cb59": { name: "pause()", risk: "warn" },                // freeze trading
  "3f4ba83a": { name: "unpause()", risk: "info" },
  "0ecb93c0": { name: "addBlackList(address)", risk: "bad" },   // USDT-style blacklist
  e4997dc5: { name: "removeBlackList(address)", risk: "info" },
  fe575a87: { name: "blacklist(address)", risk: "bad" },
  "8da5cb5b": { name: "owner()", risk: "info" },
  "715018a6": { name: "renounceOwnership()", risk: "info" },
  f2fde38b: { name: "transferOwnership(address)", risk: "info" },
  "42966c68": { name: "burn(uint256)", risk: "info" },
  a9059cbb: { name: "transfer(address,uint256)", risk: "info" }, // confirms it's a token
};

async function ethGetCode(urls: string[], address: string): Promise<string | null> {
  for (const url of urls) {
    try {
      const r = await fetch(url, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getCode", params: [address, "latest"] }),
        signal: AbortSignal.timeout(9000),
      });
      if (!r.ok) continue;
      const d = (await r.json()) as any;
      // A live RPC that simply has no code returns "0x" — that's a real answer,
      // not a provider failure, so accept it and stop trying fallbacks.
      if (typeof d.result === "string") return d.result;
    } catch { /* try the next endpoint */ }
  }
  return null;
}

// Strip the trailing CBOR metadata Solidity appends (ipfs/bzzr hash + solc
// version). It differs across builds of identical source, so it must go before
// hashing or two clones would look distinct. Markers: a2 64 'ipfs' 58 22 …, or
// a2 65 'bzzr0' 58 20 …. Truncate from the last marker.
function stripMetadata(hex: string): string {
  const h = hex.toLowerCase().replace(/^0x/, "");
  const markers = ["a264697066735822", "a265627a7a72305820", "a265627a7a72315820"];
  let cut = h.length;
  for (const m of markers) { const i = h.lastIndexOf(m); if (i > 0 && i < cut) cut = i; }
  return h.slice(0, cut);
}

// Pull the function selectors out of the dispatcher. The common Solidity shape is
// PUSH4 <sel> EQ (…63 XXXXXXXX 14…) or PUSH4 <sel> DUP2 (…63 XXXXXXXX 81…). This
// over-captures a little, but we only ever look selectors up against KNOWN, so a
// stray match is harmless — it just won't resolve to a named capability.
function extractSelectors(code: string): string[] {
  const sels = new Set<string>();
  for (const re of [/63([0-9a-f]{8})14/g, /63([0-9a-f]{8})81/g]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(code))) sels.add(m[1]);
  }
  return [...sels];
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const address = typeof req.query.address === "string" ? req.query.address.trim() : "";
  const chain = (typeof req.query.chain === "string" ? req.query.chain : "").toLowerCase();
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) { res.status(400).json({ error: "valid EVM address required" }); return; }
  const urls = RPC[chain];
  if (!urls) { res.status(200).json({ address, chain, available: false, note: chain === "solana" ? "Bytecode fingerprinting is EVM-only (Solana tokens share the one SPL program)." : `No public RPC configured for chain '${chain}'.` }); return; }

  try {
    const raw = await ethGetCode(urls, address);
    if (raw == null) { res.status(200).json({ address, chain, available: false, note: "RPC did not return contract code." }); return; }
    if (raw === "0x" || raw.length <= 4) { res.status(200).json({ address, chain, available: true, isContract: false, note: "No contract code at this address (an externally-owned account, not a contract token)." }); return; }

    const runtime = stripMetadata(raw);
    const fingerprint = createHash("sha256").update(runtime).digest("hex").slice(0, 16);
    const codeSize = Math.floor(runtime.length / 2);
    const selectors = extractSelectors(runtime);
    const capabilities = selectors
      .filter((s) => KNOWN[s] && KNOWN[s].name !== "transfer(address,uint256)" && KNOWN[s].name !== "owner()")
      .map((s) => ({ selector: "0x" + s, ...KNOWN[s] }));
    const isToken = selectors.includes("a9059cbb");
    const danger = capabilities.filter((c) => c.risk === "bad");
    const warn = capabilities.filter((c) => c.risk === "warn");

    const tone: "good" | "warn" | "bad" = danger.length ? "bad" : warn.length ? "warn" : "good";
    const line = danger.length
      ? `The deployed code exposes ${danger.map((c) => c.name.split("(")[0]).join(", ")} — a callable ${danger.length === 1 ? "path" : "set of paths"} that can ${danger.some((c) => c.name.startsWith("mint")) ? "dilute holders" : "freeze or seize holdings"} after launch.`
      : warn.length
        ? `The code can ${warn.map((c) => c.name.split("(")[0]).join("/")} — a trading-control switch worth confirming is renounced.`
        : isToken
          ? "Standard token surface: no callable mint, blacklist, or pause found in the deployed code."
          : "Contract code fingerprinted; no standard ERC-20 transfer selector found (may be a proxy or non-standard token).";

    res.status(200).json({
      address, chain, available: true, isContract: true, isToken,
      fingerprint, codeSize, selectorCount: selectors.length,
      capabilities, verdict: { tone, line },
    });
  } catch (e) {
    res.status(200).json({ address, chain, available: true, error: String(e), note: "Bytecode fingerprint failed." });
  }
}
