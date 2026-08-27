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
  { type: "Company", key: "EnigmaLand", label: "EnigmaLand" },
  { type: "Identity", subtype: "Wallet", key: "wallet:solana:9x9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a", chain: "solana" },
];

const edges = [
  { src: "@anyonefdn", dst: "@sergeyilin", type: "TEAM", source_url: "https://www.anyone.io/team" },
  { src: "@sergeyilin", dst: "EnigmaLand", type: "WORKED_ON" },
  { src: "@anyonefdn", dst: "wallet:solana:9x9a9a9a9a9a9a9a9a9a9a9a9a9a9a", type: "CONTROLS_WALLET" },
];

describe("KyleConnectionWorkspace", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    document.documentElement.dataset.reportLane = "kyle";
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
    delete document.documentElement.dataset.reportLane;
  });

  it("clusters frozen people, projects, wallets and tokens without changing evidence", async () => {
    const root = createRoot(container);
    await act(async () => root.render(<KyleConnectionWorkspace dossier={dossier} nodes={nodes} edges={edges} connections={[]} />));

    expect(container.textContent).toContain("Team");
    expect(container.textContent).toContain("Projects & Organizations");
    expect(container.textContent).toContain("Wallets & Tokens");
    expect(container.textContent).toContain("Sergey Ilin");
    expect(container.textContent).toContain("$ANYONE");
    expect(container.textContent).toContain("3 relationships");

    await act(async () => root.unmount());
  });

  it("opens an explicit one-credit confirmation before starting a rabbit-hole investigation", async () => {
    const onAudit = vi.fn();
    const root = createRoot(container);
    await act(async () => root.render(<KyleConnectionWorkspace dossier={dossier} nodes={nodes} edges={edges} connections={[]} onAudit={onAudit} />));

    const sergey = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("Sergey Ilin"));
    await act(async () => sergey?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const research = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("Research person"));
    await act(async () => research?.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(document.body.textContent).toContain("1 investigation credit");
    expect(onAudit).not.toHaveBeenCalled();

    const confirm = [...document.body.querySelectorAll("button")].find((button) => button.textContent?.includes("Confirm research"));
    await act(async () => confirm?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onAudit).toHaveBeenCalledWith("@sergeyilin");

    await act(async () => root.unmount());
  });
});
