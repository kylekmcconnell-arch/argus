// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TrustGraph,
  collectTrustGraphHops,
  prefersTrustGraphMotion,
  trustGraphKind,
  trustGraphLinkSentence,
  trustGraphReadingLine,
  trustGraphStage,
} from "./TrustGraph";

const earnNodes = [
  { type: "Person", key: "@earnonhood", subject: true },
  { type: "Identity", subtype: "Wallet", key: "robinhood:0xa3b6aee90017b72c0812dc1e013de70eb2917ba3" },
  { type: "Person", key: "Tharmas", label: "Tharmas" },
];
const earnEdges = [
  { src: "@earnonhood", dst: "robinhood:0xa3b6aee90017b72c0812dc1e013de70eb2917ba3", type: "CONTROLS_WALLET" },
  { src: "@earnonhood", dst: "Tharmas", type: "TEAM" },
];

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const secondHopNodes = [
  { type: "Person", key: "@subject", subject: true },
  { type: "Company", key: "@fund", label: "Fund" },
  { type: "Company", key: "project.example", label: "Project" },
];
const secondHopEdges = [
  { src: "@subject", dst: "@fund", type: "AFFILIATED_WITH" },
  { src: "@fund", dst: "project.example", type: "INVESTED_IN" },
];

function matchMedia(matches: boolean): MediaQueryList {
  return {
    matches,
    media: "(prefers-reduced-motion: reduce)",
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  } as unknown as MediaQueryList;
}

describe("TrustGraph relationship depth", () => {
  it("renders an affiliated fund and its portfolio company as a true second hop", () => {
    const hops = collectTrustGraphHops(secondHopNodes, secondHopEdges, "@subject");
    expect(hops).toEqual([
      expect.objectContaining({ node: expect.objectContaining({ key: "@fund" }), depth: 1 }),
      expect.objectContaining({ node: expect.objectContaining({ key: "project.example" }), depth: 2, parentKey: "@fund" }),
    ]);

    const html = renderToStaticMarkup(<TrustGraph nodes={secondHopNodes} edges={secondHopEdges} />);

    expect(html).toContain("affiliated with");
    expect(html).toContain("invested in");
    expect(html).toContain("project.example");
    expect(html).toContain('data-depth="2"');
    expect(html).toContain("Second hop via Fund");
  });
});

describe("TrustGraph reading line", () => {
  it("counts real edges and names contradicted plus high-concentration wallets", () => {
    expect(trustGraphReadingLine({ links: 0, contradicted: 0, highConcentrationWallets: 0 })).toBe("No recorded links.");
    expect(trustGraphReadingLine({ links: 12, contradicted: 2, highConcentrationWallets: 1 }))
      .toBe("12 recorded links. 2 contradicted. 1 high-concentration wallet.");
    expect(trustGraphKind({ type: "Identity", subtype: "Wallet", key: "wallet:base:0xdef" })).toBe("wallets");
    expect(trustGraphKind({ type: "Person", key: "@peer" })).toBe("people");
    expect(trustGraphKind({ type: "Company", key: "@fund", label: "Fund" })).toBe("companies");
  });

  it("renders the counted line above the map", () => {
    const html = renderToStaticMarkup(
      <TrustGraph
        nodes={[
          { type: "Person", key: "@subject", subject: true },
          { type: "Person", key: "@peer" },
          { type: "Identity", subtype: "Wallet", key: "wallet:base:0xdef" },
          { type: "Person", key: "@rival" },
        ]}
        edges={[
          { src: "@subject", dst: "@peer", type: "ASSOCIATES_WITH", verdict: "Confirmed" },
          { src: "@subject", dst: "wallet:base:0xdef", type: "HELD_BY", verdict: "Contradicted" },
          { src: "@subject", dst: "@rival", type: "ASSOCIATES_WITH", verdict: "Contradicted" },
        ]}
      />,
    );

    expect(html).toContain("3 recorded links. 1 contradicted. 1 high-concentration wallet.");
    expect(html).toContain("A link by itself does not mean wrongdoing.");
    expect(html).toContain("High concentration");
  });
});

describe("TrustGraph sparse EARN web", () => {
  it("keeps the two recorded links and does not invent more", () => {
    expect(collectTrustGraphHops(earnNodes, earnEdges, "@earnonhood")).toHaveLength(2);
    expect(trustGraphStage(2).sparse).toBe(true);
    expect(trustGraphLinkSentence(earnEdges[0], "@earnonhood", "Wallet 0xa3b6aee90017b72c0812dc1e013de70eb2917ba3"))
      .toBe("@earnonhood controls Wallet 0xa3b6aee90017b72c0812dc1e013de70eb2917ba3.");
    expect(trustGraphLinkSentence(earnEdges[1], "@earnonhood", "Tharmas"))
      .toBe("Tharmas is on the team for @earnonhood.");

    const html = renderToStaticMarkup(<TrustGraph nodes={earnNodes} edges={earnEdges} />);
    expect(html).toContain("2 recorded links.");
    expect(html).toContain('data-trust-graph-sparse="true"');
    expect(html).toContain("@earnonhood");
    expect(html).toContain("Tharmas");
    expect(html).toContain("Wallet 0xa3b6aee90017b72c0812dc1e013de70eb2917ba3");
    expect(html).toContain("controls");
    expect(html).toContain("is on the team for");
    expect(html).toContain("Recorded connections");
    expect(html).not.toContain("@fund");
    expect(html).not.toContain("project.example");
    expect(html).not.toContain("@peer");
  });
});

