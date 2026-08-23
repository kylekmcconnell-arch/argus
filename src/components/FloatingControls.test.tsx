// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArgusEyeAssistant } from "./ArgusEyeAssistant";
import { FeedbackButton } from "./FeedbackButton";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("global floating controls", () => {
  it("assigns feedback and ARGUS Eye to the shared collision-free rail", () => {
    act(() => root.render(<><FeedbackButton /><ArgusEyeAssistant subject="Preview report" /></>));

    expect(container.querySelector('[data-testid="feedback-launcher"]')?.classList.contains("feedback-launcher")).toBe(true);
    expect(container.querySelector('[data-testid="feedback-launcher"]')?.classList.contains("floating-brand-launcher")).toBe(true);
    expect(container.querySelector('[data-testid="argus-eye-assistant"]')?.classList.contains("argus-eye-assistant")).toBe(true);
    expect(container.querySelector('[aria-label="Ask ARGUS Eye about this report"]')?.classList.contains("floating-brand-launcher")).toBe(true);

  });

  it("exposes Eye state for the rail to yield while the panel is open", () => {
    act(() => root.render(<><FeedbackButton /><ArgusEyeAssistant subject="Preview report" /></>));
    const eye = container.querySelector<HTMLButtonElement>('[aria-label="Ask ARGUS Eye about this report"]');

    expect(eye?.getAttribute("aria-expanded")).toBe("false");
    act(() => eye?.click());
    expect(container.querySelector('[data-testid="argus-eye-assistant"] [aria-expanded="true"]')).toBeTruthy();
    expect(container.querySelector('[role="dialog"]')).toBeTruthy();
  });
});
