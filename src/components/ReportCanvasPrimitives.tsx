import type { ReactNode } from "react";
import {
  ArrowRight,
  CaretRight,
  CheckCircle,
  ClockCounterClockwise,
  MagnifyingGlass,
  Warning,
} from "@phosphor-icons/react";
import { ExpandableText } from "./ExpandableText";

export type ReportCanvasTone = "pass" | "caution" | "signal" | "avoid" | "neutral";

const TONE_CLASS: Record<ReportCanvasTone, string> = {
  pass: "tint-pass",
  caution: "tint-caution",
  signal: "tint-signal",
  avoid: "tint-avoid",
  neutral: "tint-neutral",
};

const TONE_TEXT_CLASS: Record<ReportCanvasTone, string> = {
  pass: "text-pass",
  caution: "text-caution",
  signal: "text-signal-lift",
  avoid: "text-avoid",
  neutral: "text-ink-dim",
};

function ToneIcon({ tone, size = 19 }: { tone: ReportCanvasTone; size?: number }) {
  const className = `shrink-0 ${TONE_TEXT_CLASS[tone]}`;
  if (tone === "pass") return <CheckCircle aria-hidden="true" size={size} weight="bold" className={className} />;
  if (tone === "caution" || tone === "avoid") return <Warning aria-hidden="true" size={size} weight="bold" className={className} />;
  if (tone === "signal") return <MagnifyingGlass aria-hidden="true" size={size} weight="bold" className={className} />;
  return <ClockCounterClockwise aria-hidden="true" size={size} weight="bold" className={className} />;
}

export interface ReportCanvasNavItem {
  href: `#${string}`;
  label: string;
  icon?: ReactNode;
  count?: number;
}

export function ReportCanvasSectionNav({
  items,
  sticky = true,
  stickyOffsetClass = "top-[53px]",
  label = "Report sections",
}: {
  items: ReportCanvasNavItem[];
  sticky?: boolean;
  stickyOffsetClass?: string;
  label?: string;
}) {
  return (
    <nav
      aria-label={label}
      className={`${sticky ? `sticky ${stickyOffsetClass} z-10` : ""} -mx-5 border-y border-line-2 bg-panel/95 px-5 backdrop-blur`}
    >
      <div className="scrollbar-none mx-auto flex max-w-5xl gap-1 overflow-x-auto py-1.5">
        {items.map((item) => (
          <a
            key={item.href}
            href={item.href}
            className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-md px-3 text-[12.5px] font-medium text-ink-dim transition hover:bg-panel-2 hover:text-ink"
          >
            {item.icon}
            <span>{item.label}</span>
            {item.count != null && (
              <span className="mono text-[11px] text-ink-faint" aria-label={`${item.count} items`}>
                {item.count}
              </span>
            )}
          </a>
        ))}
      </div>
    </nav>
  );
}

export interface ReportCanvasNarrativeItem {
  id: string;
  title: string;
  detail?: string;
  provenance?: string;
  /** Compact top-right annotation (e.g. "Moderate · 4 src"). Use `provenance` when the caveat is content that must read inline. */
  meta?: string;
  href?: `#${string}`;
}

export function ReportCanvasNarrativeSection({
  id,
  title,
  description,
  tone,
  items,
  emptyCopy,
}: {
  id?: string;
  title: string;
  description?: string;
  tone: ReportCanvasTone;
  items: ReportCanvasNarrativeItem[];
  emptyCopy: string;
}) {
  return (
    <section id={id} className="scroll-mt-28 border-b border-line/60 py-5 last:border-b-0" aria-labelledby={id ? `${id}-title` : undefined}>
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${TONE_CLASS[tone]}`}>
          <ToneIcon tone={tone} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={id ? `${id}-title` : undefined} className="text-[18px] font-semibold tracking-tight text-ink">
            {title}
          </h2>
          {description && <p className="mt-1 text-[12.5px] leading-relaxed text-ink-faint">{description}</p>}
        </div>
      </div>

      {items.length ? (
        <ul className="mt-3 grid gap-1.5 pl-0 sm:pl-11 md:grid-cols-2" aria-label={title}>
          {items.map((item) => {
            const body = (
              <>
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 text-[12.5px] font-medium leading-snug text-ink">{item.title}</p>
                  {item.meta && (
                    <span className={`mono shrink-0 text-[10px] uppercase tracking-[0.08em] tabular-nums ${item.meta.startsWith("Limited") ? "text-caution" : "text-ink-faint"}`}>
                      {item.meta}
                    </span>
                  )}
                </div>
                {item.detail && (
                  <ExpandableText
                    text={item.detail}
                    collapsedLength={170}
                    className="mt-1 text-[11.5px] font-normal leading-snug text-ink-dim"
                  />
                )}
                {item.provenance && <p className="mt-1 text-[10.5px] text-ink-faint">{item.provenance}</p>}
              </>
            );
            return (
              <li key={item.id} className="panel-inset">
                {item.href ? (
                  <a href={item.href} className="group flex items-start gap-2 px-3 py-2 transition hover:bg-panel-2/50">
                    <div className="min-w-0 flex-1">{body}</div>
                    <CaretRight aria-hidden="true" size={13} weight="bold" className={`mt-1 shrink-0 transition group-hover:text-signal-lift ${TONE_TEXT_CLASS[tone]}`} />
                  </a>
                ) : (
                  <div className="px-3 py-2">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="ml-11 mt-3 panel-inset px-3 py-2.5 text-[12.5px] leading-relaxed text-ink-faint">{emptyCopy}</p>
      )}
    </section>
  );
}

export interface ReportCanvasRailItem {
  id: string;
  label: string;
  meta?: string;
  href?: `#${string}`;
}

export function ReportCanvasRailCard({
  title,
  tone,
  count,
  items,
  footer,
  emptyCopy = "Nothing needs attention here.",
}: {
  title: string;
  tone: ReportCanvasTone;
  count?: string;
  items: ReportCanvasRailItem[];
  footer?: ReactNode;
  emptyCopy?: string;
}) {
  return (
    <section className="panel overflow-hidden" aria-label={title}>
      <div className="flex items-center gap-2 border-b border-line/60 px-3.5 py-3">
        <ToneIcon tone={tone} size={16} />
        <h2 className="text-[12.5px] font-semibold text-ink-dim">{title}</h2>
        {count && <span className="ml-auto text-[11.5px] text-ink-faint">{count}</span>}
      </div>
      {items.length ? (
        <ul className="divide-y divide-line/60">
          {items.map((item) => (
            <li key={item.id} className="px-3.5 py-2.5">
              {item.href ? (
                <a href={item.href} className="group flex min-h-8 items-start gap-2 text-[12.5px] leading-snug text-ink-dim hover:text-ink">
                  <span className="min-w-0 flex-1">{item.label}</span>
                  <ArrowRight aria-hidden="true" size={13} weight="bold" className="mt-0.5 shrink-0 text-ink-faint transition group-hover:text-signal-lift" />
                </a>
              ) : (
                <p className="text-[12.5px] leading-snug text-ink-dim">{item.label}</p>
              )}
              {item.meta && <p className="mt-1 text-[11.5px] leading-snug text-ink-faint">{item.meta}</p>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-3.5 py-3 text-[12.5px] leading-relaxed text-ink-faint">{emptyCopy}</p>
      )}
      {footer && <div className="border-t border-line/60 px-3.5 py-2.5 text-[11px] text-ink-faint">{footer}</div>}
    </section>
  );
}