describe("TrustGraph empty state", () => {
  it("stays honest when only the subject was recorded", () => {
    const html = renderToStaticMarkup(
      <TrustGraph nodes={[{ type: "Person", key: "@subject", subject: true }]} edges={[]} />,
    );

    expect(html).toContain("No recorded links.");
    expect(html).toContain("No relationships were recorded for this subject.");
    expect(html).not.toContain("aria-label=\"Connection filters\"");
  });
});

describe("TrustGraph interaction", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.stubGlobal("matchMedia", vi.fn(() => matchMedia(true)));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ available: false }), { status: 200 })));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("explains each recorded EARN link from the two real edges only", async () => {
    const onAudit = vi.fn();
    await act(async () => {
      root.render(<TrustGraph nodes={earnNodes} edges={earnEdges} onAudit={onAudit} />);
    });

    expect(container.textContent).toContain("2 recorded links.");
    expect(container.querySelectorAll("[data-depth]")).toHaveLength(2);

    await act(async () => {
      (container.querySelector('[data-node-key="Tharmas"]') as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.querySelector("[data-trust-graph-inspector]")?.textContent).toContain("Tharmas is on the team for @earnonhood.");
    expect(container.querySelector("[data-trust-graph-inspector] .tint-signal")).toBeNull();
    expect(onAudit).not.toHaveBeenCalled();

    await act(async () => {
      (container.querySelector('[data-node-key="robinhood:0xa3b6aee90017b72c0812dc1e013de70eb2917ba3"]') as HTMLElement)
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.querySelector("[data-trust-graph-inspector]")?.textContent)
      .toContain("@earnonhood controls Wallet 0xa3b6aee90017b72c0812dc1e013de70eb2917ba3.");
    expect(container.querySelector("[data-trust-graph-inspector] .tint-signal")).toBeNull();
  });

  it("selects on first click and keeps audit opening as an explicit control", async () => {
    const onAudit = vi.fn();
    await act(async () => {
      root.render(
        <TrustGraph
          nodes={[
            { type: "Person", key: "@subject", subject: true },
            { type: "Person", key: "@peer" },
          ]}
          edges={[{ src: "@subject", dst: "@peer", type: "ASSOCIATES_WITH", verdict: "Unconfirmed", source_url: "https://x.com/peer/status/1" }]}
          onAudit={onAudit}
        />,
      );
    });

    expect(container.querySelector("[data-trust-graph-inspector]")).toBeNull();
    const node = container.querySelector('[data-node-key="@peer"]') as HTMLElement;
    await act(async () => {
      node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const inspector = container.querySelector("[data-trust-graph-inspector]");
    expect(inspector?.textContent).toContain("@peer");
    expect(inspector?.textContent).toContain("@subject is associated with @peer.");
    expect(inspector?.textContent).toContain("Direct link to the subject.");
    expect(inspector?.textContent).toContain("x.com/peer/status/1");
    const open = container.querySelector("[data-trust-graph-inspector] .tint-signal") as HTMLButtonElement;
    expect(open.textContent).toContain("Open @peer");
    expect(onAudit).not.toHaveBeenCalled();
    await act(async () => {
      open.click();
    });
    expect(onAudit).toHaveBeenCalledWith("@peer");
  });

  it("names the via-parent for a selected second hop", async () => {
    await act(async () => {
      root.render(<TrustGraph nodes={secondHopNodes} edges={secondHopEdges} />);
    });

    const project = container.querySelector('[data-node-key="project.example"]') as HTMLElement;
    await act(async () => {
      project.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const inspector = container.querySelector("[data-trust-graph-inspector]");
    expect(inspector?.textContent).toContain("Project");
    expect(inspector?.textContent).toContain("Second hop via Fund");
    expect(inspector?.textContent).toContain("not directly to @subject");
    expect(inspector?.querySelector(".tint-signal")).toBeNull();
  });

  it("fades filtered kinds without deleting ledger rows", async () => {
    await act(async () => {
      root.render(
        <TrustGraph
          nodes={[
            { type: "Person", key: "@subject", subject: true },
            { type: "Person", key: "@peer" },
            { type: "Identity", subtype: "Wallet", key: "wallet:base:0xdef" },
          ]}
          edges={[
            { src: "@subject", dst: "@peer", type: "ASSOCIATES_WITH" },
            { src: "@subject", dst: "wallet:base:0xdef", type: "HELD_BY", risk: "high_concentration" },
          ]}
        />,
      );
    });

    const people = container.querySelector('button[aria-pressed="true"]') as HTMLButtonElement;
    expect(people.textContent).toMatch(/people/i);
    await act(async () => {
      people.click();
    });

    expect(container.querySelector('[data-node-key="@peer"]')?.getAttribute("data-filtered")).toBe("true");
    expect(container.textContent).toContain("@peer");
    expect(container.textContent).toContain("Wallet 0xdef");
    expect(container.querySelector('[data-node-key="wallet:base:0xdef"]')?.getAttribute("data-filtered")).toBe("false");
  });

  it("shows the final layout with no entrance motion when reduced motion is requested", async () => {
    expect(prefersTrustGraphMotion()).toBe(false);
    await act(async () => {
      root.render(
        <TrustGraph
          nodes={[
            { type: "Person", key: "@subject", subject: true },
            { type: "Person", key: "@peer" },
          ]}
          edges={[{ src: "@subject", dst: "@peer", type: "ASSOCIATES_WITH" }]}
        />,
      );
    });

    expect(container.querySelector("[data-trust-graph-motion]")?.getAttribute("data-trust-graph-motion")).toBe("static");
  });
});
