// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildReport, SUBJECTS } from "../data/subjects";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Deliberately NO mock of ../auth-context. The public share route mounts the
// full report by share capability, outside AuthGate, with no account at all.
// Every shared person link crashed there with "useArgusAuth must be used
// inside AuthGate" (ARGUS-20); this renders that exact path for real.
const harness = vi.hoisted(() => ({ livePanel: vi.fn(), askReport: vi.fn(), trustGraph: vi.fn(), marketIntelligence: vi.fn() }));
vi.mock("../graph/store", () => ({ getContributions: () => [] }));
// The promoted production lane renders the connection workspace, which needs
// the real entity-key canonicalizer; only the connection lookup is stubbed.
vi.mock("../graph/network", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../graph/network")>()),
  subjectConnections: () => [],
}));
vi.mock("./RingAlert", () => ({ RingAlert: (props: Record<string, unknown>) => { harness.livePanel("ring-alert", props); return null; } }));
vi.mock("./SanctionsNameScreen", () => ({ SanctionsNameScreen: () => { harness.livePanel("sanctions"); return null; } }));
vi.mock("./LegalScreen", () => ({ LegalScreen: () => { harness.livePanel("legal"); return null; } }));
vi.mock("./PfpCheck", () => ({ PfpCheck: () => { harness.livePanel("pfp"); return null; }, PfpAvatar: () => null }));
vi.mock("./PersonGithub", () => ({ PersonGithub: (props: Record<string, unknown>) => { harness.livePanel("person-github", props); return null; } }));
vi.mock("./VcReport", () => ({ VcReport: () => { harness.livePanel("vc"); return null; } }));
vi.mock("./KolReport", () => ({ KolReport: () => { harness.livePanel("kol"); return null; } }));
vi.mock("./ProjectIntel", () => ({ ProjectIntel: (props: Record<string, unknown>) => { harness.livePanel("project-intel", props); return null; } }));
vi.mock("./NewsSection", () => ({ NewsSection: () => { harness.livePanel("news"); return null; } }));
vi.mock("./IdentitySweep", () => ({ IdentitySweep: (props: Record<string, unknown>) => { harness.livePanel("identity-sweep", props); return null; } }));
vi.mock("./AddInfo", () => ({ AddInfo: () => { harness.livePanel("add-info"); return null; } }));
vi.mock("./LinkEntity", () => ({ LinkEntity: () => { harness.livePanel("link-entity"); return null; } }));
vi.mock("./ServiceAlert", () => ({ ServiceAlert: () => <div>service-ready</div> }));
vi.mock("./TrustGraph", () => ({ TrustGraph: (props: Record<string, unknown>) => { harness.trustGraph(props); return null; } }));
vi.mock("./ArgusEyeAssistant", () => ({ ArgusEyeAssistant: (props: Record<string, unknown>) => { harness.askReport(props); return null; } }));
vi.mock("./Avatar", () => ({
  Avatar: ({ src }: { src: string | null }) => src ? <img src={src} alt="" /> : null,
}));
vi.mock("./ArgusMark", () => ({ ArgusMark: () => null }));
vi.mock("./ThreatScanPage", () => ({
  ThreatReport: () => <div data-testid="late-threat-report">late threat report</div>,
  ProjectMarketIntelligence: (props: Record<string, unknown>) => {
    harness.marketIntelligence(props);
    return <div data-testid="market-intelligence">market intelligence</div>;
  },
}));

import { SharedReportView } from "./SharedReportView";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("SharedReportView (public share route, no AuthGate)", () => {
  it("renders a shared person report without requiring a session", async () => {
    const dossier = buildReport(SUBJECTS[1]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ report: { kind: "person", payload: dossier, ts: "2026-09-03T05:08:00.000Z" }, expiresAt: null }),
      { status: 200, headers: { "content-type": "application/json" } },
    )));

    await act(async () => { root.render(<SharedReportView token="share-token" />); });
    await act(async () => { await Promise.resolve(); });

    const text = container.textContent ?? "";
    expect(text).not.toContain("must be used inside AuthGate");
    expect(text).toContain("Shared report");
    expect(text).toContain(dossier.handle.replace(/^@/, ""));
  });

  it("explains an expired or unknown share link instead of crashing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ report: null, message: "Gone." }), { status: 404 })));
    await act(async () => { root.render(<SharedReportView token="stale" />); });
    await act(async () => { await Promise.resolve(); });
    expect(container.textContent).toContain("Gone.");
  });
});
