// On-chain forensics adapter. Helius covers attributed Solana wallets. A
// Bitquery credential may be configured for future work, but there is no
// Bitquery collector in this adapter yet and it must never make a run live.
// Wallet attribution itself remains a separate SelfDoxxed /
// InvestigatorAttributed evidence step and is never inferred here.

import type { Adapter, AdapterRunResult, CollectContext } from "./types";
import { recordHelius } from "../cost";
import { env } from "../config";

interface HeliusActivity {
  count: number;
  latest?: number;
}

interface HeliusOutcome {
  activity: HeliusActivity | null;
  state: AdapterRunResult["state"];
  detail: string;
  attempted: boolean;
}

const isHeliusTransaction = (value: unknown): value is { signature: string; timestamp?: number } => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.signature === "string"
    && row.signature.trim().length > 0
    && (row.timestamp === undefined || typeof row.timestamp === "number");
};

async function collectHeliusWalletActivity(address: string): Promise<HeliusOutcome> {
  const key = env("HELIUS_API_KEY");
  if (!key) {
    return {
      activity: null,
      state: "skipped",
      detail: "Helius is not configured",
      attempted: false,
    };
  }
  let res: Response;
  try {
    res = await fetch(
      `https://api.helius.xyz/v0/addresses/${address}/transactions?api-key=${key}&limit=50`,
      { signal: AbortSignal.timeout(8_000) },
    );
  } catch {
    recordHelius("address-transactions", "failed", "subscription/keyed · transport_error");
    return { activity: null, state: "failed", detail: "Helius transport error", attempted: true };
  }
  if (!res.ok) {
    recordHelius("address-transactions", "failed", `subscription/keyed · http_${res.status}`);
    return { activity: null, state: "failed", detail: `Helius HTTP ${res.status}`, attempted: true };
  }

  let value: unknown;
  try { value = await res.json(); }
  catch {
    recordHelius("address-transactions", "failed", "subscription/keyed · response_json_error");
    return { activity: null, state: "failed", detail: "Helius response JSON error", attempted: true };
  }
  if (!Array.isArray(value)) {
    recordHelius("address-transactions", "partial", "subscription/keyed · result_shape_error");
    return { activity: null, state: "partial", detail: "Helius result shape was incomplete", attempted: true };
  }
  const transactions = value.filter(isHeliusTransaction);
  const malformed = transactions.length !== value.length;
  recordHelius(
    "address-transactions",
    malformed ? "partial" : "succeeded",
    malformed ? "subscription/keyed · incomplete_transaction_shape" : "subscription/keyed",
  );
  return {
    activity: {
      count: transactions.length,
      latest: typeof transactions[0]?.timestamp === "number" ? transactions[0].timestamp : undefined,
    },
    state: malformed ? "partial" : "executed",
    detail: malformed ? "Helius returned at least one incomplete transaction row" : "Helius transaction history returned",
    attempted: true,
  };
}

export async function heliusWalletActivity(address: string): Promise<HeliusActivity | null> {
  return (await collectHeliusWalletActivity(address)).activity;
}

const attributedSolanaWallets = (evidence: CollectContext["evidence"]) => evidence.wallets.filter(
  (wallet) => wallet.chain === "solana"
    && (wallet.link_tier === "SelfDoxxed" || wallet.link_tier === "InvestigatorAttributed"),
);

export const onchainAdapter: Adapter = {
  id: "onchain",
  label: "On-chain forensics (Helius)",
  available: () => !!env("HELIUS_API_KEY"),
  applicable: (evidence) => attributedSolanaWallets(evidence).length > 0,
  async run(ctx: CollectContext) {
    if (!env("HELIUS_API_KEY")) {
      return { state: "skipped", attempts: 0, detail: "Helius is not configured" };
    }
    const wallets = attributedSolanaWallets(ctx.evidence);
    if (!wallets.length) {
      return { state: "skipped", attempts: 0, detail: "no attributed Solana wallet was available for Helius" };
    }
    ctx.emit({ phase: "On-chain", label: "Wallet forensics", detail: `Examining ${wallets.length} attributed wallet(s)…`, tone: "neutral" });
    const outcomes: HeliusOutcome[] = [];
    for (const w of wallets) {
      const outcome = await collectHeliusWalletActivity(w.address);
      outcomes.push(outcome);
      if (outcome.activity) {
        w.activity_summary = `${outcome.activity.count} recent txs`;
        ctx.emit({ phase: "On-chain", label: `${w.address.slice(0, 6)}…`, detail: `${outcome.activity.count} recent transactions`, source: "helius", tone: w.sold_into_own_promo ? "bad" : "neutral" });
      }
    }
    const attempts = outcomes.filter((outcome) => outcome.attempted);
    if (!attempts.length) {
      return { state: "skipped", attempts: 0, detail: "no Helius provider attempt was observed" };
    }
    const failed = attempts.filter((outcome) => outcome.state === "failed").length;
    const partial = attempts.filter((outcome) => outcome.state === "partial").length;
    const state: AdapterRunResult["state"] = failed === attempts.length
      ? "failed"
      : failed || partial
        ? "partial"
        : "executed";
    return {
      state,
      attempts: attempts.length,
      detail: `${attempts.length} Helius attempt${attempts.length === 1 ? "" : "s"} · ${failed} failed · ${partial} partial`,
    };
  },
};
