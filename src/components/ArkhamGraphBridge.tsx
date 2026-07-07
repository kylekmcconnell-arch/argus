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
    const HIGH = new Set(["MEDIUM", "HIGH", "SEVERE", "CRITICAL"]);
    const seen = new Set<string>();
    const ents: { key: string; type: string; subtype?: string; edgeType: string; label: string }[] = [];
    for (const [addr, l] of Object.entries(labels)) {
      const risky = !!l.risk;
      const meaningful = risky || l.type === "individual" || l.type === "fund";
      if (!meaningful) continue;
      const nameSlug = l.name ? l.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) : "";
      let key: string, label: string, subtype: string | undefined;
      if (risky) {
        // A flagged wallet keys on `risk:` so the graph treats a connection to it
        // as a hard/caution verdict override, not just a neutral bridge.
        const r = l.risk!;
        key = `risk:${nameSlug || addr.slice(0, 8)}`;
        subtype = r.isSeed || HIGH.has(r.level.toUpperCase()) || ["hacker", "sanctioned"].includes((r.category ?? "").toLowerCase()) ? "risk-avoid" : "risk-caution";
        label = `${l.name || "flagged wallet"} · ${r.isSeed ? `${r.category ?? "flagged"} source` : `${r.level.toLowerCase()} risk`}`;
      } else {
        if (!nameSlug) continue;
        key = `arkham:${nameSlug}`; label = l.name;
      }
      if (seen.has(key)) continue;
      seen.add(key);
      ents.push({ key, type: "Identity", ...(subtype ? { subtype } : {}), edgeType: risky ? "RISK_EXPOSURE" : "ARKHAM_ENTITY", label });
    }
    if (ents.length) recordForensicEntities(subject, ents);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject, sig]);
  return null;
}
