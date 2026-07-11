import { useState } from "react";

export interface SnapshotEvidenceControlProps {
  snapshotVersion: number;
  capturedAt: string;
  currentIntelligenceEnabled?: boolean;
  onLoadCurrentIntelligence?: () => void;
}

export function LiveSupplementalNotice({
  private: privateSession = false,
  persisted = false,
}: {
  private?: boolean;
  persisted?: boolean;
}) {
  return (
    <p
      role="status"
      className="rounded-lg border border-caution/30 bg-caution/5 px-3 py-2 text-[11.5px] leading-relaxed text-caution"
    >
      {privateSession
        ? "Private result · supplemental panels are paused to avoid shared cache traces · not saved to a case, graph, watchlist, or activity feed"
        : persisted
          ? "Live supplemental intelligence · fetched after the core scan · not included in the immutable Share payload or scored verdict"
          : "Live supplemental intelligence · outside the core scan · not included in a saved Share payload or scored verdict"}
    </p>
  );
}

function capturedTime(value: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function SnapshotEvidenceControl({
  snapshotVersion,
  capturedAt,
  currentIntelligenceEnabled,
  onLoadCurrentIntelligence,
}: SnapshotEvidenceControlProps) {
  const [localCurrentIntelligenceEnabled, setLocalCurrentIntelligenceEnabled] = useState(false);
  const enabled = currentIntelligenceEnabled ?? localCurrentIntelligenceEnabled;
  const loadCurrentIntelligence = () => {
    if (currentIntelligenceEnabled === undefined) setLocalCurrentIntelligenceEnabled(true);
    onLoadCurrentIntelligence?.();
  };

  return (
    <section
      aria-label={`Snapshot v${snapshotVersion} evidence mode`}
      className="rounded-xl border border-line bg-panel px-4 py-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="mono rounded border border-signal/30 bg-signal/5 px-2 py-0.5 text-[10px] font-semibold tracking-[0.12em] text-signal">
          SNAPSHOT v{snapshotVersion}
        </span>
        <time dateTime={capturedAt} className="mono text-[10.5px] text-ink-faint">
          captured {capturedTime(capturedAt)}
        </time>
      </div>

      {enabled ? (
        <p
          role="status"
          className="mt-2 rounded-lg border border-caution/30 bg-caution/5 px-3 py-2 text-[11.5px] leading-relaxed text-caution"
        >
          Current intelligence · fetched now · not part of snapshot v{snapshotVersion} · does not change stored verdict
        </p>
      ) : (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-2xl text-[11.5px] leading-relaxed text-ink-dim">
            Current intelligence panels are paused. They sit outside this snapshot and are not part of the stored verdict.
          </p>
          <button
            type="button"
            onClick={loadCurrentIntelligence}
            className="mono shrink-0 rounded-md border border-signal/50 px-2.5 py-1.5 text-[11px] text-signal transition hover:border-signal hover:text-signal-dim focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
          >
            Load current intelligence
          </button>
        </div>
      )}
    </section>
  );
}
