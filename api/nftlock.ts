// Concentrated-liquidity (Uniswap V3) position custody. GET /api/nftlock?address=<pool>&chain=<id>
//
// A v3/v4 pool's liquidity is a position NFT minted by the chain's
// NonfungiblePositionManager (NFPM), not an LP token — so the standard
// "is the LP token locked/burned" check (tokenomics.ts) can't answer "can this
// be pulled?". This proves the answer from first principles instead of trusting
// a locker-name tag (which a bespoke launchpad/holder contract never carries):
//   1. Read the pool's Mint events — every one is owned by the chain's NFPM
//      (the periphery contract always mints to itself, per Uniswap's own code).
//   2. For the largest few positions by size, follow the same transaction to the
//      NFPM's own Transfer(mint)/IncreaseLiquidity log to recover the tokenId,
//      then call ownerOf(tokenId) NOW — the position may have been moved into a
//      locker after minting, which the pool alone never shows.
//   3. Classify that current owner: a burn address is permanently locked; an EOA
//      is a wallet that can move it at will; a contract is read for its verified
//      source (Blockscout) and checked for any reachable NFT-transfer or
//      decrease-liquidity path — if none exists (the common "LpHolder"-style
//      utility: ERC721Holder + fee-collection only, no withdrawal function), the
//      position is provably stuck forever, not just "locked by design" folklore.
// EVM only. NFPM addresses are verified on-chain per chain (via a real pool's
// Mint-log owner, cross-checked against the explorer's contract name) — a chain
// missing here degrades to "not supported" rather than a guessed address.
import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = { maxDuration: 25 };

const RPC: Record<string, string[]> = {
  base: ["https://base-rpc.publicnode.com", "https://mainnet.base.org"],
  robinhood: ["https://rpc.mainnet.chain.robinhood.com"],
};
const BLOCKSCOUT: Record<string, string> = {
  base: "https://base.blockscout.com",
  robinhood: "https://robinhoodchain.blockscout.com",
};
// Verified on-chain (see src/threat/RESEARCH.md): the "owner" on every Mint
// event of a real V3 pool on that chain, cross-checked against the explorer's
// contract name ("Uniswap V3 Positions NFT-V1" / "NonfungiblePositionManager").
const NFPM: Record<string, string> = {
  base: "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1",
  robinhood: "0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3",
};

const BURN_ADDRS = new Set(["0x0000000000000000000000000000000000dead", "0x0000000000000000000000000000000000000000"]);
const MINT_TOPIC = "0x7a53080ba414158be7ec69b987b5fb7d07dee101fe85488f0853ae16239d0bde";
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const INCREASE_LIQ_TOPIC = "0x3067048beee31b25b2f1681f88dac838c8bba36af25bfb2b7cf7473a5847e35f";
// Selectors that can move the NFT (or its underlying liquidity) out of a
// contract holding it — the weaker, bytecode-only fallback when source isn't
// verified. A holder contract exposing none of these has no callable exit.
const ESCAPE_SELECTORS: Record<string, string> = {
  "23b872dd": "transferFrom(address,address,uint256)",
  "42842e0e": "safeTransferFrom(address,address,uint256)",
  b88d4fde: "safeTransferFrom(address,address,uint256,bytes)",
};
// Same check against verified SOURCE text (catches a custom wrapper function
// that internally calls one of these, which selector-matching on the wrapper's
// OWN dispatch table would miss).
const ESCAPE_SOURCE_PATTERN = /\.transferFrom\s*\(|\.safeTransferFrom\s*\(|\.decreaseLiquidity\s*\(|\.burn\s*\(\s*tokenId|nonfungiblePositionManager\.burn/i;

async function rpc(urls: string[], method: string, params: unknown[]): Promise<any> {
  for (const url of urls) {
    try {
      const r = await fetch(url, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(9000),
      });
      if (!r.ok) continue;
      const d = (await r.json()) as any;
      if (d.result !== undefined) return d.result;
    } catch { /* try the next endpoint */ }
  }
  return undefined;
}

// ownerOf() specifically: a position fully withdrawn AND closed (NFPM.burn
// called once liquidity hits 0) reverts with "nonexistent token" — that's not
// an RPC failure, it's proof the position no longer exists at all, which is
// itself worth surfacing (a large add that was later fully pulled out).
async function ownerOf(urls: string[], nfpm: string, tokenId: number): Promise<{ owner: string | null; closed: boolean }> {
  const data = "0x6352211e" + tokenId.toString(16).padStart(64, "0");
  for (const url of urls) {
    try {
      const r = await fetch(url, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: nfpm, data }, "latest"] }),
        signal: AbortSignal.timeout(9000),
      });
      if (!r.ok) continue;
      const d = (await r.json()) as any;
      if (typeof d.result === "string" && d.result.length >= 66) return { owner: "0x" + d.result.slice(-40), closed: false };
      if (d.error && /nonexistent token/i.test(String(d.error.message ?? ""))) return { owner: null, closed: true };
    } catch { /* try the next endpoint */ }
  }
  return { owner: null, closed: false };
}

