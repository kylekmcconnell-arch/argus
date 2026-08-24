// Arkham audit lane for addresses the subject actually bound to itself.
// Attribution is gated here, before provider risk can become report context.
import { recordCall } from "../cost";
import { env } from "../config";
import type { Adapter, AdapterRunResult, CollectContext, CollectedEvidence } from "./types";
import type { Wallet, WalletBinding, WalletExposureSource, WalletScreen } from "../../src/engine";
import {
  ARKHAM_INTEL_BATCH,
  ARKHAM_RISK_BATCH,
  fetchAddressLabelsBatch,
  fetchAddressRiskBatch,
  fetchAddressRiskPaths,
  type ArkhamAddressLabel,
  type ArkhamAddressRisk,
  type SeedLabeller,
} from "../../api/_arkham-core";
import { PUBLIC_EVM_RPC, createHttpEvmRpcTransport } from "./evmControlReality";

export const MAX_SCREENED_WALLETS = 4;
const DETAIL_BUDGET_MS = 25_000;
const RISK_DETAIL = "GET /risk/address/{address}";
const ATTRIBUTABLE: readonly WalletBinding[] = ["farcaster_verified", "self_disclosed"];
const BINDING_STRENGTH: Record<WalletBinding, number> = {
  farcaster_verified: 2,
  self_disclosed: 1,
  handle_name_guess: 0,
};
const CONTROL_TEST_CHAINS = ["ethereum", "base"] as const;

export type BoundWallet = Wallet & { binding: WalletBinding };

export function screenableWallets(evidence: CollectedEvidence): BoundWallet[] {
  return evidence.wallets
    .filter((wallet): wallet is BoundWallet =>
      Boolean(wallet.binding) && ATTRIBUTABLE.includes(wallet.binding as WalletBinding))
    .sort((a, b) => BINDING_STRENGTH[b.binding] - BINDING_STRENGTH[a.binding])
    .slice(0, MAX_SCREENED_WALLETS);
}

export type ControlProbe = "eoa" | "contract" | "inconclusive" | "established";

