// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CaseBrief, CaseBriefViewer } from "../lib/caseBrief";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const harness = vi.hoisted(() => ({
  fetchCaseBrief: vi.fn(),
  fetchOlderCaseBriefRevisions: vi.fn(),
  fetchOlderCaseBriefNotes: vi.fn(),
  saveCaseBrief: vi.fn(),
  appendCaseBriefNote: vi.fn(),
}));

vi.mock("../lib/caseBrief", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/caseBrief")>();
  return {
    ...actual,
    fetchCaseBrief: harness.fetchCaseBrief,
    fetchOlderCaseBriefRevisions: harness.fetchOlderCaseBriefRevisions,
    fetchOlderCaseBriefNotes: harness.fetchOlderCaseBriefNotes,
    saveCaseBrief: harness.saveCaseBrief,
    appendCaseBriefNote: harness.appendCaseBriefNote,
  };
});

import { CaseBriefPanel } from "./CaseBriefPanel";
import { CaseBriefAnchorConflictError, CaseBriefConflictError } from "../lib/caseBrief";

const originalBrief: CaseBrief = {
  caseId: "case-token",
  revision: 2,
  anchorReportVersionId: "report-old",
  recommendation: "monitor",
  assigneeUserId: "analyst-1",
  assigneeDisplayName: "Enigma",
  dueAt: "2026-07-20T12:00:00.000Z",
  content: {
    summary: "Original summary",
    strongestEvidence: ["Liquidity is independently verified."],
    highestRisks: ["Deployer controls an adjacent wallet cluster."],
    unresolvedQuestions: ["Who controls the treasury multisig?"],
    changeConditions: ["Verified multisig signers would improve confidence."],
    nextActions: ["Verify treasury signers."],
  },
  createdByUserId: "owner-1",
  createdByDisplayName: "Kyle",
  createdAt: "2026-07-10T12:00:00.000Z",
  updatedByUserId: "analyst-1",
  updatedByDisplayName: "Enigma",
  updatedAt: "2026-07-10T14:00:00.000Z",
};

function viewer(overrides: Partial<CaseBriefViewer> = {}): CaseBriefViewer {
  return {
    case: {
      caseId: "case-token",
      kind: "token",
      ref: "ExactContractAddress",
      query: "$EXACT",
      status: "open",
      currentReportVersionId: "report-current",
      updatedAt: "2026-07-11T10:00:00.000Z",
    },
    currentVersion: {
      reportVersionId: "report-current",
      version: 4,
      verdict: "FAIL",
      score: 24,
      completenessState: "complete",
      attestationState: "server_collected",
      methodologyVersion: "argus-v4",
      contributor: "Kyle",
      createdAt: "2026-07-11T10:00:00.000Z",
    },
    anchorVersions: [{
      reportVersionId: "report-current",
      version: 4,
      verdict: "FAIL",
      score: 24,
      completenessState: "complete",
      attestationState: "server_collected",
      methodologyVersion: "argus-v4",
      contributor: "Kyle",
      createdAt: "2026-07-11T10:00:00.000Z",
    }, {
      reportVersionId: "report-old",
      version: 2,
      verdict: "CAUTION",
      score: 61,
      completenessState: "partial",
      attestationState: "server_collected",
      methodologyVersion: "argus-v3",
      contributor: "Enigma",
      createdAt: "2026-07-10T12:00:00.000Z",
    }],
    brief: originalBrief,
    hasNewEvidence: true,
    hasOlderRevisions: false,
    revisions: [{
      id: "revision-2",
      caseId: "case-token",
      revision: 2,
      anchorReportVersionId: "report-old",
      recommendation: "monitor",
      assigneeUserId: "analyst-1",
      assigneeDisplayName: "Enigma",
      dueAt: originalBrief.dueAt,
      content: originalBrief.content,
      createdByUserId: "analyst-1",
      authorDisplayName: "Enigma",
      createdAt: originalBrief.updatedAt,
    }],
    notes: [{
      id: "note-1",
      caseId: "case-token",
      clientId: "client-note-1",
      body: "Waiting on treasury signer evidence.",
      createdByUserId: "analyst-1",
      createdAt: "2026-07-10T15:00:00.000Z",
      authorDisplayName: "Enigma",
    }],
    hasOlderNotes: false,
    assignees: [
      { userId: "owner-1", displayName: "Kyle", role: "owner" },
      { userId: "analyst-1", displayName: "Enigma", role: "analyst" },
    ],
    canEdit: true,
    currentUserId: "owner-1",
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    await Promise.resolve();
  });
}

