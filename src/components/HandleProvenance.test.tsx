// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HandleProvenance } from "./ThreatScanPage";
import { launchMs } from "../threat/launchTime";
import { parseTimeline } from "../threat/sitesafety";
import type { SiteSafety, ThreatScan } from "../threat/types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

type History = NonNullable<SiteSafety["xHistory"]>;

const renamed = (over: Partial<History> = {}): History => ({
  handle: "chequeapp",
  status: "renamed",
  priorHandles: ["oldgamblingbot"],
  handleReused: false,
  currentSince: "2026-01-12",
  lastRenameSeen: "2025-11-04",
  accounts: [{
    id: "4242",
    names: [
      { handle: "oldgamblingbot", firstSeen: "2019-03-01", lastSeen: "2025-11-04" },
      { handle: "chequeapp", firstSeen: "2026-01-12", lastSeen: "2026-09-01" },
    ],
  }],
  note: "This account previously went by @oldgamblingbot.",
  ...over,
});

const render = (h: History, launchedAt: number | null) => {
  act(() => { root.render(<HandleProvenance h={h} launchedAt={launchedAt} />); });
  return container.textContent ?? "";
};

const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

describe("HandleProvenance - the dated timeline", () => {
  it("renders every screen name with its observed window, current one marked", () => {
    const text = render(renamed(), null);
    expect(text).toContain("@oldgamblingbot");
    expect(text).toContain("2019-03-01 → 2025-11-04");
    expect(text).toContain("@chequeapp · current");
    expect(text).toContain("2026-01-12 → 2026-09-01");
    expect(text).toContain("1 prior name");
  });

  it("collapses a single-sighting window to one date rather than an empty range", () => {
    const text = render(renamed({
      accounts: [{ id: "1", names: [{ handle: "chequeapp", firstSeen: "2026-01-12", lastSeen: "2026-01-12" }] }],
    }), null);
    expect(text).toContain("2026-01-12");
    expect(text).not.toContain("→");
  });

  it("says so plainly when the archive holds a name but no dated sighting", () => {
    const text = render(renamed({
      accounts: [{ id: "1", names: [{ handle: "chequeapp", firstSeen: null, lastSeen: null }] }],
    }), null);
    expect(text).toContain("no dated sighting");
  });

  it("always states that dates are archive sightings, not rename timestamps", () => {
    expect(render(renamed(), null)).toContain("not exact rename timestamps");
  });
});

describe("HandleProvenance - the rename against the token's launch", () => {
  it("counts the days between the last old-name sighting and the launch", () => {
    // Launched 2026-01-02; last seen as the old name 2025-11-04 -> 59 days.
    const text = render(renamed(), day("2026-01-02"));
    expect(text).toContain("Still answering to a prior name on 2025-11-04");
    expect(text).toContain("59 days before this token launched");
  });

  it("calls out a rename that happened AFTER the launch", () => {
    const text = render(renamed({ lastRenameSeen: "2026-03-01" }), day("2026-01-02"));
    expect(text).toContain("58 days AFTER this token launched");
  });

  it("says nothing about proximity when the token's age is unknown", () => {
    expect(render(renamed(), null)).not.toContain("this token launched");
  });

  it("singularises a one-day gap", () => {
    const text = render(renamed({ lastRenameSeen: "2026-01-01" }), day("2026-01-02"));
    expect(text).toContain("1 day before");
  });
});

describe("HandleProvenance - a rename newer than the archive", () => {
  // Reached through the by-id lookup: the archive knows the account, but has
  // never seen it under the name it wears today.
  const unseen = renamed({
    handle: "shlok_dm",
    currentNameInArchive: false,
    currentSince: null,
    lastRenameSeen: "2026-07-02",
    accounts: [{ id: "4242", names: [{ handle: "oldgamblingbot", firstSeen: "2019-03-01", lastSeen: "2026-07-02" }] }],
  });

  it("states that the archive has no sighting of the current name at all", () => {
    const text = render(unseen, null);
    expect(text).toContain("no sighting of @shlok_dm");
    expect(text).toContain("more recent than the archive's own coverage");
  });

  it("stays quiet when the archive has seen the current name", () => {
    expect(render(renamed({ currentNameInArchive: true }), null)).not.toContain("no sighting of");
  });

  it("stays quiet on a scan frozen before the lane looked up the id", () => {
    // currentNameInArchive is absent, not false, on those cached scans.
    expect(render(renamed(), null)).not.toContain("no sighting of");
  });
});

