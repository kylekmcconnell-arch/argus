// The deployer's contract creations, read from the chain's explorer: the list
// the shipping read joins commits to, so "committed" can become "live". Pure
// fetch, keyless on Blockscout chains, keyed on Etherscan v2 chains; shared by
// the scan-time summary lane and the server-side collector. The on-click
// deployer panel (api/evm-deployer.ts) keeps its own richer read (funder,
// wallet age, CEX terminus); this is only the creation list.

export interface DeployTrailRecord {
  address: string;
  /** ISO time of the creation transaction. */
  at: string;
}

const ETHERSCAN = "https://api.etherscan.io/v2/api";
// dexscreener chainId string -> Etherscan v2 numeric chainid.
const CHAINID: Record<string, number> = {
  ethereum: 1, bsc: 56, base: 8453, polygon: 137, arbitrum: 42161,
  optimism: 10, avalanche: 43114, fantom: 250, linea: 59144, scroll: 534352,
};
// Chains Etherscan v2 does not index but a Blockscout instance does.
const BLOCKSCOUT: Record<string, string> = {
  robinhood: "https://robinhoodchain.blockscout.com/api",
  gnosis: "https://gnosis.blockscout.com/api",
};
const MAX_RECORDS = 50;
const isAddr = (s: string) => /^0x[a-fA-F0-9]{40}$/.test(s);

/** True when a trail can be read for this chain with what is configured. */
export function deployTrailReadable(chain: string, etherscanKey?: string): boolean {
  const c = chain.toLowerCase();
  return !!BLOCKSCOUT[c] || (!!CHAINID[c] && !!etherscanKey);
}

/**
 * Newest creations by `wallet`, oldest first. `null` when the chain is not
 * readable or the explorer failed; an empty list is a measured "none".
 */
export async function readDeployTrail(opts: { chain: string; wallet: string; etherscanKey?: string; fetchImpl?: typeof fetch; timeoutMs?: number }): Promise<DeployTrailRecord[] | null> {
  const chain = opts.chain.toLowerCase();
  const wallet = opts.wallet.trim();
  if (!isAddr(wallet)) return null;
  const f = opts.fetchImpl ?? fetch;
  const params: Record<string, string> = { module: "account", action: "txlist", address: wallet, startblock: "0", endblock: "99999999", page: "1", offset: "10000", sort: "asc" };
  let url: string;
  if (BLOCKSCOUT[chain]) url = `${BLOCKSCOUT[chain]}?${new URLSearchParams(params)}`;
  else if (CHAINID[chain] && opts.etherscanKey) url = `${ETHERSCAN}?${new URLSearchParams({ chainid: String(CHAINID[chain]), apikey: opts.etherscanKey, ...params })}`;
  else return null;
  try {
    const r = await f(url, { headers: { accept: "application/json", "user-agent": "argus-due-diligence" }, signal: AbortSignal.timeout(opts.timeoutMs ?? 12000) });
    if (!r.ok) return null;
    const body = (await r.json()) as { status?: string; message?: string; result?: unknown };
    const rows = Array.isArray(body.result) ? body.result : [];
    if (!rows.length && !(body.status === "0" && /no transactions found/i.test(`${body.message} ${body.result}`)) && body.status !== "1") return null;
    const seen = new Map<string, string>();
    for (const value of rows) {
      const tx = (value ?? {}) as Record<string, unknown>;
      const to = String(tx.to ?? "");
      const created = String(tx.contractAddress ?? "");
      const from = String(tx.from ?? "").toLowerCase();
      const ts = Number(tx.timeStamp);
      if (!to && created && isAddr(created) && from === wallet.toLowerCase() && !seen.has(created.toLowerCase())) {
        seen.set(created.toLowerCase(), Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000).toISOString() : "");
      }
    }
    return [...seen.entries()].filter(([, at]) => at).map(([address, at]) => ({ address, at })).slice(-MAX_RECORDS);
  } catch {
    return null;
  }
}
