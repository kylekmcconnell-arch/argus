// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PublicAccessHome } from "./PublicAccessHome";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("PublicAccessHome", () => {
  it("keeps login and access-request paths visible without crowding the page", async () => {
    const onLogin = vi.fn();
    await act(async () => root.render(<PublicAccessHome onLogin={onLogin} onCode={vi.fn()} />));

    const login = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Log in");
    expect(login).toBeTruthy();
    expect(container.querySelector('a[href="/?view=join"]')?.textContent).toBe("Request access");

    await act(async () => login?.click());
    expect(onLogin).toHaveBeenCalledOnce();
  });

  it("normalizes and submits an early-access code", async () => {
    const onCode = vi.fn();
    await act(async () => root.render(<PublicAccessHome onLogin={vi.fn()} onCode={onCode} />));

    const input = container.querySelector<HTMLInputElement>("#early-access-code")!;
    const submit = container.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(submit.disabled).toBe(true);

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "  argus-7  ");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(input.value).toBe("  ARGUS-7  ");
    expect(submit.disabled).toBe(false);

    await act(async () => submit.click());
    expect(onCode).toHaveBeenCalledWith("ARGUS-7");
  });
});
