// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GithubShipping } from "./GithubShipping";
import type { ShippingInput } from "../threat/shipping";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../lib/priceHistory", () => ({ fetchOhlcv: vi.fn().mockResolvedValue(null) }));

let container: HTMLDivElement;
let root: Root;

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

const NOW = "2026-09-15T12:00:00Z";
const daysAgo = (d: number) => new Date(Date.parse(NOW) - d * 864e5).toISOString();

const input: ShippingInput = {
  target: "hey-research-lab",
  kind: "org",
  now: NOW,
  windowDays: 90,
  repos: [{ nameWithOwner: "hey-research-lab/hey-research-open", isFork: false, createdAt: daysAgo(4), pushedAt: daysAgo(0), stars: 0, forks: 0, license: "MIT", releases: [], releaseCount: 0, hasReadme: true, hasCi: true, hasTests: true }],
  commits: Array.from({ length: 44 }, (_, i) => ({
    sha: `s${i}`,
    date: daysAgo(4 - Math.floor(i / 11)),
    authorKey: "327801004+hey-research-lab@users.noreply.github.com",
    authorName: "HEY Research Lab",
    authorLogin: "hey-research-lab",
    additions: 200,
    deletions: 100,
    files: 12,
    headline: `Sync from HEY Research Lab (${i})`,
    repo: "hey-research-lab/hey-research-open",
  })),
  peers: {
    sector: "analytics",
    label: "leading crypto analytics and research tooling",
    repos: [{ nameWithOwner: "santiment/sanbase2", commitsInWindow: 360, authorsInWindow: 4, stars: 94 }],
  },
};

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

describe("GithubShipping panel", () => {
  it("refuses to fetch without a panel token and says a saved report is required", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => { root.render(<GithubShipping org="hey-research-lab" />); });
    const button = container.querySelector("button") as HTMLButtonElement;
    expect(button.textContent).toBe("saved report required");
    expect(button.disabled).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("detects the sector from the copy and requests it, then renders the assessment", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ available: true, input, assessment: undefined }));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => { root.render(<GithubShipping org="hey-research-lab" sectorText="builder intelligence and research analytics for Robinhood Chain" panelCostToken="signed" />); });
    expect(container.textContent).toContain("leading crypto analytics and research tooling");
    const button = container.querySelector("button") as HTMLButtonElement;
    await act(async () => { button.click(); });
    await act(async () => { await Promise.resolve(); });

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("/api/github-shipping?org=hey-research-lab");
    expect(url).toContain("sector=analytics");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ headers: expect.objectContaining({ "x-argus-panel-token": "signed" }) });

    const text = container.textContent ?? "";
    expect(text).toContain("Shipping · solo");
    expect(text).toContain("unattributed mirror account");
    expect(text).toContain("Mirror account only");
    expect(text).toContain("Against leading crypto analytics and research tooling");
    expect(text).toContain("santiment/sanbase2");
    expect(text).toContain("A mirrored repository can hide a real team");
  });

  it("shows the server note when the read did not complete", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ available: false, note: "GitHub shipping assessment did not complete." })));
    await act(async () => { root.render(<GithubShipping org="acme" panelCostToken="signed" />); });
    await act(async () => { (container.querySelector("button") as HTMLButtonElement).click(); });
    await act(async () => { await Promise.resolve(); });
    expect(container.textContent).toContain("GitHub shipping assessment did not complete.");
    expect(container.textContent).not.toContain("Shipping · solo");
  });
});
