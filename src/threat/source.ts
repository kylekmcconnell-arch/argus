// Verified contract source, fetched keyless from the browser. Two public,
// CORS-open verification databases, tried in order:
//   1. Sourcify — one endpoint for every EVM chain, exact + partial matches.
//   2. Blockscout — per-chain instances; carries its own verification DB.
// Etherscan has the deepest coverage but needs a key, so the server-side AI
// review endpoint (api/code-review.ts) handles that tier; this module is the
// keyless floor that always works on the static site.

import type { ContractSource, SourceFile } from "./types";

// dexscreener chainId -> EVM numeric chain id (Sourcify keys by number).
export const EVM_CHAIN_ID: Record<string, number> = {
  ethereum: 1,
  bsc: 56,
  base: 8453,
  polygon: 137,
  arbitrum: 42161,
  optimism: 10,
  avalanche: 43114,
  fantom: 250,
  cronos: 25,
  zksync: 324,
  linea: 59144,
  scroll: 534352,
};

// Public Blockscout instances per dexscreener chainId. Only chains with a
// maintained official instance — a wrong host would hang, not help.
const BLOCKSCOUT: Record<string, string> = {
  ethereum: "https://eth.blockscout.com",
  base: "https://base.blockscout.com",
  polygon: "https://polygon.blockscout.com",
  arbitrum: "https://arbitrum.blockscout.com",
  optimism: "https://optimism.blockscout.com",
  zksync: "https://zksync.blockscout.com",
  linea: "https://explorer.linea.build",
  scroll: "https://blockscout.scroll.io",
};

// Solidity sources only — the scanner reads Solidity; JSON metadata and Vyper
// are skipped rather than mis-scanned.
const isSol = (p: string) => /\.sol$/i.test(p);

async function fromSourcify(chainId: number, address: string): Promise<ContractSource | null> {
  try {
    const res = await fetch(
      `https://sourcify.dev/server/v2/contract/${chainId}/${address}?fields=sources,compilation`,
      { signal: AbortSignal.timeout(10000) },
    );
    if (!res.ok) return null;
    const d = (await res.json()) as {
      match?: string | null;
      sources?: Record<string, { content?: string }>;
      compilation?: { name?: string; compilerVersion?: string };
    };
    if (!d.match || !d.sources) return null;
    const files: SourceFile[] = Object.entries(d.sources)
      .filter(([p, s]) => isSol(p) && typeof s?.content === "string")
      .map(([path, s]) => ({ path, content: s.content! }));
    if (!files.length) return null;
    return {
      verified: true,
      origin: "sourcify",
      contractName: d.compilation?.name ?? null,
      compiler: d.compilation?.compilerVersion ?? null,
      files,
    };
  } catch {
    return null;
  }
}

async function fromBlockscout(base: string, address: string): Promise<ContractSource | null> {
  try {
    const res = await fetch(`${base}/api/v2/smart-contracts/${address}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const d = (await res.json()) as {
      is_verified?: boolean;
      name?: string;
      compiler_version?: string;
      source_code?: string;
      file_path?: string;
      additional_sources?: { file_path?: string; source_code?: string }[];
    };
    if (!d.is_verified || !d.source_code) return null;
    const files: SourceFile[] = [
      { path: d.file_path || `${d.name ?? "Contract"}.sol`, content: d.source_code },
      ...(d.additional_sources ?? [])
        .filter((s) => s.file_path && s.source_code)
        .map((s) => ({ path: s.file_path!, content: s.source_code! })),
    ].filter((f) => isSol(f.path));
    if (!files.length) return null;
    return {
      verified: true,
      origin: "blockscout",
      contractName: d.name ?? null,
      compiler: d.compiler_version ?? null,
      files,
    };
  } catch {
    return null;
  }
}

export async function fetchContractSource(chain: string, address: string): Promise<ContractSource> {
  const none: ContractSource = { verified: false, origin: null, contractName: null, compiler: null, files: [] };
  const chainId = EVM_CHAIN_ID[chain];
  if (!chainId) return none;
  const bs = BLOCKSCOUT[chain];
  // Race both databases; first verified answer wins, so one slow host can't
  // stall the scan.
  const attempts = [fromSourcify(chainId, address), ...(bs ? [fromBlockscout(bs, address)] : [])];
  const results = await Promise.all(attempts);
  return results.find((r) => r) ?? none;
}
