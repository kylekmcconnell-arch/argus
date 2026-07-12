// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("./ArgusMark", () => ({ HeroBackdrop: () => null }));
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
    expect(container.textContent).toContain("Starts a fresh provider run and may use paid API quota");
    expect(container.textContent).toContain("Open previous snapshots from Recent audits");

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
    expect(onAudit).toHaveBeenCalledWith("existingfounder", false);
    const button = container.querySelector<HTMLButtonElement>("button[type='submit']");
    expect(button?.disabled).toBe(true);
    expect(button?.textContent).toContain("Starting fresh audit");
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
    expect(button?.textContent).toContain("Run audit");

    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onAudit).toHaveBeenCalledTimes(2);
  });
});