async function renderPanel(onClose = vi.fn()): Promise<typeof onClose> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<CaseBriefPanel target={{ caseId: "case-token" }} onClose={onClose} />);
  });
  await settle();
  return onClose;
}

async function setControlValue(control: HTMLTextAreaElement | HTMLSelectElement, value: string): Promise<void> {
  const prototype = control instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLTextAreaElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  await act(async () => {
    setter?.call(control, value);
    control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}

function button(label: string): HTMLButtonElement {
  const match = [...container.querySelectorAll<HTMLButtonElement>("button")].find((candidate) => candidate.textContent?.trim() === label);
  if (!match) throw new Error(`Button not found: ${label}`);
  return match;
}

beforeEach(() => {
  vi.clearAllMocks();
  harness.fetchCaseBrief.mockResolvedValue(viewer());
  harness.fetchOlderCaseBriefRevisions.mockResolvedValue({ revisions: [], anchorVersions: [], hasOlderRevisions: false });
  harness.fetchOlderCaseBriefNotes.mockResolvedValue({ notes: [], hasOlderNotes: false });
  harness.saveCaseBrief.mockImplementation(async (input: { expectedRevision: number; anchorReportVersionId: string; recommendation: string }) => {
    const saved: CaseBrief = {
      ...originalBrief,
      revision: input.expectedRevision + 1,
      anchorReportVersionId: input.anchorReportVersionId,
      recommendation: input.recommendation as CaseBrief["recommendation"],
      updatedAt: "2026-07-11T11:00:00.000Z",
    };
    harness.fetchCaseBrief.mockResolvedValue(viewer({
      brief: saved,
      hasNewEvidence: saved.anchorReportVersionId !== "report-current",
      revisions: [{
        id: `revision-${saved.revision}`,
        caseId: saved.caseId,
        revision: saved.revision,
        anchorReportVersionId: saved.anchorReportVersionId,
        recommendation: saved.recommendation,
        assigneeUserId: saved.assigneeUserId,
        assigneeDisplayName: saved.assigneeDisplayName,
        dueAt: saved.dueAt,
        content: saved.content,
        createdByUserId: saved.updatedByUserId,
        authorDisplayName: saved.updatedByDisplayName,
        createdAt: saved.updatedAt,
      }, ...viewer().revisions],
    }));
    return saved;
  });
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  vi.restoreAllMocks();
});

describe("CaseBriefPanel", () => {
  it("keeps the human recommendation separate and requires explicit evidence re-anchoring", async () => {
    await renderPanel();

    expect(container.textContent).toContain("Current ARGUS report");
    expect(container.textContent).toContain("v4 · FAIL · 24");
    expect(container.textContent).toContain("v2 · CAUTION · 61");
    expect(container.textContent).toContain("Analyst recommendation");
    expect(container.textContent).toContain("A newer report is available");
    expect(container.textContent).toContain("Waiting on treasury signer evidence.");
    expect(container.querySelector<HTMLAnchorElement>("a[href='?version=report-old']")?.target).toBe("_blank");
    expect(container.querySelector<HTMLAnchorElement>("a[href='?version=report-current']")?.textContent).toContain("Review current report v4");

    await act(async () => button("Re-anchor to v4").click());
    expect(button("Keep existing anchor").getAttribute("aria-pressed")).toBe("true");
    await act(async () => button("Keep existing anchor").click());
    expect(button("Re-anchor to v4").getAttribute("aria-pressed")).toBe("false");
    await act(async () => button("Re-anchor to v4").click());
    await setControlValue(container.querySelector<HTMLSelectElement>("select")!, "advance");
    await act(async () => button("Save new revision").click());
    await settle();

    expect(harness.saveCaseBrief).toHaveBeenCalledWith(expect.objectContaining({
      caseId: "case-token",
      expectedRevision: 2,
      anchorReportVersionId: "report-current",
      reanchor: true,
      recommendation: "advance",
    }));
    expect(container.textContent).toContain("Revision 3 saved");
  });

  it("preserves the local draft through a revision conflict and protects close", async () => {
    const currentServerBrief: CaseBrief = {
      ...originalBrief,
      revision: 3,
      anchorReportVersionId: "report-current",
      recommendation: "decline",
      assigneeUserId: "owner-1",
      assigneeDisplayName: "Kyle",
      dueAt: "2026-07-25T12:00:00.000Z",
      content: { ...originalBrief.content, summary: "Someone else's summary" },
      updatedAt: "2026-07-11T10:30:00.000Z",
    };
    harness.saveCaseBrief.mockRejectedValueOnce(new CaseBriefConflictError("Conflict", currentServerBrief));
    const onClose = await renderPanel();
    const summary = [...container.querySelectorAll<HTMLTextAreaElement>("textarea")].find((item) => item.maxLength === 4000)!;
    await setControlValue(summary, "My local decision draft");
    await act(async () => button("Save new revision").click());
    await settle();

    expect(summary.value).toBe("My local decision draft");
    expect(container.textContent).toContain("local draft preserved");
    expect(container.textContent).toContain("Compare with current server revision 3");
    expect(container.textContent).toContain("Server recommendation");
    expect(container.textContent).toContain("Decline");
    expect(container.textContent).toContain("Server assignee");
    expect(container.textContent).toContain("2026-07-25");
    expect(container.textContent).not.toContain("New evidence is available");

    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await act(async () => container.querySelector<HTMLButtonElement>("[aria-label='Close case brief']")!.click());
    expect(onClose).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await act(async () => container.querySelector<HTMLButtonElement>("[aria-label='Close case brief']")!.click());
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("requires an explicit evidence-basis choice before retrying a conflict", async () => {
    const currentServerBrief: CaseBrief = {
      ...originalBrief,
      revision: 3,
      anchorReportVersionId: "report-current",
      content: { ...originalBrief.content, summary: "Current server summary" },
    };
    harness.saveCaseBrief.mockRejectedValueOnce(new CaseBriefConflictError("Conflict", currentServerBrief));
    await renderPanel();
    const summary = [...container.querySelectorAll<HTMLTextAreaElement>("textarea")].find((item) => item.maxLength === 4000)!;
    await setControlValue(summary, "My preserved synthesis");
    await act(async () => button("Save new revision").click());
    await settle();

    const retry = button("Save my draft as next revision");
    expect(retry.disabled).toBe(true);
    expect(container.textContent).toContain("will not attach your analysis to that anchor silently");

    await act(async () => button("Use server basis").click());
    expect(retry.disabled).toBe(false);
    expect(container.textContent).toContain("current server basis is now selected explicitly");
    await act(async () => retry.click());
    await settle();

    expect(harness.saveCaseBrief).toHaveBeenNthCalledWith(2, expect.objectContaining({
      expectedRevision: 3,
      anchorReportVersionId: "report-current",
      reanchor: false,
      content: expect.objectContaining({ summary: "My preserved synthesis" }),
    }));
    expect(container.textContent).toContain("Revision 4 saved");
    expect(container.textContent).toContain("Revision 3");
    expect(container.textContent).toContain("Revision 4");
  });

  it("reuses the same UUID when an append-only note request is retried", async () => {
    harness.appendCaseBriefNote
      .mockRejectedValueOnce(new Error("Response lost"))
      .mockResolvedValueOnce({
        id: "note-2",
        caseId: "case-token",
        clientId: "server-client-id",
        body: "Treasury signer verified.",
        createdByUserId: "owner-1",
        createdAt: "2026-07-11T11:30:00.000Z",
        authorDisplayName: "Kyle",
      });
    await renderPanel();
    const note = container.querySelector<HTMLTextAreaElement>("#case-brief-note")!;
    await setControlValue(note, "Treasury signer verified.");

    await act(async () => button("Append note").click());
    await settle();
    await act(async () => button("Append note").click());
    await settle();

    const firstClientId = harness.appendCaseBriefNote.mock.calls[0][0].clientId;
    const secondClientId = harness.appendCaseBriefNote.mock.calls[1][0].clientId;
    expect(firstClientId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(secondClientId).toBe(firstClientId);
    expect(container.textContent).toContain("Note appended to the case history");
  });

  it("protects an unsent note draft from accidental close", async () => {
    const onClose = await renderPanel();
    const note = container.querySelector<HTMLTextAreaElement>("#case-brief-note")!;
    await setControlValue(note, "Do not lose this handoff note.");

    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await act(async () => container.querySelector<HTMLButtonElement>("[aria-label='Close case brief']")!.click());

    expect(confirm).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(note.value).toBe("Do not lose this handoff note.");
  });

  it("refreshes a newer evidence anchor without discarding local analysis", async () => {
    const latest = viewer({
      currentVersion: {
        ...viewer().currentVersion!,
        reportVersionId: "report-v5",
        version: 5,
      },
    });
    harness.fetchCaseBrief
      .mockResolvedValueOnce(viewer())
      .mockResolvedValueOnce(latest);
    harness.saveCaseBrief.mockRejectedValueOnce(new CaseBriefAnchorConflictError("New evidence won the race."));
    await renderPanel();
    const summary = [...container.querySelectorAll<HTMLTextAreaElement>("textarea")].find((item) => item.maxLength === 4000)!;
    await setControlValue(summary, "My still-valid local synthesis");
    await act(async () => button("Re-anchor to v4").click());
    await act(async () => button("Save new revision").click());
    await settle();

    expect(summary.value).toBe("My still-valid local synthesis");
    expect(container.textContent).toContain("newer report version was published first");
    expect(button("Re-anchor to v5").getAttribute("aria-pressed")).toBe("false");
  });

  it("treats a deactivated historical assignee as unassigned on the next save", async () => {
    harness.fetchCaseBrief.mockResolvedValue(viewer({
      assignees: [{ userId: "owner-1", displayName: "Kyle", role: "owner" }],
    }));
    await renderPanel();

    expect(container.textContent).toContain("Historical assignee: Enigma");
    const assignee = [...container.querySelectorAll<HTMLSelectElement>("select")]
      .find((select) => [...select.options].some((option) => option.textContent === "Unassigned"))!;
    expect(assignee.value).toBe("");
    const summary = [...container.querySelectorAll<HTMLTextAreaElement>("textarea")].find((item) => item.maxLength === 4000)!;
    await setControlValue(summary, "Updated synthesis after ownership handoff");
    await act(async () => button("Save new revision").click());
    await settle();

    expect(harness.saveCaseBrief).toHaveBeenCalledWith(expect.objectContaining({ assigneeUserId: null }));
  });

  it("preserves a precise stored due timestamp when only analysis text changes", async () => {
    const preciseDueAt = "2026-07-20T18:45:30.000Z";
    harness.fetchCaseBrief.mockResolvedValue(viewer({
      brief: { ...originalBrief, dueAt: preciseDueAt },
    }));
    await renderPanel();
    const summary = [...container.querySelectorAll<HTMLTextAreaElement>("textarea")].find((item) => item.maxLength === 4000)!;
    await setControlValue(summary, "Updated without changing the review date");
    await act(async () => button("Save new revision").click());
    await settle();

    expect(harness.saveCaseBrief).toHaveBeenCalledWith(expect.objectContaining({ dueAt: preciseDueAt }));
  });

  it("loads older immutable revisions and notes without replacing the current snapshot", async () => {
    harness.fetchCaseBrief.mockResolvedValue(viewer({
      hasOlderRevisions: true,
      hasOlderNotes: true,
    }));
    harness.fetchOlderCaseBriefRevisions.mockResolvedValue({
      revisions: [{
        ...viewer().revisions[0],
        id: "revision-1",
        revision: 1,
        content: { ...originalBrief.content, summary: "First decision record" },
        createdAt: "2026-07-09T12:00:00.000Z",
      }],
      anchorVersions: [],
      hasOlderRevisions: false,
    });
    harness.fetchOlderCaseBriefNotes.mockResolvedValue({
      notes: [{
        ...viewer().notes[0],
        id: "note-old",
        clientId: "client-note-old",
        body: "Original analyst handoff.",
        createdAt: "2026-07-09T13:00:00.000Z",
      }],
      hasOlderNotes: false,
    });
    await renderPanel();

    await act(async () => button("Load older append-only notes").click());
    await settle();
    await act(async () => button("Load older versions").click());
    await settle();

    expect(harness.fetchOlderCaseBriefNotes).toHaveBeenCalledWith("case-token", {
      createdAt: "2026-07-10T15:00:00.000Z",
      id: "note-1",
    });
    expect(harness.fetchOlderCaseBriefRevisions).toHaveBeenCalledWith("case-token", 2);
    expect(container.textContent).toContain("Original analyst handoff.");
    expect(container.textContent).toContain("Revision 1");
    expect(container.textContent).not.toContain("Load older append-only notes");
  });

  it("renders archived cases as read-only history", async () => {
    harness.fetchCaseBrief.mockResolvedValue(viewer({
      case: { ...viewer().case, status: "archived" },
      canEdit: false,
    }));
    await renderPanel();

    expect(container.textContent).toContain("Archived · read only");
    expect(container.textContent).toContain("Archived case · read-only history");
    expect([...container.querySelectorAll("button")].some((item) => item.textContent?.includes("Save new revision"))).toBe(false);
    expect(container.querySelector<HTMLTextAreaElement>("#case-brief-note")).toBeNull();
  });
});
