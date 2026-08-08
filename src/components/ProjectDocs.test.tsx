// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectDocs } from "./ProjectDocs";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function stub(body: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  })));
}

async function renderPanel() {
  await act(async () => {
    root.render(<ProjectDocs name="Argus" domain="argus.example" panelCostToken="signed-panel" />);
  });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("ProjectDocs coverage truth", () => {
  it("renders an incomplete empty read as unknown, not as an absence flag", async () => {
    stub({
      available: true,
      completed: false,
      partial: true,
      providerFailed: true,
      whitepaper: null,
      resources: [],
      audits: [],
      hasTeamPage: null,
      hasAbout: null,
      note: "Document discovery did not complete. No conclusion about missing documents was drawn.",
    });

    await renderPanel();

    expect(container.textContent).toContain("Document discovery did not complete");
    expect(container.textContent).not.toContain("absence is itself a flag");
    expect(container.firstElementChild?.className).not.toContain("tint-caution");
    expect(container.querySelector(".text-caution")).toBeNull();
  });

  it("uses caution styling only for a completed bounded empty read", async () => {
    stub({
      available: true,
      completed: true,
      partial: false,
      providerFailed: false,
      whitepaper: null,
      resources: [],
      audits: [],
      hasTeamPage: false,
      hasAbout: false,
      note: "A completed homepage-navigation read and web/X search surfaced no documents within those sources.",
    });

    await renderPanel();

    expect(container.textContent).toContain("completed homepage-navigation read");
    expect(container.firstElementChild?.className).toContain("tint-caution");
    expect(container.querySelector(".text-caution")).not.toBeNull();
  });

  it("does not infer a missing audit from a whitepaper found during a partial read", async () => {
    stub({
      available: true,
      completed: false,
      partial: true,
      providerFailed: false,
      whitepaper: { url: "https://docs.argus.example/whitepaper", kind: "whitepaper" },
      resources: [],
      audits: [],
      note: "Document discovery was partial. Missing resource categories were not ruled out.",
    });

    await renderPanel();

    expect(container.textContent).toContain("Document discovery was partial");
    expect(container.textContent).not.toContain("no security audit surfaced");
  });

  it("attributes completed positive search results as discovery context", async () => {
    stub({
      available: true,
      completed: true,
      partial: false,
      providerFailed: false,
      whitepaper: { url: "https://docs.argus.example/whitepaper", kind: "whitepaper" },
      resources: [{ category: "team", title: "Team", url: "https://argus.example/team" }],
      audits: [],
      hasTeamPage: true,
      hasAbout: false,
      note: "Homepage navigation and live web/X search surfaced these links. Search-surfaced labels are discovery context, not independent verification of the linked claims.",
    });

    await renderPanel();

    expect(container.textContent).toContain("Search-surfaced labels are discovery context");
    expect(container.textContent).toContain("not independent verification");
    expect(container.textContent).toContain("team link surfaced");
    expect([...container.querySelectorAll(".chip")].find((chip) => chip.textContent?.includes("team link surfaced"))?.className)
      .toContain("tint-signal");
  });
});
