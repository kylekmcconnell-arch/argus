/* Stale-tab detection. Every page is lazy-loaded and the CDN keeps serving a
   deployment's old assets forever, so a tab opened before a deploy keeps
   working on the OLD build indefinitely: the chunk-failure reload in
   AppErrorBoundary never fires, and the reader tests "the new version" without
   having it (the Ammalgam feedback round: new copy, dialog and sections were
   all live in production while the open tab showed none of them).

   The heartbeat compares the index bundle this tab booted with against the
   one production currently serves, and reports staleness ONCE. It never
   reloads by itself: a reload kills the tab's live scan streams, so the app
   shows a notice with a reload button instead.

   Structural browser types, not DOM globals: this file is also compiled by
   the server and api tsconfigs, which intentionally omit the DOM lib. */

const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const INDEX_ASSET = /\/assets\/index-[A-Za-z0-9_-]+\.js/;

interface ScriptLike {
  getAttribute(name: string): string | null;
}

interface DocumentLike {
  querySelectorAll(selector: string): ArrayLike<ScriptLike>;
  visibilityState?: string;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

interface HeartbeatWindow {
  document: DocumentLike;
  fetch: (input: string, init?: { cache?: string; headers?: Record<string, string> }) => Promise<{ ok: boolean; text(): Promise<string> }>;
  setInterval(handler: () => void, timeout: number): number;
  clearInterval(id: number): void;
}

function browserWindow(): HeartbeatWindow | undefined {
  return (globalThis as { window?: HeartbeatWindow }).window;
}

/** The index bundle path a served HTML document references, or null. */
export function indexAssetFromHtml(html: string): string | null {
  return html.match(INDEX_ASSET)?.[0] ?? null;
}

/** The index bundle path THIS page booted with, read from its own script tags. */
export function currentIndexAsset(doc: DocumentLike): string | null {
  const scripts = doc.querySelectorAll("script[src]");
  for (let i = 0; i < scripts.length; i += 1) {
    const src = scripts[i]?.getAttribute("src") ?? "";
    const match = src.match(INDEX_ASSET);
    if (match) return match[0];
  }
  return null;
}

/**
 * Start the heartbeat. Checks on an interval and whenever the tab becomes
 * visible again (the common stale case is a tab left open overnight). Calls
 * `onStale` at most once, then stops checking. Returns a stop function.
 */
export function startVersionHeartbeat(
  onStale: () => void,
  options: { intervalMs?: number; fetcher?: HeartbeatWindow["fetch"]; win?: HeartbeatWindow } = {},
): () => void {
  const win = options.win ?? browserWindow();
  if (!win) return () => {};
  const fetcher = options.fetcher ?? win.fetch.bind(win);
  const booted = currentIndexAsset(win.document);
  if (!booted) return () => {};
  let stopped = false;
  let checking = false;

  const check = async () => {
    if (stopped || checking) return;
    checking = true;
    try {
      const response = await fetcher("/", { cache: "no-store", headers: { accept: "text/html" } });
      if (!response.ok) return;
      const live = indexAssetFromHtml(await response.text());
      if (live && live !== booted && !stopped) {
        stopped = true;
        cleanup();
        onStale();
      }
    } catch {
      // Offline or a blip: staleness detection is best-effort, never noisy.
    } finally {
      checking = false;
    }
  };

  const onVisible = () => {
    if (win.document.visibilityState === "visible") void check();
  };
  const timer = win.setInterval(() => void check(), options.intervalMs ?? CHECK_INTERVAL_MS);
  win.document.addEventListener("visibilitychange", onVisible);
  const cleanup = () => {
    win.clearInterval(timer);
    win.document.removeEventListener("visibilitychange", onVisible);
  };
  return () => {
    stopped = true;
    cleanup();
  };
}
