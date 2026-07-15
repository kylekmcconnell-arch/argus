// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Dossier } from "../data/dossier";
import { buildReport, SUBJECTS } from "../data/subjects";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../auth-context", () => ({ useArgusAuth: () => ({ role: "owner" }) }));
vi.mock("../graph/store", () => ({ getContributions: () => [] }));
vi.mock("../graph/network", () => ({ subjectConnections: () => [] }));
vi.mock("./RingAlert", () => ({ RingAlert: () => null }));
vi.mock("./SanctionsNameScreen", () => ({ SanctionsNameScreen: () => null }));
vi.mock("./LegalScreen", () => ({ LegalScreen: () => null }));
vi.mock("./PfpCheck", () => ({ PfpCheck: () => null }));
vi.mock("./PersonGithub", () => ({ PersonGithub: () => null }));
vi.mock("./VcReport", () => ({ VcReport: () => null }));
vi.mock("./KolReport", () => ({ KolReport: () => null }));
vi.mock("./ProjectIntel", () => ({ ProjectIntel: () => null }));
vi.mock("./NewsSection", () => ({ NewsSection: () => null }));
vi.mock("./IdentitySweep", () => ({ IdentitySweep: () => null }));
vi.mock("./AddInfo", () => ({ AddInfo: () => null }));
vi.mock("./LinkEntity", () => ({ LinkEntity: () => null }));
vi.mock("./ServiceAlert", () => ({ ServiceAlert: () => null }));
vi.mock("./TrustGraph", () => ({ TrustGraph: () => null }));
vi.mock("./AskReport", () => ({ AskReport: () => null }));
vi.mock("./Avatar", () => ({ Avatar: () => null }));
vi.mock("./ArgusMark", () => ({ ArgusMark: () => null }));

import { Report } from "./Report";

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
});

function renderWithCost(cost: Dossier["cost"]): void {
  const dossier: Dossier = { ...buildReport(SUBJECTS[1]), cost };
  act(() => {
    root.render(<Report dossier={dossier} onReset={() => {}} onAudit={() => {}} />);
  });
}

describe("run cost line in the methodology footer", () => {
  it("states the run cost, provider count, and Claude share from the frozen ledger", () => {
    renderWithCost({
      usd: 0.69,
      grokUsd: 0.01,
      claudeUsd: 0.65,
      grokCalls: 5,
      claudeCalls: 10,
      sources: 0,
      estimated: true,
      calls: [
        { provider: "claude", op: "analysis", calls: 10, usd: 0.65 },
        { provider: "grok", op: "search", calls: 5, usd: 0.01 },
        { provider: "twitterapi", op: "followers", calls: 113, usd: 0.03 },
        // the ledger records free calls too; they must not inflate the count
        { provider: "cache", op: "hit", calls: 40, usd: 0 },
        { provider: "defillama", op: "tvl", calls: 2, usd: 0 },
        { provider: "site-fetch", op: "page", calls: 49, usd: 0 },
      ],
    });

    expect(container.textContent).toContain("This investigation cost about $0.69 across 3 providers.");
    expect(container.textContent).toContain("Claude research and analysis was $0.65 of it.");
  });

  it("drops the provider scope and Claude share when only one provider was actually paid", () => {
    renderWithCost({
      usd: 0.65,
      grokUsd: 0,
      claudeUsd: 0.65,
      grokCalls: 0,
      claudeCalls: 10,
      sources: 0,
      estimated: true,
      calls: [
        { provider: "claude", op: "analysis", calls: 10, usd: 0.65 },
        { provider: "cache", op: "hit", calls: 12, usd: 0 },
        { provider: "github", op: "profile", calls: 3, usd: 0 },
      ],
    });

    expect(container.textContent).toContain("This investigation cost about $0.65.");
    expect(container.textContent).not.toContain("of it.");
    expect(container.textContent).not.toContain("across");
  });

  it("renders nothing for keyless or pre-ledger reports", () => {
    renderWithCost({ usd: 0, grokUsd: 0, claudeUsd: 0, grokCalls: 0, claudeCalls: 0, sources: 0, estimated: true });
    expect(container.textContent).not.toContain("investigation cost");

    renderWithCost(undefined);
    expect(container.textContent).not.toContain("investigation cost");
  });
});
