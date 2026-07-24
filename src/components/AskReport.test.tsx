// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AskReport } from "./AskReport";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("AskReport", () => {
  it("sends only the question and exact immutable version, leaving evidence loading to the server", async () => {
    const providerFetch = vi.fn().mockResolvedValue({
      json: async () => ({
        answer: "The frozen source supports the claim.",
        citations: ["https://example.com/source"],
      }),
    });
    vi.stubGlobal("fetch", providerFetch);
    act(() => {
      root.render(
        <AskReport
          subject="@alice"
          reportVersionId="1d4b3030-de29-4633-a281-beb9672c4a00"
        />,
      );
    });
    const toggle = container.querySelector<HTMLButtonElement>('button[aria-expanded="false"]');
    act(() => toggle?.click());
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Question about this report"]');
    expect(input?.disabled).toBe(false);
    act(() => setInputValue(input!, "What supports the claim?"));
    const askButton = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "Ask");
    await act(async () => { askButton?.click(); await Promise.resolve(); });

    expect(providerFetch).toHaveBeenCalledTimes(1);
    const requestBody = JSON.parse(String((providerFetch.mock.calls[0]?.[1] as RequestInit)?.body));
    expect(requestBody).toMatchObject({
      subject: "@alice",
      question: "What supports the claim?",
      reportVersionId: "1d4b3030-de29-4633-a281-beb9672c4a00",
    });
    expect(requestBody).not.toHaveProperty("report");
    expect(container.textContent).toContain("The frozen source supports the claim.");
    expect(container.querySelector('a[href="https://example.com/source"]')).not.toBeNull();
  });

  it("keeps chat inert when no immutable version is available", () => {
    const providerFetch = vi.fn();
    vi.stubGlobal("fetch", providerFetch);
    act(() => root.render(<AskReport subject="@alice" />));
    const toggle = container.querySelector<HTMLButtonElement>('button[aria-expanded="false"]');
    act(() => toggle?.click());

    expect(container.querySelector<HTMLInputElement>("input")?.disabled).toBe(true);
    expect(container.textContent).toContain("Save or open a report before asking a question.");
    expect(providerFetch).not.toHaveBeenCalled();
  });
});
