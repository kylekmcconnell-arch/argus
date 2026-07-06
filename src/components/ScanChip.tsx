import { scanStatFor } from "../lib/scanstats";

// A compact "N× + trend" scan-count chip for a subject, for the directory/report
// cards. Green ▲ when scan activity is accelerating, red ▼ when cooling. Renders
// nothing until the subject has at least one scan on record.
export function ScanChip({ kind, refId, className = "" }: { kind: string; refId: string; className?: string }) {
  const stat = scanStatFor(kind, refId);
  if (!stat || stat.count <= 0) return null;
  return (
    <span
      className={`mono inline-flex shrink-0 items-center gap-0.5 rounded-md border border-line/70 px-1.5 py-[1px] text-[10px] text-ink-dim ${className}`}
      title={`Scanned ${stat.count} time${stat.count === 1 ? "" : "s"}${stat.rank <= 20 ? ` · #${stat.rank} trending` : ""}`}
    >
      {stat.trend === "up" && <span style={{ color: "var(--color-pass)" }}>▲</span>}
      {stat.trend === "down" && <span style={{ color: "var(--color-avoid)" }}>▼</span>}
      {stat.count}<span className="text-ink-faint">×</span>
    </span>
  );
}