async function blockscoutGetLogs(base: string, address: string, topic0: string): Promise<any[]> {
  try {
    const r = await fetch(
      `${base}/api?module=logs&action=getLogs&address=${address}&topic0=${topic0}&fromBlock=0&toBlock=latest`,
      { signal: AbortSignal.timeout(15000) },
    );
    if (!r.ok) return [];
    const d = (await r.json()) as any;
    return d.status === "1" && Array.isArray(d.result) ? d.result : [];
  } catch {
    return [];
  }
}

async function blockscoutContract(base: string, address: string): Promise<{ name: string | null; verified: boolean; source: string } | null> {
  try {
    const r = await fetch(`${base}/api/v2/smart-contracts/${address}`, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const d = (await r.json()) as any;
    return { name: d.name ?? null, verified: true, source: String(d.source_code ?? "") };
  } catch {
    return null;
  }
}

function selectorsOf(code: string): Set<string> {
  const sels = new Set<string>();
  for (const re of [/63([0-9a-f]{8})14/g, /63([0-9a-f]{8})81/g]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(code))) sels.add(m[1]);
  }
  return sels;
}

interface Position {
  tokenId: number;
  owner: string | null;
  ownerKind: "burned" | "eoa" | "contract" | "closed";
  ownerName: string | null;
  amount: string; // raw liquidity units at mint, for relative ranking only
  locked: boolean | null; // true = no exit path found; false = one was found; null = couldn't tell
  reason: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const address = typeof req.query.address === "string" ? req.query.address.trim() : "";
  const chain = (typeof req.query.chain === "string" ? req.query.chain : "").toLowerCase();
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) { res.status(400).json({ available: false, error: "valid pool address required" }); return; }
  const urls = RPC[chain];
  const bs = BLOCKSCOUT[chain];
  const nfpm = NFPM[chain];
  if (!urls || !bs || !nfpm) { res.status(200).json({ available: false, note: `NFT-position custody check not yet supported on '${chain}'.` }); return; }

  try {
    const mintLogs = await blockscoutGetLogs(bs, address, MINT_TOPIC);
    if (!mintLogs.length) { res.status(200).json({ available: true, manager: nfpm, positions: [], note: "No Uniswap V3 Mint events found for this pool: not a V3 position pool, or on a version this check doesn't cover yet." }); return; }

    // Rank by liquidity added at mint time (the `amount` word right after the
    // padded `sender` address in the log data) — a directional size proxy, not
    // netted against later Burns, so treat it as "which positions mattered most
    // historically," not a live TVL split.
    const ranked = mintLogs
      .map((l) => {
        const data = String(l.data ?? "0x").replace(/^0x/, "");
        const amountHex = data.slice(64, 128) || "0";
        let amount = 0n;
        try { amount = BigInt("0x" + (amountHex || "0")); } catch { /* leave 0 */ }
        return { txHash: String(l.transactionHash), amount };
      })
      .sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0));
    const dedupTx = [...new Map(ranked.map((r) => [r.txHash, r])).values()].slice(0, 5);

    const positions: Position[] = [];
    for (const { txHash, amount } of dedupTx) {
      const receipt = await rpc(urls, "eth_getTransactionReceipt", [txHash]);
      const logs: any[] = receipt?.logs ?? [];
      let tokenId: number | null = null;
      for (const l of logs) {
        if (String(l.address ?? "").toLowerCase() !== nfpm.toLowerCase()) continue;
        const t0 = String(l.topics?.[0] ?? "").toLowerCase();
        if (t0 === TRANSFER_TOPIC && l.topics?.length === 4) { tokenId = Number(BigInt(l.topics[3])); break; }
        if (t0 === INCREASE_LIQ_TOPIC && l.topics?.length === 2) { tokenId = Number(BigInt(l.topics[1])); break; }
      }
      if (tokenId == null) continue;

      // ownerOf(uint256) — the CURRENT holder, which may differ from the mint
      // recipient if the NFT was moved into a locker afterward.
      const { owner, closed } = await ownerOf(urls, nfpm, tokenId);
      if (closed) {
        positions.push({ tokenId, owner: null, ownerKind: "closed", ownerName: null, amount: amount.toString(), locked: null, reason: "This position was fully withdrawn and its NFT closed. The liquidity it once held is no longer in the pool at all." });
        continue;
      }
      if (!owner) continue; // genuine RPC failure on this position — skip rather than guess
      const ownerLc = owner.toLowerCase();

      if (BURN_ADDRS.has(ownerLc)) {
        positions.push({ tokenId, owner, ownerKind: "burned", ownerName: null, amount: amount.toString(), locked: true, reason: "The position NFT sits at a burn address, so the liquidity can never be withdrawn by anyone." });
        continue;
      }
      const code = await rpc(urls, "eth_getCode", [owner, "latest"]);
      const isContract = typeof code === "string" && code !== "0x" && code.length > 4;
      if (!isContract) {
        positions.push({ tokenId, owner, ownerKind: "eoa", ownerName: null, amount: amount.toString(), locked: false, reason: `Held directly by wallet ${owner}, a plain EOA, so it can withdraw the position at any time.` });
        continue;
      }
      const contract = await blockscoutContract(bs, owner);
      if (contract?.verified && contract.source) {
        const hasEscape = ESCAPE_SOURCE_PATTERN.test(contract.source);
        positions.push({
          tokenId, owner, ownerKind: "contract", ownerName: contract.name,
          amount: amount.toString(), locked: !hasEscape,
          reason: hasEscape
            ? `Held by the verified contract ${contract.name ?? owner}. Its source exposes a way to move the position or its liquidity out; confirm who controls that path.`
            : `Held by the verified contract ${contract.name ?? owner}. Its source exposes no function that can transfer the NFT or decrease its liquidity, so the position has no callable exit.`,
        });
        continue;
      }
      // Not verified — fall back to the bytecode-selector probe (weaker: misses
      // a custom function that internally forwards to a transfer/decrease call).
      if (typeof code === "string") {
        const sels = selectorsOf(code);
        const found = [...sels].filter((s) => ESCAPE_SELECTORS[s]);
        positions.push({
          tokenId, owner, ownerKind: "contract", ownerName: contract?.name ?? null,
          amount: amount.toString(), locked: found.length ? false : null,
          reason: found.length
            ? `Held by an unverified contract (${owner}) whose bytecode exposes ${found.map((s) => ESCAPE_SELECTORS[s].split("(")[0]).join("/")}, so it can move the position.`
            : `Held by an unverified contract (${owner}). No source confirms a lock; its bytecode exposes no standard NFT-transfer selector, but a custom exit path can't be ruled out from bytecode alone.`,
        });
      }
    }

    // The dominant (largest-by-size) LIVE position — a closed position no
    // longer holds any liquidity, so it shouldn't stand in for "is the CURRENT
    // liquidity locked," even though it's still worth reporting.
    const live = positions.filter((p) => p.ownerKind !== "closed");
    const dominant = live[0] ?? null;
    const closedCount = positions.length - live.length;
    res.status(200).json({
      available: true, manager: nfpm, positions, dominant,
      note: dominant
        ? `${live.length} live position${live.length === 1 ? "" : "s"} traced by size${closedCount ? ` (${closedCount} other large position${closedCount === 1 ? "" : "s"} since fully withdrawn)` : ""}; largest is ${dominant.ownerKind === "burned" ? "burned" : dominant.locked === true ? "locked (no exit path found)" : dominant.locked === false ? "removable" : "unconfirmed"}.`
        : positions.length
          ? `The ${positions.length} largest historical position${positions.length === 1 ? "" : "s"} traced have since been fully withdrawn and closed.`
          : "Mint events were found but no position could be traced to a current owner.",
    });
  } catch (e) {
    res.status(200).json({ available: false, error: String(e), note: "NFT-position custody check failed." });
  }
}
