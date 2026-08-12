// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TokenDossier } from "../token/audit";
import { SecondOpinion } from "./SecondOpinion";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;

const dossier = {
  symbol: "ARGUS",
  chain: "ethereum",
  verdict: "PASS",
  score: 82,
  headline: "Most core claims were supported.",
  findings: [],
  safety: { available: false },
  topHolders: [],
  insiderPct: 0,
  bundleRisk: "unknown",
} as unknown as TokenDossier;

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

function setTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  setter?.call(textarea, value);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("SecondOpinion", () => {
  it("sends only the analyst question and lets the API reload the frozen report", async () => {
    const providerFetch = vi.fn().mockResolvedValue({
      json: async () => ({
        available: true,
        recommendation: "uphold",
        confidence: "high",
        summary: "The saved evidence supports the report.",
        grounding: "validated_frozen_references",
        evidenceReferences: [{ id: "ev:report:decision", label: "Frozen report decision", path: "stored" }],
        challenges: [],
      }),
    });
    vi.stubGlobal("fetch", providerFetch);

    act(() => {
      root.render(
        <SecondOpinion
          dossier={dossier}
          panelCostToken="signed-panel-token"
        />,
      );
    });

    expect(container.textContent).toContain("What do you want to challenge about this report?");
    const textarea = container.querySelector<HTMLTextAreaElement>("textarea");
    act(() => setTextareaValue(textarea!, "The team information looks wrong."));
    const submit = container.querySelector<HTMLButtonElement>('button[type="submit"]');
    await act(async () => {
      submit?.click();
      await Promise.resolve();
    });

    expect(providerFetch).toHaveBeenCalledTimes(1);
    const request = providerFetch.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body));
    expect(body).toEqual({ question: "The team information looks wrong." });
    expect(body).not.toHaveProperty("subject");
    expect(body).not.toHaveProperty("verdict");
    expect(body).not.toHaveProperty("score");
    expect(body).not.toHaveProperty("evidence");
    expect(request.headers).toMatchObject({ "x-argus-panel-token": "signed-panel-token" });
    expect(container.textContent).toContain("The saved evidence supports the report.");
    expect(container.textContent).toContain("frozen references validated");
    expect(container.textContent).toContain("Frozen report decision");
  });
});
