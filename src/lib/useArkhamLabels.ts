import { useEffect, useState } from "react";
import { fetchPanelJson, panelRequestFailure, requiredPanelHeaders, type PanelRequestFailure } from "./panelCostHeaders";
import { providerAddressKey } from "./providerAddress";

// Fetch Arkham entity labels for a set of addresses. Returns a map keyed by
// canonical address → { name, type, twitter, … }. EVM keys are lowercase;
// Solana/base58 keys preserve their exact case. Reports call this with the
// wallets they already show (deployer, funder, top holders, cluster members) and
// upgrade "0x1a2b…" to who the wallet actually belongs to. Best-effort: empty
// until it resolves, and stays empty if Arkham isn't configured.
export type ArkhamRisk = { level: string; category?: string; score: number; incomingUsd?: number; isSeed: boolean };
export type ArkhamLabel = {
  name: string;
  type?: string;
  sublabel?: string;
  twitter?: string;
  website?: string;
  isCex: boolean;
  isContract: boolean;
  risk?: ArkhamRisk;
};

export type ArkhamLabelsState = "idle" | "loading" | "ready" | PanelRequestFailure;
export type ArkhamLabelsResult = { labels: Record<string, ArkhamLabel>; state: ArkhamLabelsState };

export function useArkhamLabels(addresses: (string | undefined | null)[], panelCostToken?: string): ArkhamLabelsResult {
  const clean = [...new Set(addresses.filter((a): a is string => !!a && a.length > 6).map(providerAddressKey))];
  // Preserve address case in the provider request: Solana base58 addresses are
  // case-sensitive even though EVM addresses are not.
  const key = clean.slice(0, 30).sort().join(",");
  const requestKey = `${panelCostToken ?? ""}\u0000${key}`;
  const [result, setResult] = useState<{ key: string; labels: Record<string, ArkhamLabel>; state: Exclude<ArkhamLabelsState, "idle" | "loading"> } | null>(null);

  useEffect(() => {
    if (!key || !panelCostToken) return;
    let live = true;
    fetchPanelJson<{ available?: boolean; labels?: Record<string, ArkhamLabel> }>(
      `/api/arkham?addresses=${encodeURIComponent(key)}`,
      { headers: requiredPanelHeaders(panelCostToken) },
    )
      .then((raw) => {
        if (!live) return;
        setResult({ key: requestKey, labels: raw.available && raw.labels ? raw.labels : {}, state: "ready" });
      })
      .catch((error: unknown) => {
        if (live) setResult({ key: requestKey, labels: {}, state: panelRequestFailure(error) });
      });
    return () => { live = false; };
  }, [key, panelCostToken, requestKey]);

  if (!key || !panelCostToken) return { labels: {}, state: "idle" };
  if (result?.key !== requestKey) return { labels: {}, state: "loading" };
  return { labels: result.labels, state: result.state };
}

// A short helper to read a label for an address from the map.
export const arkhamOf = (labels: Record<string, ArkhamLabel>, addr?: string | null): ArkhamLabel | undefined =>
  addr ? labels[providerAddressKey(addr)] : undefined;
