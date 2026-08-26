// The two report styles Enigma and Kyle switch between and share by link:
// Style 1 is the Auric File (composition strip, dimension chapters, evidence
// in the reading flow - the default); Style 2 is the dossier story
// experience (DossierReport). The URL carries ?reportStyle=1|2 so a shared
// link opens in the sender's style; the choice also persists per browser.
//
// Structural browser types, not DOM globals: this file is also compiled by
// the server and api tsconfigs, which intentionally omit the DOM lib.

export type ReportStyle = "style1" | "style2";

export const REPORT_STYLE_PARAM = "reportStyle";
const STORAGE_KEY = "argus-report-style";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface StyleWindow {
  location?: { search?: string; href?: string };
  history?: { replaceState(data: unknown, unused: string, url: string): void };
  localStorage?: StorageLike;
}

const win = (): StyleWindow => globalThis as StyleWindow;

/** URL param wins (a shared link opens in the sender's style), then the
    browser's remembered choice, then Style 1. */
export function initialReportStyle(): ReportStyle {
  try {
    const search = win().location?.search ?? "";
    const value = new URLSearchParams(search).get(REPORT_STYLE_PARAM);
    if (value === "2") return "style2";
    if (value === "1") return "style1";
  } catch { /* fall through to the remembered choice */ }
  try {
    if (win().localStorage?.getItem(STORAGE_KEY) === "style2") return "style2";
  } catch { /* default below */ }
  return "style1";
}

/** Remember the choice and reflect it in the URL so the link is shareable. */
export function persistReportStyle(style: ReportStyle): void {
  try { win().localStorage?.setItem(STORAGE_KEY, style); } catch { /* still applies this view */ }
  try {
    const w = win();
    const href = w.location?.href;
    if (!href || !w.history) return;
    const url = new URL(href);
    url.searchParams.set(REPORT_STYLE_PARAM, style === "style2" ? "2" : "1");
    w.history.replaceState(null, "", url.toString());
  } catch { /* URL stays as it was */ }
}