describe("HandleProvenance - a handle that changed hands", () => {
  it("names the account ids and warns the following may not be the account's own", () => {
    const text = render(renamed({
      handleReused: true,
      accounts: [
        { id: "100", names: [{ handle: "chequeapp", firstSeen: "2014-01-01", lastSeen: "2019-01-01" }] },
        { id: "200", names: [{ handle: "somethingelse", firstSeen: "2020-01-01", lastSeen: "2025-01-01" }, { handle: "chequeapp", firstSeen: "2026-01-01", lastSeen: null }] },
      ],
    }), null);
    expect(text).toContain("account id 100");
    expect(text).toContain("account id 200");
    expect(text).toContain("worn by 2 different account ids");
    expect(text).toContain("may not belong to the account using it now");
  });
});

describe("HandleProvenance - absence is never a clean bill", () => {
  it("reports an archive miss as a gap and shows the note", () => {
    const text = render(renamed({
      status: "unknown",
      priorHandles: [],
      accounts: [],
      lastRenameSeen: null,
      note: "memory.lol has no record for @chequeapp. That is an archive gap, not a clean bill.",
    }), null);
    expect(text).toContain("no archive record");
    expect(text).toContain("not a clean bill");
  });

  it("labels a single-name account as observed, not proven", () => {
    const text = render(renamed({ status: "single", priorHandles: [], lastRenameSeen: null }), null);
    expect(text).toContain("no rename observed");
  });

  it("falls back to the note for a scan frozen before the timeline existed", () => {
    // accounts is absent on cached scans from the first release of this lane.
    const legacy = { ...renamed(), accounts: undefined } as unknown as History;
    const text = render(legacy, null);
    expect(text).toContain("This account previously went by @oldgamblingbot.");
  });
});

describe("launchMs", () => {
  it("derives the launch moment from the recorded pair age", () => {
    const scan = { scannedAt: day("2026-01-11"), dossier: { ageDays: 9 } } as unknown as ThreatScan;
    expect(launchMs(scan)).toBe(day("2026-01-02"));
  });

  it("returns null when the token's age was never established", () => {
    expect(launchMs({ scannedAt: day("2026-01-11"), dossier: {} } as unknown as ThreatScan)).toBeNull();
  });
});

describe("parseTimeline - the API response crosses the network", () => {
  it("keeps well-formed rows", () => {
    expect(parseTimeline([{ id: "7", names: [{ handle: "a", firstSeen: "2020-01-01", lastSeen: null }] }]))
      .toEqual([{ id: "7", names: [{ handle: "a", firstSeen: "2020-01-01", lastSeen: null }] }]);
  });

  it("drops entries that are not objects, and names without a handle", () => {
    expect(parseTimeline(["nope", null, 7, { id: "1", names: [{ firstSeen: "2020-01-01" }] }])).toEqual([]);
  });

  it("drops an account whose names are not an array", () => {
    expect(parseTimeline([{ id: "1", names: "lots" }])).toEqual([]);
  });

  it("coerces a missing id to an empty string rather than dropping the timeline", () => {
    expect(parseTimeline([{ names: [{ handle: "a" }] }]))
      .toEqual([{ id: "", names: [{ handle: "a", firstSeen: null, lastSeen: null }] }]);
  });

  it("returns nothing for a non-array payload", () => {
    expect(parseTimeline({ accounts: [] })).toEqual([]);
    expect(parseTimeline(undefined)).toEqual([]);
  });
});
