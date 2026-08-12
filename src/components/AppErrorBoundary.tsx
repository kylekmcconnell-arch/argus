import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Every page in ARGUS is lazy-loaded, so a tab that was open across a deploy
 * asks the CDN for chunk files the new build replaced. The import rejects,
 * React throws during render, and with nothing catching it the whole app
 * unmounts to a blank page. That is the white page.
 *
 * A stale chunk is not a bug in the report: the tab is simply running an
 * older ARGUS than the server. Reload once and it resolves itself. Anything
 * else is a real failure and must say what broke instead of disappearing.
 */
const STALE_CHUNK_PATTERNS = [
  /failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /importing a module script failed/i,
  /unable to preload css/i,
  /chunkloaderror/i,
  /loading chunk \d+ failed/i,
  /dynamically imported module.*(404|not found)/i,
];

const RELOAD_MARKER = "argus:stale-chunk-reload";
const RELOAD_COOLDOWN_MS = 30_000;

export function isStaleChunkError(error: unknown): boolean {
  const text = error instanceof Error
    ? `${error.name} ${error.message}`
    : typeof error === "string" ? error : "";
  return STALE_CHUNK_PATTERNS.some((pattern) => pattern.test(text));
}

/** One automatic recovery per tab per cooldown, so a persistent failure can never loop. */
function mayAutoReload(now: number, storage: Storage | undefined): boolean {
  if (!storage) return false;
  try {
    const previous = Number(storage.getItem(RELOAD_MARKER) ?? "");
    if (Number.isFinite(previous) && now - previous < RELOAD_COOLDOWN_MS) return false;
    storage.setItem(RELOAD_MARKER, String(now));
    return true;
  } catch {
    return false;
  }
}

interface ErrorBoundaryState {
  error: Error | null;
  componentStack: string;
  reloading: boolean;
}

export class AppErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, componentStack: "", reloading: false };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error, reloading: isStaleChunkError(error) };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep the raw record in the console for a developer reading the tab.
    console.error("[argus] render failed", error, info.componentStack);
    this.setState({ componentStack: info.componentStack ?? "" });
    if (isStaleChunkError(error)) {
      const storage = typeof window === "undefined" ? undefined : window.sessionStorage;
      if (mayAutoReload(Date.now(), storage)) {
        window.location.reload();
        return;
      }
      this.setState({ reloading: false });
    }
  }

  private details(): string {
    const { error, componentStack } = this.state;
    return [
      `ARGUS error: ${error?.name ?? "Error"}: ${error?.message ?? "unknown"}`,
      `page: ${typeof window === "undefined" ? "" : window.location.href}`,
      error?.stack ? `stack:\n${error.stack}` : "",
      componentStack ? `components:${componentStack}` : "",
    ].filter(Boolean).join("\n\n");
  }

  render() {
    const { error, reloading } = this.state;
    if (!error) return this.props.children;

    if (reloading) {
      return (
        <div className="flex min-h-screen items-center justify-center px-6">
          <p role="status" className="text-[13px] text-ink-dim">
            ARGUS updated while this tab was open. Reloading the new version...
          </p>
        </div>
      );
    }

    const staleChunk = isStaleChunkError(error);
    return (
      <div className="flex min-h-screen items-center justify-center px-6 py-10">
        <section className="panel w-full max-w-xl px-5 py-5" role="alert">
          <p className="eyebrow text-signal-lift">{staleChunk ? "New version available" : "This page did not load"}</p>
          <h1 className="mt-1 text-[17px] font-semibold tracking-tight text-ink">
            {staleChunk
              ? "This tab is running an older ARGUS than the server."
              : "Something in this view failed to render."}
          </h1>
          <p className="mt-2 text-[12.5px] leading-relaxed text-ink-dim">
            {staleChunk
              ? "Reload to pick up the current version. Your saved reports and cases are unaffected."
              : "No saved report was changed. Reload to continue, and send the details below so the cause can be fixed."}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => window.location.reload()} className="btn-primary">
              Reload ARGUS
            </button>
            <button
              type="button"
              onClick={() => { void navigator.clipboard?.writeText(this.details()); }}
              className="btn-chip tint-signal"
            >
              Copy error details
            </button>
          </div>
          {!staleChunk && (
            <details className="mt-4 text-[11px] text-ink-faint">
              <summary className="cursor-pointer select-none">Technical details</summary>
              <pre className="mono mt-2 max-h-56 overflow-auto whitespace-pre-wrap leading-relaxed">
                {this.details()}
              </pre>
            </details>
          )}
        </section>
      </div>
    );
  }
}
