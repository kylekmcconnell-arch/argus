// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LiveSupplementalNotice, SnapshotEvidenceControl } from "./SnapshotEvidenceControl";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function SnapshotHarness() {
  return (
    <SnapshotEvidenceControl
      snapshotVersion={4}
      capturedAt="2026-07-11T14:30:00.000Z"
    />
  );
}

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<SnapshotHarness />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("SnapshotEvidenceControl", () => {
  it("keeps current panels paused behind an explicit snapshot control", () => {
    expect(container.querySelector("section")?.getAttribute("aria-label")).toBe("Snapshot v4 evidence mode");
    expect(container.textContent).toContain("SNAPSHOT v4");
    expect(container.textContent).toContain("Captured charts are shown below.");
    expect(container.textContent).toContain("Live refreshes are paused");
    expect(container.querySelector("time")?.getAttribute("dateTime")).toBe("2026-07-11T14:30:00.000Z");
    expect(container.querySelector("time")?.textContent).toContain("captured");
    expect(container.querySelector<HTMLButtonElement>("button")?.textContent?.trim()).toBe("Refresh live intelligence");
    expect(container.querySelector("[role='status']")).toBeNull();
  });

  it("labels enabled intelligence as current and outside the stored verdict", async () => {
    await act(async () => container.querySelector<HTMLButtonElement>("button")?.click());

    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector("[role='status']")?.textContent?.trim()).toBe(
      "Current intelligence · fetched now · not part of snapshot v4 · does not change stored verdict",
    );
  });

  it("nudges a re-scan on snapshots captured before the recall engine upgrades", () => {
    // The default harness snapshot (2026-07-11) predates the 2026-07-21 recall
    // ship, so the reader is told a fresh run answers more -- while the frozen
    // verdict itself is explicitly unchanged.
    const note = container.querySelector("[role='note']");
    expect(note?.textContent).toContain("predates upgrades");
    expect(note?.textContent).toContain("verdict is unchanged");
  });

  it("names person-specific upgrades without irrelevant token language", async () => {
    await act(async () => root.render(
      <SnapshotEvidenceControl
        snapshotVersion={4}
        capturedAt="2026-07-11T14:30:00.000Z"
        subjectKind="person"
      />,
    ));

    const note = container.querySelector("[role='note']")?.textContent ?? "";
    expect(note).toContain("identity recall");
    expect(note).toContain("role corroboration");
    expect(note).not.toContain("float-control");
  });

  it("shows no staleness nudge on a post-upgrade snapshot", async () => {
    await act(async () => root.render(
      <SnapshotEvidenceControl snapshotVersion={9} capturedAt="2026-07-22T04:00:00.000Z" />,
    ));
    expect(container.querySelector("[role='note']")).toBeNull();
    expect(container.textContent).toContain("SNAPSHOT v9");
  });
});

describe("LiveSupplementalNotice", () => {
  it("keeps live post-scan evidence outside the immutable share and verdict", async () => {
    await act(async () => root.render(<LiveSupplementalNotice persisted />));

    expect(container.querySelector("[role='status']")?.textContent).toContain("fetched after the core scan");
    expect(container.textContent).toContain("not included in the immutable Share payload or scored verdict");
  });

  it("labels private supplemental panels as paused and unsaved", async () => {
    await act(async () => root.render(<LiveSupplementalNotice private />));

    expect(container.textContent).toContain("supplemental panels are paused");
    expect(container.textContent).toContain("avoid shared cache traces");
    expect(container.textContent).toContain("not saved to a case");
  });

  it("does not imply an immutable share exists before persistence", async () => {
    await act(async () => root.render(<LiveSupplementalNotice />));

    expect(container.textContent).toContain("not included in a saved Share payload");
    expect(container.textContent).not.toContain("immutable Share payload");
  });
});
