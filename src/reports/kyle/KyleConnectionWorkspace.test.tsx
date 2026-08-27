// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Dossier } from "../../data/dossier";
import { KyleConnectionWorkspace } from "./KyleConnectionWorkspace";

const dossier = {
  handle: "@anyonefdn",
  display_name: "ANyONe Protocol",
  resolved_name: "ANyONe Protocol",
  avatar: "A",
  avatar_url: "https://pbs.twimg.com/profile_images/1/anyone.jpg",
  followers: "142K",
  report: { roles: ["PROJECT"] },
  graph: { nodes: [], edges: [] },
  webTeam: [{
    name: "Sergey Ilin",
    handle: "@sergeyilin",
    role: "Operations Lead",
    source: "https://www.anyone.io/team",
    sourceUrl: "https://www.anyone.io/team",
    artifact_verified: true,
  }, {
    name: "Anon Morpho",
    role: "Strategic and Marketing Lead",
    source: "https://www.anyone.io/team",
    sourceUrl: "https://www.anyone.io/team",
    officialPortraitUrl: "https://images.anyone.io/team/anon-morpho.png",
    officialPortraitSourceUrl: "https://www.anyone.io/team",
    artifact_verified: true,
  }],
  organizationRelationships: [{
    name: "Enigma Fund",
    handle: "@EnigmaFund",
    role: "Strategic advisor",
    kind: "org",
    source: "https://x.com/anyonefdn/status/1",
    sourceUrl: "https://x.com/anyonefdn/status/1",
    artifact_verified: true,
  }],
  projectToken: {
    verified: true,
    verification: "official_domain",
    name: "ANyONe Protocol",
    symbol: "ANYONE",
    rank: 1007,
    address: "0x1111111111111111111111111111111111111111",
    chain: "ethereum",
    sourceUrl: "https://docs.anyone.io/resources/token",
    capturedAt: "2026-08-27T00:00:00.000Z",
  },
} as unknown as Dossier;

const nodes = [
  { type: "Company", key: "@anyonefdn", label: "ANyONe Protocol", subject: true },
  { type: "Person", key: "@sergeyilin", label: "Sergey Ilin", role: "Operations Lead" },
  { type: "Person", key: "Anon Morpho", label: "Anon Morpho", role: "Strategic and Marketing Lead" },
  { type: "Company", key: "EnigmaLand", label: "EnigmaLand" },
  { type: "Identity", subtype: "Wallet", key: "wallet:solana:9x9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a", chain: "solana" },
  { type: "Person", key: "Bloxroute. Senior", label: "Bloxroute. Senior", role: "Senior Lead" },
];

const edges = [
  { src: "@anyonefdn", dst: "@sergeyilin", type: "TEAM", source_url: "https://www.anyone.io/team" },
  { src: "@sergeyilin", dst: "EnigmaLand", type: "WORKED_ON" },
  { src: "@anyonefdn", dst: "wallet:solana:9x9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a", type: "CONTROLS_WALLET" },
  { src: "@anyonefdn", dst: "Bloxroute. Senior", type: "TEAM", source_url: "https://www.anyone.io/team", verdict: "Unconfirmed" },
];

describe("KyleConnectionWorkspace", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    document.documentElement.dataset.reportLane = "kyle";
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    vi.useRealTimers();
    container.remove();
    delete document.documentElement.dataset.reportLane;
  });

  it("clusters frozen people, projects, wallets and tokens without changing evidence", async () => {
    const root = createRoot(container);
    await act(async () => root.render(<KyleConnectionWorkspace dossier={dossier} nodes={nodes} edges={edges} connections={[]} />));

    expect(container.textContent).toContain("Core team");
    expect(container.textContent).toContain("Advisors & backers");
    expect(container.textContent).toContain("Enigma Fund");
    expect(container.textContent).toContain("Projects & Organizations");
    expect(container.textContent).toContain("Wallets & Tokens");
    expect(container.textContent).toContain("Sergey Ilin");
    expect(container.textContent).toContain("$ANYONE");
    expect(container.textContent).toContain("4 relationships");
    expect(container.querySelectorAll('button[aria-label^="Anon Morpho,"]')).toHaveLength(1);
    expect(container.querySelector('button[aria-label^="Anon Morpho,"] img')?.getAttribute("src")).toBe("https://images.anyone.io/team/anon-morpho.png");
    expect(container.textContent).not.toContain("Bloxroute. Senior");

    await act(async () => root.unmount());
  });

  it("opens a priced confirmation sheet before starting a rabbit-hole investigation", async () => {
    vi.useFakeTimers();
    const onAudit = vi.fn();
    const root = createRoot(container);
    await act(async () => root.render(<KyleConnectionWorkspace dossier={dossier} nodes={nodes} edges={edges} connections={[]} onAudit={onAudit} previewBalance={49_975} />));

    const sergey = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("Sergey Ilin"));
    await act(async () => sergey?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const research = [...container.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Research this");
    await act(async () => research?.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(document.body.textContent).toContain("Investigate Sergey Ilin");
    expect(document.body.textContent).toContain("0.8–1.6 credits");
    expect(document.body.textContent).toContain("2–4 minutes");
    expect(document.body.textContent).toContain("49,975.0 credits");
    expect(onAudit).not.toHaveBeenCalled();

    const confirm = [...document.body.querySelectorAll("button")].find((button) => button.textContent?.includes("Run investigation · up to 1.6 credits"));
    await act(async () => confirm?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onAudit).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(350));
    expect(onAudit).toHaveBeenCalledWith("@sergeyilin", false);

    await act(async () => root.unmount());
  });

  it("suppresses malformed person fragments before they enter the graph or paid research", async () => {
    const onAudit = vi.fn();
    const root = createRoot(container);
    await act(async () => root.render(<KyleConnectionWorkspace dossier={dossier} nodes={nodes} edges={edges} connections={[]} onAudit={onAudit} previewBalance={49_975} />));

    const malformed = [...container.querySelectorAll("button")].find((button) => button.getAttribute("aria-label")?.startsWith("Bloxroute. Senior"));
    expect(malformed).toBeUndefined();
    expect(container.textContent).not.toContain("Bloxroute. Senior");
    expect(onAudit).not.toHaveBeenCalled();

    await act(async () => root.unmount());
  });

  it("allows a canonical X handle to seed an exploratory investigation without verifying the relationship", async () => {
    const onAudit = vi.fn();
    const root = createRoot(container);
    await act(async () => root.render(
      <KyleConnectionWorkspace
        dossier={dossier}
        nodes={nodes}
        edges={edges}
        connections={[{ other: "@zoomeroracle", ties: [], direct: true }]}
        onAudit={onAudit}
        previewBalance={49_975}
      />,
    ));

    const lead = [...container.querySelectorAll("button")].find((button) => button.getAttribute("aria-label")?.startsWith("@zoomeroracle,"));
    await act(async () => lead?.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(container.textContent).toContain("No direct source URL was preserved for this graph edge.");
    expect(container.textContent).toContain("This exact X handle can seed a fresh investigation, but its current relationship remains unverified.");
    const explore = [...container.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Explore this lead");
    expect(explore).toBeDefined();
    await act(async () => explore?.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(document.body.textContent).toContain("Explore @zoomeroracle");
    expect(document.body.textContent).toContain("The relationship shown in the current report remains unverified unless the fresh investigation independently confirms it.");
    const confirm = [...document.body.querySelectorAll("button")].find((button) => button.textContent?.includes("Explore lead · up to 1.6 credits"));
    expect(confirm).toBeDefined();

    await act(async () => root.unmount());
  });
});
