import { useEffect } from "react";
import { recordForensicEntities } from "../graph/store";
import type { ArkhamLabel } from "../lib/useArkhamLabels";

// Feeds Arkham-named wallets into the trust graph as bridge nodes, so two subjects
// that share a real-world entity connect. Renders nothing. Deliberately selective:
// only NAMED individuals / funds and RISKY wallets become bridges — exchanges, DEX
// routers, and generic protocols are skipped, because everyone touches Binance and
// bridging on those would fake-connect half the graph. A named entity bridges on
// the entity (across its many wallets); an anonymous risky wallet bridges on the
// wallet address itself (already the graph's key for that wallet).
export function ArkhamGraphBridge({ subject, labels }: { subject: string; labels: Record<string, ArkhamLabel> }) {
  const sig = Object.keys(labels).sort().join(",");
  useEffect(() => {
    if (!subject) return;
    const seen = new Set<string>();
    const ents: { key: string; type: string; edgeType: string; label: string }[] = [];
    for (const [addr, l] of Object.entries(labels)) {
      const meaningful = !!l.risk || l.type === "individual" || l.type === "fund";
      if (!meaningful) continue;
      let key: string, base: string;
      if (l.name) {
        const slug = l.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
        if (!slug) continue;
        key = `arkham:${slug}`; base = l.name;
      } else {
        key = `wallet:${addr.slice(0, 8)}`; base = "flagged wallet"; // anon risky → the wallet is the bridge key
      }
      if (seen.has(key)) continue;
      seen.add(key);
      const risk = l.risk;
      ents.push({
        key,
        type: "Identity",
        edgeType: risk ? "RISK_EXPOSURE" : "ARKHAM_ENTITY",
        label: base + (risk ? ` · ${risk.isSeed ? `${risk.category ?? "flagged"} source` : `${risk.level.toLowerCase()} risk`}` : ""),
      });
    }
    if (ents.length) recordForensicEntities(subject, ents);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject, sig]);
  return null;
}
