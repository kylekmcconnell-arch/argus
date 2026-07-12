import { scanStatFor } from "../lib/scanstats";

// A compact "N× + trend" scan-count chip for a subject, for the directory/report
// cards. Green ▲ when scan activity is accelerating, red ▼ when cooling. Renders
// nothing until the subject has at least one scan on record.
export function ScanChip({ kind, refId, className = "" }: { kind: string; refId: string; className?: string }) {
  const stat = scanStatFor(kind, refId);
  if (!stat || stat.count <= 0) return null;
  return (
    <span
      className={`chip shrink-0 gap-0.5 ${className}`}
      title={`Scanned ${stat.count} time${stat.count === 1 ? "" : "s"}${stat.rank <= 20 ? ` · #${stat.rank} trending` : ""}`}
    >
      {stat.trend === "up" && <span className="text-pass">▲</span>}
      {stat.trend === "down" && <span className="text-avoid">▼</span>}
      {stat.count}<span className="text-ink-faint">×</span>
    </span>
  );
}
