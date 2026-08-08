import { useEffect } from "react";
import { recordForensicEntities } from "../graph/store";
import type { ArkhamLabel } from "../lib/useArkhamLabels";
import { providerAddressKey } from "../lib/providerAddress";

// Feeds Arkham-named wallets into the trust graph as bridge nodes, so two subjects
// that share a real-world entity connect. Renders nothing. Deliberately selective:
// only NAMED individuals / funds and RISKY wallets become context; exchanges, DEX
// routers, and generic protocols are skipped, because everyone touches Binance and
// bridging on those would fake-connect half the graph. A named entity bridges on
// the entity (across its many wallets); an anonymous risky wallet bridges on the
// wallet address itself. Arkham taxonomy is provider-attributed context, never
// an ARGUS verdict override.
export function arkhamGraphEntities(labels: Record<string, ArkhamLabel>) {
  const seen = new Set<string>();
  const entities: { key: string; type: string; subtype?: string; edgeType: string; label: string }[] = [];
  for (const [address, label] of Object.entries(labels)) {
    const risky = Boolean(label.risk);
    const meaningful = risky || label.type === "individual" || label.type === "fund";
    if (!meaningful) continue;
    // Risk is address-scoped in Arkham's response, while a neutral entity label
    // can intentionally join multiple wallets owned by the same entity.
    const identity = risky
      ? providerAddressKey(address)
      : label.entityId?.trim().toLowerCase() || providerAddressKey(address);
    if (!identity) continue;
    const key = `${risky ? "arkham-risk" : "arkham-entity"}:${identity}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entities.push({
      key,
      type: "Identity",
      ...(risky ? { subtype: "arkham-provider-risk" } : {}),
      edgeType: risky ? "ARKHAM_RISK_CONTEXT" : "ARKHAM_ENTITY",
      label: risky
        ? `Arkham reports ${label.name || "this wallet"} as ${label.risk?.category || `${label.risk?.level.toLowerCase()} risk`}`
        : label.name,
    });
  }
  return entities;
}

export function ArkhamGraphBridge({ subject, labels }: { subject: string; labels: Record<string, ArkhamLabel> }) {
  const sig = Object.keys(labels).sort().join(",");
  useEffect(() => {
    if (!subject) return;
    const ents = arkhamGraphEntities(labels);
    if (ents.length) recordForensicEntities(subject, ents);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject, sig]);
  return null;
}
