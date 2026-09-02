// @vitest-environment jsdom

// The at-a-glance panel: what this is, whether it is live, official versus
// merely linked accounts, named people WITH roles, and a next-step button that
// exists only when the page itself binds a handle or contract.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { analyzeContent, type Recon } from "../collect/recon";
import { scoreProject } from "../collect/projectverdict";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("./ScoreTicker", () => ({ ScoreTicker: () => null }));
vi.mock("./ProjectResearch", () => ({ ProjectResearch: () => null }));
vi.mock("./ProjectXAccount", () => ({ ProjectXAccount: () => null }));
vi.mock("./SiteInfra", () => ({ SiteInfra: () => null }));
vi.mock("./SiteHistory", () => ({ SiteHistory: () => null }));
vi.mock("./AddInfo", () => ({ AddInfo: () => null }));
vi.mock("./LinkEntity", () => ({ LinkEntity: () => null }));

import { ReconPage } from "./ReconPage";

function scored(recon: Recon): Recon {
  return { ...recon, verdict: scoreProject(recon) };
}

const FUND = scored(analyzeContent({
  url: "https://10xcapital.com/",
  status: "recovered",
  title: "10X Capital",
  content: "## 10X Capital is a next-generation merchant bank, where Wall Street meets Silicon Valley.\n\n## Core Team\n\n#### Hans Thomas\n\nFounder & CEO\n\n#### Alex Monje\n\nPartner, Chief Legal Officer\n\nMBA @UNC. Fmr. CEO @Kraken EMEA.\n",
  stages: [{ method: "direct fetch", outcome: "blocked", chars: 0, note: "" }, { method: "rendering crawler", outcome: "ok", chars: 300, note: "" }],
  coverageNote: "recovered",
}));

const TOKEN = scored(analyzeContent({
  url: "https://nebula.xyz/",
  status: "rendered",
  title: "Nebula Protocol",
  content: "Nebula Protocol is a decentralized perpetuals exchange on Solana.\n$NEB Tokenomics. Total supply 1,000,000,000. Airdrop live.\nTeam\nPriya Raman\nCo-Founder & CEO\nFollow us on https://x.com/nebulaprotocol\nPartner: https://x.com/jumptrading",
  stages: [{ method: "direct fetch", outcome: "ok", chars: 300, note: "" }],
  coverageNote: "direct",
}));

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

describe("site recon at a glance", () => {
  it("tells the analyst what a fund page is, who is named with roles, and offers no unbound next step", () => {
    const onAudit = vi.fn();
    act(() => { root.render(<ReconPage initialRecon={FUND} onAudit={onAudit} />); });
    const text = container.textContent ?? "";

    expect(text).toContain("FUND / FIRM");
    expect(text).toContain("LIVE · CRAWLER READ");
    expect(text).toContain("10X Capital says it is a fund / investment firm");
    expect(text).toContain("Hans Thomas");
    expect(text).toContain("Founder & CEO");
    expect(text).toContain("Alex Monje");
    expect(text).toContain("Partner, Chief Legal Officer");
    expect(text).toContain("The page links no X, Telegram, Discord, GitHub, or LinkedIn account of its own.");
    expect(text).not.toContain("@UNC");
    expect(text).not.toContain("@Kraken");
    expect(text).toContain("No official X account is linked on the page");
    expect(container.querySelector("button[type=button].tint-signal")).toBeNull();
    expect(text).not.toMatch(/Run full ARGUS on/);
  });

  it("offers the bound next step for a token site with an official X account, and routes it through onAudit", () => {
    const onAudit = vi.fn();
    act(() => { root.render(<ReconPage initialRecon={TOKEN} onAudit={onAudit} />); });
    const text = container.textContent ?? "";

    expect(text).toContain("TOKEN PROJECT");
    expect(text).toContain("Priya Raman");
    expect(text).toContain("Co-Founder & CEO");
    expect(text).toContain("@nebulaprotocol");
    expect(text).toContain("Also linked, not claimed as its own");
    expect(text).toContain("@jumptrading");

    const button = [...container.querySelectorAll("button")].find((b) => /Run full ARGUS on @nebulaprotocol/.test(b.textContent ?? ""));
    expect(button).toBeDefined();
    act(() => { button!.click(); });
    expect(onAudit).toHaveBeenCalledWith("@nebulaprotocol", false);
    expect(onAudit).not.toHaveBeenCalledWith("@jumptrading", expect.anything());
  });
});
