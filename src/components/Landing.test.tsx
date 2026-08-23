// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("./ArgusMark", () => ({ HeroBackdrop: () => null, ArgusMark: () => null }));
vi.mock("./ScoreTicker", () => ({ ScoreTicker: () => null }));
vi.mock("../lib/recentScored", () => ({ recentScored: () => [] }));

import { Landing } from "./Landing";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => { root?.unmount(); });
  container?.remove();
  root = null;
  container = null;
});

describe("Landing fresh audit launch", () => {
  it("discloses provider cost and suppresses duplicate submissions", async () => {
    const neverSettles = new Promise<void>(() => undefined);
    const onAudit = vi.fn(() => neverSettles);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(<Landing onAudit={onAudit} onAbout={() => undefined} />);
    });

    const input = container.querySelector<HTMLInputElement>("input");
    const form = container.querySelector<HTMLFormElement>("form");
    expect(input).not.toBeNull();
    expect(form).not.toBeNull();
    expect(input?.placeholder).toBe("@handle, contract, project, or website");
    const trace = container.querySelector<HTMLElement>(".investigation-trace");
    expect(trace).not.toBeNull();
    expect(trace?.getAttribute("aria-hidden")).toBe("true");
    expect(trace?.querySelector("svg")).not.toBeNull();
    expect(container.textContent).toContain("A new scan checks current sources and may use paid data");
    expect(container.textContent).toContain("Open a recent case to reuse saved results");
    expect(container.textContent).not.toContain("Open saved Uniswap report");
    expect(container.textContent).not.toContain("See the finished experience");
    expect(container.textContent).not.toContain("Try a live token");
    expect(container.textContent).not.toMatch(/\$(PEPE|SHIB|UNI)\b/);

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      valueSetter?.call(input, "existingfounder");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(onAudit).toHaveBeenCalledTimes(1);
    expect(onAudit).toHaveBeenCalledWith("existingfounder", false, "investment_due_diligence");
    const button = container.querySelector<HTMLButtonElement>("button[type='submit']");
    expect(button?.disabled).toBe(true);
    expect(button?.textContent).toContain("Starting…");
  });

  it("releases the submission lock when launch routing rejects", async () => {
    const onAudit = vi.fn().mockRejectedValue(new Error("routing failed"));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(<Landing onAudit={onAudit} onAbout={() => undefined} />);
    });

    const input = container.querySelector<HTMLInputElement>("input");
    const form = container.querySelector<HTMLFormElement>("form");
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      valueSetter?.call(input, "retryable_founder");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    const button = container.querySelector<HTMLButtonElement>("button[type='submit']");
    expect(button?.disabled).toBe(false);
    expect(button?.textContent).toContain("Start investigation");

    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onAudit).toHaveBeenCalledTimes(2);
  });

  it("passes the user's decision to the investigation director", async () => {
    const onAudit = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(<Landing onAudit={onAudit} onAbout={() => undefined} />);
    });

    const input = container.querySelector<HTMLInputElement>("#investigation-subject");
    const identityOption = Array.from(container.querySelectorAll<HTMLButtonElement>("button[aria-pressed]"))
      .find((button) => button.textContent?.includes("Reveal identity and control"));
    const form = container.querySelector<HTMLFormElement>("form");
    await act(async () => {
      const inputSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      inputSetter?.call(input, "@clutchmarkets");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
      identityOption?.click();
    });
    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(onAudit).toHaveBeenCalledWith("@clutchmarkets", false, "identity_and_control");
  });

  it("presents four decision lenses with one selected at a time", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root?.render(<Landing onAudit={() => undefined} onAbout={() => undefined} />));

    const options = Array.from(container.querySelectorAll<HTMLButtonElement>("button[aria-pressed]"));
    expect(options).toHaveLength(4);
    expect(options.filter((option) => option.getAttribute("aria-pressed") === "true")).toHaveLength(1);

    await act(async () => options[2]?.click());
    expect(options[2]?.getAttribute("aria-pressed")).toBe("true");
    expect(options[0]?.getAttribute("aria-pressed")).toBe("false");
  });
});
