export function ReportDisclaimer({ className = "" }: { className?: string }) {
  return (
    <p className={`text-[11.5px] leading-relaxed text-ink-faint ${className}`}>
      ARGUS improves as its sources and scoring change. This report is research, not financial advice.
    </p>
  );
}
