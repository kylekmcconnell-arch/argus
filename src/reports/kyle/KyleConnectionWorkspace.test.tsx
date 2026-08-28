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

  it("never drops a source-backed advisor when the cluster contains more than six entries", async () => {
    const advisorDossier = {
      ...dossier,
      webTeam: [
        { name: "Nik Hawks", role: "Advisor", sourceUrl: "https://www.anyone.io/team", artifact_verified: true },
        { name: "Andrzej Tucholka", role: "Technical Advisor", sourceUrl: "https://www.anyone.io/team", artifact_verified: true },
        { name: "Sean Carey", role: "Advisor", sourceUrl: "https://www.anyone.io/team", artifact_verified: true },
        { name: "Max Gold", role: "Advisor", sourceUrl: "https://www.anyone.io/team", artifact_verified: true },
        { name: "Slava Kreynin", role: "Advisor", sourceUrl: "https://www.anyone.io/team", artifact_verified: true },
        { name: "Sergey Ilin", role: "Advisor", sourceUrl: "https://www.anyone.io/team", artifact_verified: true },
      ],
    } as unknown as Dossier;
    const root = createRoot(container);
    await act(async () => root.render(<KyleConnectionWorkspace dossier={advisorDossier} nodes={nodes.slice(0, 1)} edges={[]} connections={[]} />));

    const advisors = [...container.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Advisors");
    await act(async () => advisors?.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(container.textContent).toContain("Advisors & backers 7");
    expect(container.querySelector('button[aria-label^="Enigma Fund,"]')?.getAttribute("data-hidden")).toBe("false");

    await act(async () => root.unmount());
  });

  it("recovers corroborated legacy advisor evidence without promoting unconfirmed claims", async () => {
    const testimonialDossier = {
      ...dossier,
      webTeam: [],
      organizationRelationships: [],
      evidence: {
        testimonials: [{
          claimed_endorser_name: "Enigma Fund",
          claimed_endorser_handle: "@EnigmaFund",
          claimed_relationship: "advisor",
          corroboration_verdict: "Corroborated",
          evidence_url: "https://x.com/anyonefdn/status/1",
        }, {
          claimed_endorser_name: "Unverified Capital",
          claimed_relationship: "advisor",
          corroboration_verdict: "Unconfirmed",
        }],
      },
    } as unknown as Dossier;
    const root = createRoot(container);
    await act(async () => root.render(<KyleConnectionWorkspace dossier={testimonialDossier} nodes={nodes.slice(0, 1)} edges={[]} connections={[]} />));

    expect(container.textContent).toContain("Enigma Fund");
    expect(container.textContent).not.toContain("Unverified Capital");

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

  it("moves the filtered-empty explanation into the controls and keeps only a top graph notice", async () => {
    const root = createRoot(container);
    await act(async () => root.render(<KyleConnectionWorkspace dossier={dossier} nodes={nodes} edges={edges} connections={[]} />));

    const advisors = [...container.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Advisors");
    const social = [...container.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Social");
    await act(async () => advisors?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await act(async () => social?.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(container.textContent).toContain("0 of 6 connections shown");
    expect(container.textContent).toContain("No connections match these filters.");
    expect(container.querySelector(".kyle-connection-canvas-notice")?.textContent).toBe("No connections match the active filters.");
    expect(container.querySelector(".kyle-connection-empty")).toBeNull();

    const resetFilters = [...container.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Reset filters");
    await act(async () => resetFilters?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(container.textContent).toContain("6 of 6 connections shown");

    await act(async () => root.unmount());
  });

  it("distinguishes an investigation with no source-backed connections and offers a new search", async () => {
    const emptyDossier = {
      ...dossier,
      webTeam: [],
      organizationRelationships: [],
      projectToken: undefined,
    } as unknown as Dossier;
    const subjectOnly = [{ type: "Company", key: "@anyonefdn", label: "ANyONe Protocol", subject: true }];
    const root = createRoot(container);
    await act(async () => root.render(<KyleConnectionWorkspace dossier={emptyDossier} nodes={subjectOnly} edges={[]} connections={[]} />));

    expect(container.textContent).toContain("0 connections found");
    expect(container.textContent).toContain("This investigation did not surface any source-backed relationships.");
    expect(container.querySelector(".kyle-connection-canvas-notice")?.textContent).toBe("No source-backed connections were found in this investigation.");
    expect(container.textContent).not.toContain("Reset filters");

    const search = [...container.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Search for connections");
    await act(async () => search?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(document.activeElement).toBe(container.querySelector('input[aria-label="Search connections"]'));

    await act(async () => root.unmount());
  });
});
