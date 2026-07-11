import { useEffect, useState } from "react";

// Fetch Arkham entity labels for a set of addresses. Returns a map keyed by
// lowercased address → { name, type, twitter, … }. Reports call this with the
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

export function useArkhamLabels(addresses: (string | undefined | null)[]): Record<string, ArkhamLabel> {
  const [labels, setLabels] = useState<Record<string, ArkhamLabel>>({});
  const clean = [...new Set(addresses.filter((a): a is string => !!a && a.length > 6).map((a) => a.trim()))];
  const key = clean.map((a) => a.toLowerCase()).sort().join(",");

  useEffect(() => {
    if (!clean.length) return;
    let live = true;
    fetch(`/api/arkham?addresses=${encodeURIComponent(clean.slice(0, 30).join(","))}`)
      .then((r) => r.json())
      .then((raw) => {
        const d = raw as { available?: boolean; labels?: Record<string, ArkhamLabel> };
        if (live && d.available && d.labels) setLabels(d.labels);
      })
      .catch(() => { /* best-effort */ });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return labels;
}

// A short helper to read a label for an address from the map.
export const arkhamOf = (labels: Record<string, ArkhamLabel>, addr?: string | null): ArkhamLabel | undefined =>
  addr ? labels[addr.toLowerCase()] : undefined;
