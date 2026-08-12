// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const harness = vi.hoisted(() => ({
  role: "owner",
  recordForensicEntities: vi.fn(),
}));

vi.mock("../auth-context", () => ({
  useArgusAuth: () => ({ role: harness.role }),
}));

vi.mock("../graph/store", () => ({
  recordForensicEntities: harness.recordForensicEntities,
}));

import { AddInfo } from "./AddInfo";
import { LinkEntity } from "./LinkEntity";
import { PendingEdits } from "./PendingEdits";

let container: HTMLDivElement;
let root: Root | null = null;

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    await Promise.resolve();
  });
}

async function render(component: React.ReactNode): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(component);
  });
  await settle();
}

async function setInputValue(input: HTMLInputElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function button(label: string): HTMLButtonElement {
  const match = [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find((candidate) => candidate.textContent?.trim() === label);
  if (!match) throw new Error(`Button not found: ${label}`);
  return match;
}

beforeEach(() => {
  vi.clearAllMocks();
  harness.role = "owner";
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  container?.remove();
  vi.unstubAllGlobals();
});

describe("augmentation workflow", () => {
  it("loads AddInfo by exact subject identity, hides links, and submits JSON without client attribution", async () => {
    const subject = "@Exact Founder";
    const canonicalRef = "ExactFounder";
    const subjectGraphKey = "person:exact-founder";
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        return jsonResponse({
          verified: true,
          status: "live",
          items: [{ id: "info-2", type: "github", value: "exact-founder", label: "exact-founder", by: "Kyle", at: Date.now() }],
        });
      }
      return jsonResponse({
        items: [
          { id: "info-1", type: "github", value: "existing-founder", label: "existing-founder", by: "Enigma", at: Date.now() },
          { id: "link-1", type: "link", value: "@hidden-link", label: "Hidden linked account", by: "Enigma", at: Date.now() },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await render(<AddInfo subject={subject} subjectKind="person" canonicalRef={canonicalRef} subjectGraphKey={subjectGraphKey} />);

    const expectedQuery = new URLSearchParams({ subject, subjectKind: "person", canonicalRef });
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/augment?${expectedQuery}`);
    expect(fetchMock.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);

    await act(async () => container.querySelector<HTMLButtonElement>("button[aria-expanded]")?.click());
    expect(container.textContent).toContain("existing-founder");
    expect(container.textContent).not.toContain("Hidden linked account");

    const input = container.querySelector<HTMLInputElement>("input[aria-label='GitHub to add']");
    expect(input).not.toBeNull();
    await setInputValue(input!, "  exact-founder  ");
    await act(async () => button("Submit").click());
    await settle();

    const postCall = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(postCall?.[0]).toBe("/api/augment");
    expect(postCall?.[1]?.headers).toEqual({ "content-type": "application/json" });
    const body = JSON.parse(String(postCall?.[1]?.body));
    expect(body).toEqual({
      subject,
      subjectKind: "person",
      canonicalRef,
      subjectGraphKey,
      type: "github",
      value: "exact-founder",
    });
    expect(body).not.toHaveProperty("by");
  });

  it("submits LinkEntity with the exact graph subject and records the edge under that key", async () => {
    const graphSubjectKey = "token:solana:ExactMint";
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        return jsonResponse({
          verified: true,
          status: "live",
          item: {
            id: "link-2",
            type: "link",
            kind: "x",
            rel: "same_operator",
            graphKey: "x:linked-founder",
            label: "@linked_founder",
          },
          items: [],
        });
      }
      return jsonResponse({ items: [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    await render(
      <LinkEntity
        subject="$EXACT"
        subjectKind="token"
        canonicalRef="ExactMint"
        graphSubjectKey={graphSubjectKey}
      />,
    );

    await act(async () => container.querySelector<HTMLButtonElement>("button[aria-expanded]")?.click());
    const input = container.querySelector<HTMLInputElement>("input[aria-label='X account to link']");
    expect(input).not.toBeNull();
    await setInputValue(input!, "@linked_founder");
    await act(async () => button("Link").click());
    await settle();

    const postCall = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(postCall?.[1]?.body))).toEqual({
      subject: "$EXACT",
      subjectKind: "token",
      canonicalRef: "ExactMint",
      subjectGraphKey: graphSubjectKey,
      type: "x",
      value: "@linked_founder",
      rel: "same_operator",
    });
    expect(harness.recordForensicEntities).toHaveBeenCalledWith(graphSubjectKey, [{
      key: "x:linked-founder",
      type: "Person",
      edgeType: "SAME_OPERATOR",
      label: "@linked_founder",
    }]);
  });

  it("does not render or load the approval inbox for a non-owner", async () => {
    harness.role = "analyst";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await render(<PendingEdits />);

    expect(container.innerHTML).toBe("");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("loads the owner inbox and approves by immutable augmentation id", async () => {
    const pending = {
      id: "00000000-0000-4000-8000-000000000401",
      subject: "$EXACT",
      subjectKind: "token",
      canonicalRef: "ExactMint",
      subjectGraphKey: "token:solana:ExactMint",
      type: "link",
      kind: "x",
      rel: "same_operator",
      value: "@linked_founder",
      label: "@linked_founder",
      graphKey: "x:linked-founder",
      why: "relationship needs review",
      by: "Enigma",
      at: Date.now(),
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/augment?view=pending") return jsonResponse({ pending: [pending] });
      if (url === "/api/augment?view=learnings") return jsonResponse({ learnings: [] });
      if (init?.method === "PATCH") return jsonResponse({ ok: true });
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await render(<PendingEdits />);
    expect(container.textContent).toContain("@linked_founder");
    await act(async () => button("approve").click());
    await settle();

    const patchBodies = fetchMock.mock.calls
      .filter(([, init]) => init?.method === "PATCH")
      .map(([, init]) => JSON.parse(String(init?.body)));
    expect(patchBodies).toContainEqual({ action: "approve", id: pending.id });
    expect(patchBodies.find((body) => body.action === "approve")).not.toHaveProperty("by");
    expect(harness.recordForensicEntities).toHaveBeenCalledWith(pending.subjectGraphKey, [{
      key: pending.graphKey,
      type: "Person",
      edgeType: "SAME_OPERATOR",
      label: pending.label,
    }]);
    expect(container.textContent).not.toContain("@linked_founder");
  });
});
