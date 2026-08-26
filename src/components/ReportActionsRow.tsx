/* The document's own actions, in the Auric File's quiet pill idiom: Share
   copies the 30-day read-only capability link (the recipient gets the whole
   interactive report with no workspace actions), Export PDF opens the print
   dialog. Sits at the top of the reading layer on every scan surface; in the
   share view only Export PDF remains. Hidden in print so the PDF stays a
   clean document. */

export type ShareState = "idle" | "creating" | "copied" | "error";
export type ReadingStyle = "full" | "brief";

const STYLE_OPTIONS: { value: ReadingStyle; label: string; title: string }[] = [
  { value: "full", label: "Full file", title: "The complete file: composition, chapters, and every evidence section in the reading flow" },
  { value: "brief", label: "Brief", title: "The decision brief only; the composition and chapters stay one click away" },
];

export function ReportActionsRow({ canShare, shareState, onShare, onExportPdf, readingStyle, onReadingStyle }: {
  canShare: boolean;
  shareState: ShareState;
  onShare: () => void;
  onExportPdf: () => void;
  /** When provided, the two style buttons render at the left of the row. */
  readingStyle?: ReadingStyle;
  onReadingStyle?: (style: ReadingStyle) => void;
}) {
  return (
    <div className={`af-doc mt-5 flex flex-wrap gap-2 print:hidden ${readingStyle && onReadingStyle ? "justify-between" : "justify-end"}`} aria-label="Report actions">
      {readingStyle && onReadingStyle && (
        <div className="flex gap-2" role="group" aria-label="Report style">
          {STYLE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => onReadingStyle(option.value)}
              aria-pressed={readingStyle === option.value}
              title={option.title}
              className="af-back cursor-pointer"
              style={{
                marginTop: 0,
                ...(readingStyle === option.value
                  ? { borderColor: "var(--color-signal)", color: "var(--color-ink)" }
                  : {}),
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap justify-end gap-2">
      {canShare && (
        <button
          type="button"
          onClick={onShare}
          disabled={shareState === "creating"}
          aria-live="polite"
          title={shareState === "error"
            ? "Share link could not be created or copied. Try again."
            : "Copy a read-only link to this exact report. It works for 30 days, needs no ARGUS account, and cannot change anything."}
          className="af-back cursor-pointer disabled:cursor-wait disabled:opacity-60"
          style={{ marginTop: 0 }}
        >
          {shareState === "creating" ? "Securing…" : shareState === "copied" ? "Link copied" : shareState === "error" ? "Retry share" : "Share ↗"}
        </button>
      )}
      <button
        type="button"
        onClick={onExportPdf}
        title="Save this report as a PDF (opens the print dialog)"
        className="af-back cursor-pointer"
        style={{ marginTop: 0 }}
      >
        Export PDF ↓
      </button>
      </div>
    </div>
  );
}