export async function probeEvmControl(
  address: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ControlProbe> {
  let answered = false;
  for (const chain of CONTROL_TEST_CHAINS) {
    for (const url of PUBLIC_EVM_RPC[chain] ?? []) {
      const transport = createHttpEvmRpcTransport(url, fetchImpl, 6_000);
      const reply = await transport.request("eth_getCode", [address, "latest"]);
      recordCall(
        "public-evm-rpc",
        "arkham-control-test",
        0,
        `eth_getCode/${chain}`,
        reply.ok ? "succeeded" : "failed",
      );
      if (!reply.ok || typeof reply.result !== "string") continue;
      answered = true;
      if (reply.result.replace(/^0x/i, "").length > 0) return "contract";
      break;
    }
  }
  return answered ? "eoa" : "inconclusive";
}

const needsControlTest = (wallet: BoundWallet): boolean =>
  wallet.binding === "self_disclosed" && wallet.chain !== "solana";

const screen = (
  wallet: BoundWallet,
  status: WalletScreen["status"],
  detail: string,
  endpoints: string[],
  extra: Partial<Pick<WalletScreen, "entity" | "risk">> = {},
): WalletScreen => ({
  status,
  detail,
  provider: "arkham",
  endpoints,
  capturedAt: new Date().toISOString(),
  binding: wallet.binding,
  bindingNote: wallet.notes,
  ...extra,
});

const entityOf = (label?: ArkhamAddressLabel): WalletScreen["entity"] => label
  ? {
      name: label.name,
      type: label.type,
      twitter: label.twitter,
      isCex: label.isCex,
      isService: label.isService,
      isContract: label.isContract,
    }
  : undefined;

const exposed = (risk: ArkhamAddressRisk): boolean =>
  risk.isSeed || (risk.level !== "" && risk.level.toUpperCase() !== "NONE") || risk.score > 0;

const short = (address: string): string => `${address.slice(0, 6)}…${address.slice(-4)}`;

export const arkhamAdapter: Adapter = {
  id: "arkham",
  label: "Wallet identity and risk exposure (Arkham)",
  available: () => !!env("ARKHAM_API_KEY"),
  applicable: (evidence) => screenableWallets(evidence).length > 0,

  async run(ctx: CollectContext): Promise<AdapterRunResult> {
    const key = env("ARKHAM_API_KEY");
    if (!key) return { state: "skipped", attempts: 0, detail: "Arkham is not configured" };
    const wallets = screenableWallets(ctx.evidence);
    if (!wallets.length) {
      return { state: "skipped", attempts: 0, detail: "no evidence-bound subject wallet was available" };
    }

    ctx.emit({
      phase: "On-chain",
      label: "Wallet screening",
      detail: `Screening ${wallets.length} address${wallets.length === 1 ? "" : "es"} the subject bound to itself.`,
      source: "arkham",
      tone: "neutral",
    });

    const control = new Map<string, ControlProbe>();
    await Promise.all(wallets.map(async (wallet) => {
      if (!needsControlTest(wallet)) {
        control.set(wallet.address.toLowerCase(), "established");
        return;
      }
      try {
        control.set(wallet.address.toLowerCase(), await probeEvmControl(wallet.address));
      } catch {
        control.set(wallet.address.toLowerCase(), "inconclusive");
      }
    }));

    const addresses = wallets.map((wallet) => wallet.address);
    const labels = await fetchAddressLabelsBatch(addresses, key);
    recordCall(
      "arkham",
      "scan:address-labels-batch",
      0,
      `subscription/keyed · ${labels.rows.size}/${addresses.length} rows · provider credits not converted to USD`,
      labels.outcome === "answered" ? "succeeded" : "failed",
    );

    const attributable = wallets.filter((wallet) => {
      const key = wallet.address.toLowerCase();
      return (control.get(key) === "eoa" || control.get(key) === "established")
        && labels.rows.get(key)?.isContract !== true;
    });
    const risk = attributable.length
      ? await fetchAddressRiskBatch(attributable.map((wallet) => wallet.address), key)
      : null;
    if (risk) {
      recordCall(
        "arkham",
        "scan:risk-batch",
        0,
        risk.outcome === "unentitled"
          ? "risk-addon/not-entitled · provider credits not converted to USD"
          : `subscription/keyed · ${risk.rows.size}/${attributable.length} rows · provider credits not converted to USD`,
        risk.outcome === "answered" ? "succeeded" : "failed",
      );
    }
    if (risk?.outcome === "unentitled") {
      ctx.emit({
        phase: "On-chain",
        label: "Wallet exposure not screened",
        detail: "The Arkham subscription does not include its separate Risk Scoring add-on. This is a coverage gap, not a clean result.",
        source: "arkham",
        tone: "warn",
      });
    }

    const labelSeeds: SeedLabeller = async (seeds) => {
      const batch = await fetchAddressLabelsBatch(seeds, key);
      recordCall(
        "arkham",
        "scan:seed-labels-batch",
        0,
        `subscription/keyed · ${batch.rows.size}/${seeds.length} rows · provider credits not converted to USD`,
        batch.outcome === "answered" ? "succeeded" : "failed",
      );
      const names = new Map<string, { name?: string; type?: string }>();
      for (const [address, label] of batch.rows) names.set(address, { name: label.name, type: label.type });
      return { names, calls: 0, succeeded: 0 };
    };

    const deadline = Date.now() + DETAIL_BUDGET_MS;
    const details = new Map<string, WalletExposureSource[]>();
    const detailMissed = new Set<string>();
    if (risk?.outcome === "answered") {
      const flagged = attributable.filter((wallet) => {
        const row = risk.rows.get(wallet.address.toLowerCase());
        return row ? exposed(row) : false;
      });
      await Promise.all(flagged.map(async (wallet) => {
        const address = wallet.address.toLowerCase();
        if (Date.now() >= deadline) {
          detailMissed.add(address);
          return;
        }
        try {
          const result = await fetchAddressRiskPaths(wallet.address, key, labelSeeds);
          for (let index = 0; index < result.calls; index += 1) {
            recordCall(
              "arkham",
              "scan:risk-paths",
              0,
              "subscription/keyed · provider credits not converted to USD",
              index < result.succeeded ? "succeeded" : "failed",
            );
          }
          if (!result.available) {
            detailMissed.add(address);
            return;
          }
          details.set(address, result.paths.map((path) => ({
            seed: path.seed,
            seedName: path.seedName,
            category: path.category,
            direction: path.direction,
            usd: path.usd,
            hops: path.hops,
            firstAt: path.firstAt,
            lastAt: path.lastAt,
          })));
        } catch {
          detailMissed.add(address);
        }
      }));
    }

    let exposedCount = 0;
    let clear = 0;
    let unavailable = 0;
    let contracts = 0;
    for (const wallet of wallets) {
      const address = wallet.address.toLowerCase();
      const label = labels.rows.get(address);
      const entity = entityOf(label);
      const probe = control.get(address);
      const endpoints = labels.outcome === "answered" ? [ARKHAM_INTEL_BATCH] : [];

      if (label?.isContract === true || probe === "contract") {
        contracts += 1;
        wallet.screen = screen(
          wallet,
          "not_attributable",
          "This address has contract code, so ARGUS did not treat it as a wallet the subject controls or attribute exposure to the subject.",
          endpoints,
          { entity },
        );
        continue;
      }
      if (probe === "inconclusive") {
        unavailable += 1;
        wallet.screen = screen(
          wallet,
          "unavailable",
          "The public chain check could not confirm this was a wallet rather than a contract. Nothing was attributed; this is not a clean result.",
          endpoints,
          { entity },
        );
        continue;
      }

      const row = risk?.outcome === "answered" ? risk.rows.get(address) : undefined;
      if (!row) {
        unavailable += 1;
        wallet.screen = screen(
          wallet,
          "unavailable",
          risk?.outcome === "unentitled"
            ? "This Arkham subscription does not include exposure screening. This is a coverage gap, not a clean wallet."
            : risk?.outcome === "unavailable"
              ? "Arkham did not answer the exposure check. This is a coverage gap, not a clean wallet."
              : "Arkham returned no exposure result for this address. This is a coverage gap, not a clean wallet.",
          [...endpoints, ARKHAM_RISK_BATCH],
          { entity },
        );
        continue;
      }

      const riskEndpoints = [...endpoints, ARKHAM_RISK_BATCH];
      if (!exposed(row)) {
        clear += 1;
        wallet.screen = screen(
          wallet,
          "no_exposure_found",
          "Arkham screened this address and found no exposure to a flagged entity.",
          riskEndpoints,
          { entity },
        );
        continue;
      }

      exposedCount += 1;
      wallet.screen = screen(
        wallet,
        "screened",
        detailMissed.has(address)
          ? `Arkham scored this address ${row.level} (${row.score}/100), but the detailed path was unavailable.`
          : `Arkham scored this address ${row.level} (${row.score}/100).`,
        detailMissed.has(address) ? riskEndpoints : [...riskEndpoints, RISK_DETAIL],
        {
          entity,
          risk: {
            level: row.level,
            score: row.score,
            greatestCategory: row.greatestCategory,
            incomingUsd: row.incomingUsd,
            outgoingUsd: row.outgoingUsd,
            hopDistance: row.hopDistance,
            isSeed: row.isSeed,
            updatedAt: row.updatedAt,
            topSources: details.get(address) ?? [],
          },
        },
      );
      ctx.emit({
        phase: "On-chain",
        label: `${short(wallet.address)} exposure`,
        detail: `${row.level} (${row.score}/100)${row.greatestCategory ? ` · ${row.greatestCategory}` : ""}. Bound by ${wallet.binding.replace(/_/g, " ")}.`,
        source: "arkham",
        tone: "bad",
      });
    }

    const laneFailed = labels.outcome !== "answered" && (!risk || risk.outcome !== "answered");
    return {
      state: laneFailed ? "failed" : unavailable > 0 || contracts > 0 ? "partial" : "executed",
      attempts: wallets.length,
      detail: `${wallets.length} bound address${wallets.length === 1 ? "" : "es"} · ${exposedCount} exposed · ${clear} no exposure found · ${contracts} contract${contracts === 1 ? "" : "s"} · ${unavailable} unavailable`,
    };
  },
};
