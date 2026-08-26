import { useEffect, useMemo, useState, type ReactNode } from "react";
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
  activeHref,
}: {
  items: ReportCanvasNavItem[];
  sticky?: boolean;
  stickyOffsetClass?: string;
  label?: string;
  activeHref?: `#${string}`;
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
            aria-current={activeHref === item.href ? "location" : undefined}
            className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-md px-3 text-[12.5px] font-medium transition hover:bg-panel-2 hover:text-ink ${activeHref === item.href ? "bg-panel-2 text-ink" : "text-ink-dim"}`}
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

function useActiveReportSection(items: ReportCanvasNavItem[], enabled = true): `#${string}` {
  const itemKey = useMemo(() => items.map((item) => item.href).join("|"), [items]);
  const initialHref = items[0]?.href ?? "#report-summary";
  const [activeHref, setActiveHref] = useState<`#${string}`>(initialHref);

  useEffect(() => {
    if (!enabled) return;
    if (typeof IntersectionObserver !== "function") return;
    const currentItems = itemKey.split("|").filter(Boolean) as `#${string}`[];
    const targets = currentItems
      .map((href) => ({ href, element: document.getElementById(href.slice(1)) }))
      .filter((entry): entry is { href: `#${string}`; element: HTMLElement } => Boolean(entry.element));
    if (!targets.length) return;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      const match = visible && targets.find((target) => target.element === visible.target);
      if (match) setActiveHref(match.href);
    }, { rootMargin: "-18% 0px -68% 0px", threshold: [0, 0.01] });
    targets.forEach((target) => observer.observe(target.element));
    return () => observer.disconnect();
  }, [enabled, itemKey]);

  return activeHref;
}

/** Sticky, scroll-aware contents bar used immediately before the report story. */
export function ReportStickyTableOfContents({
  items,
  stickyOffsetClass = "top-[65px]",
  label = "Report table of contents",
}: {
  items: ReportCanvasNavItem[];
  stickyOffsetClass?: string;
  label?: string;
}) {
  const activeHref = useActiveReportSection(items);
  return (
    <div data-report-sticky-toc="true" className={`sticky ${stickyOffsetClass} z-20 mt-5`}>
      <ReportCanvasSectionNav items={items} sticky={false} label={label} activeHref={activeHref} />
    </div>
  );
}

export interface ReportExperienceStatus {
  label: string;
  detail: string;
  meta?: string;
  tone: ReportCanvasTone;
}

/**
 * One orientation model for every ARGUS report. The rail is deliberately a
 * guide, not a second report: it may point to evidence, but never repeats it.
 */
export function ReportExperienceLayout({
  items,
  status,
  nextStep,
  nextStepHref = "#verification-next",
  children,
  label = "Report guide",
  mobileOffsetClass = "top-[65px]",
  showGuideNavigation = true,
}: {
  items: ReportCanvasNavItem[];
  status?: ReportExperienceStatus;
  nextStep?: string | null;
  nextStepHref?: `#${string}`;
  children: ReactNode;
  label?: string;
  mobileOffsetClass?: string;
  showGuideNavigation?: boolean;
}) {
  const activeHref = useActiveReportSection(items, showGuideNavigation);
  const showDesktopRail = showGuideNavigation || Boolean(status) || Boolean(nextStep);

  return (
    <div data-report-experience-shell="true" className="mt-5">
      {showGuideNavigation && (
        <div className={`sticky ${mobileOffsetClass} z-20 xl:hidden`}>
          <ReportCanvasSectionNav items={items} sticky={false} label={label} activeHref={activeHref} />
        </div>
      )}
      <div className={`grid min-w-0 gap-6 ${showDesktopRail ? "xl:grid-cols-[minmax(0,1fr)_248px]" : "grid-cols-1"}`}>
        <div className="min-w-0">{children}</div>
        {showDesktopRail && <aside className="report-experience-rail hidden xl:block" aria-label={label}>
          <div className="sticky top-[76px] space-y-3">
            {showGuideNavigation && <section className="panel overflow-hidden">
              <div className="border-b border-line/60 px-4 py-3">
                <p className="eyebrow">Report guide</p>
                <p className="mt-1 text-[12.5px] leading-snug text-ink-dim">Follow the investigation from the decision to its evidence.</p>
              </div>
              <nav aria-label={label}>
                <ol className="divide-y divide-line/60">
                  {items.map((item, index) => (
                    <li key={item.href}>
                      <a
                        href={item.href}
                        aria-current={activeHref === item.href ? "location" : undefined}
                        className={`group flex min-h-11 items-center gap-2.5 border-l-2 px-3 py-2 text-[12.5px] font-medium transition ${activeHref === item.href ? "border-signal bg-panel-2 text-ink" : "border-transparent text-ink-dim hover:bg-panel-2 hover:text-ink"}`}
                      >
                        <span className="mono w-4 shrink-0 text-[10px] text-ink-faint">{String(index + 1).padStart(2, "0")}</span>
                        {item.icon}
                        <span className="min-w-0 flex-1">{item.label}</span>
                        {item.count != null && <span className="mono text-[10px] text-ink-faint">{item.count}</span>}
                      </a>
                    </li>
                  ))}
                </ol>
              </nav>
            </section>}

            {status && <section className={`panel overflow-hidden ${TONE_CLASS[status.tone]}`} aria-label="Report status">
              <div className="flex items-start gap-2.5 px-4 py-3.5">
                <ToneIcon tone={status.tone} size={17} />
                <div className="min-w-0">
                  <p className="mono text-[11px] font-semibold uppercase tracking-[0.08em]">{status.label}</p>
                  <p className="mt-1 text-[12.5px] leading-snug text-ink-dim">{status.detail}</p>
                  {status.meta && <p className="mono mt-2 text-[10px] uppercase tracking-[0.08em] text-ink-faint">{status.meta}</p>}
                </div>
              </div>
            </section>}

            {nextStep && (
              <a href={nextStepHref} className="panel block px-4 py-3.5 transition hover:border-control-line">
                <p className="eyebrow text-signal-lift">Check next</p>
                <p className="mt-1.5 text-[12.5px] font-medium leading-snug text-ink">{nextStep}</p>
              </a>
            )}
          </div>
        </aside>}
      </div>
    </div>
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
          <h2 id={id ? `${id}-title` : undefined} className="display-sm text-[18px] leading-tight text-ink">
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
                {item.meta && (
                  <p className={`mono mb-1.5 text-[10px] uppercase tracking-[0.08em] tabular-nums ${item.meta.startsWith("Limited") ? "text-caution" : "text-ink-faint"}`}>
                    {item.meta}
                  </p>
                )}
                <p className="text-[12.5px] font-medium leading-snug text-ink">{item.title}</p>
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
