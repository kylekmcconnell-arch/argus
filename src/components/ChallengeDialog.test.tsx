// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChallengeDialog } from "./ChallengeDialog";
import { requestChallenge } from "../lib/challenge";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;

const REPORT_VERSION_ID = "1d4b3030-de29-4633-a281-beb9672c4a00";

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.useFakeTimers();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

async function mountOpen() {
  await act(async () => {
    root.render(
      <ChallengeDialog subject="@definitivefi" reportVersionId={REPORT_VERSION_ID} officialDomain="definitive.fi" />,
    );
  });
  await act(async () => { requestChallenge("Funding total · 2 rounds indexed"); });
}

const setValue = async (element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) => {
  await act(async () => {
    const proto = element instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
};

describe("ChallengeDialog", () => {
  it("stays closed until a challenge event arrives, then carries the disputed context", async () => {
    await act(async () => {
      root.render(<ChallengeDialog subject="@definitivefi" reportVersionId={REPORT_VERSION_ID} officialDomain="definitive.fi" />);
    });
    expect(container.querySelector('[data-testid="challenge-dialog"]')).toBeNull();
    await act(async () => { requestChallenge("Funding total · 2 rounds indexed"); });
    const dialog = container.querySelector('[data-testid="challenge-dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog!.textContent).toContain("Funding total · 2 rounds indexed");
    expect(dialog!.textContent).toContain("What's wrong here?");
    expect(dialog!.textContent).toContain("Where did this go wrong?");
  });

  it("submits a community challenge with both fields", async () => {
    const fetchSpy = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      void input; void init;
      return jsonResponse({ ok: true, emailVerified: false });
    });
    vi.stubGlobal("fetch", fetchSpy);
    await mountOpen();
    await setValue(container.querySelector<HTMLTextAreaElement>("#challenge-whats-wrong")!, "The CTO is missing from the team list.");
    await setValue(container.querySelector<HTMLTextAreaElement>("#challenge-where-wrong")!, "Team discovery stopped at the About page.");
    const submit = [...container.querySelectorAll("button")].find((button) => button.textContent === "Submit challenge")!;
    expect(submit.hasAttribute("disabled")).toBe(false);
    await act(async () => { submit.click(); });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      action: "submit",
      role: "community",
      whatsWrong: "The CTO is missing from the team list.",
      whereWrong: "Team discovery stopped at the About page.",
    });
    expect(container.textContent).toContain("Recorded");
  });

  it("gates a team challenge on the email verification and flips on the poll", async () => {
    const fetchSpy = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("action=status")) return jsonResponse({ verified: true });
      return jsonResponse({ available: true, verificationId: "2e5c4141-ef3a-4744-b392-cfca783d5b11" });
    });
    vi.stubGlobal("fetch", fetchSpy);
    await mountOpen();
    await setValue(container.querySelector<HTMLSelectElement>("#challenge-role")!, "team");
    await setValue(container.querySelector<HTMLTextAreaElement>("#challenge-whats-wrong")!, "The funding total is stale.");

    const submit = [...container.querySelectorAll("button")].find((button) => button.textContent === "Submit challenge")!;
    expect(submit.hasAttribute("disabled")).toBe(true);
    expect(container.querySelector<HTMLInputElement>('input[type="email"]')!.placeholder).toBe("you@definitive.fi");

    await setValue(container.querySelector<HTMLInputElement>('input[type="email"]')!, "kyle@definitive.fi");
    const send = [...container.querySelectorAll("button")].find((button) => button.textContent === "Send verification email")!;
    await act(async () => { send.click(); });
    expect(container.textContent).toContain("Waiting for you to click the link");

    await act(async () => { await vi.advanceTimersByTimeAsync(4500); });
    expect(container.textContent).toContain("Verified as kyle@definitive.fi");
    const submitAfter = [...container.querySelectorAll("button")].find((button) => button.textContent === "Submit challenge")!;
    expect(submitAfter.hasAttribute("disabled")).toBe(false);
  });
});
