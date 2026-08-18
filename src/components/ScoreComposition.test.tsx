// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ScoreComposition, type CompositionRow } from "./ScoreComposition";
import { CHALLENGE_EVENT, type ChallengeDetail } from "../lib/challenge";

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
  vi.restoreAllMocks();
});

const ROWS: CompositionRow[] = [
  {
    axis: "P1_team_and_identity",
    label: "Team & identity",
    score: 14,
    weight: 25,
    rationale: "Five identities are unverifiable.",
    supportCount: 9,
    counterCount: 2,
    questionCount: 3,
  },
  {
    axis: "P2_track_record",
    label: "Track record",
    score: 17,
    weight: 20,
    rationale: "Two prior ventures went full cycle.",
  },
];

describe("ScoreComposition", () => {
  it("renders one collapsed row per dimension with its evidence anchor", () => {
    act(() => { root.render(<ScoreComposition rows={ROWS} totalScore={62} />); });

    const toggles = container.querySelectorAll('button[aria-expanded]');
    expect(toggles.length).toBe(2);
    expect([...toggles].every((toggle) => toggle.getAttribute("aria-expanded") === "false")).toBe(true);
    expect(container.textContent).toContain("Team & identity");
    expect(container.querySelector('a[href="#decision-basis-P1_team_and_identity"]')).not.toBeNull();
  });

  it("expands a row to its rationale and counts on click", () => {
    act(() => { root.render(<ScoreComposition rows={ROWS} totalScore={62} />); });

    const toggle = container.querySelector<HTMLButtonElement>('button[aria-expanded="false"]');
    act(() => toggle?.click());

    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("Five identities are unverifiable.");
    expect(container.textContent).toContain("9 sources reviewed");
    expect(container.textContent).toContain("2 disagree");
    expect(container.textContent).toContain("3 open questions");
  });

  it("dispatches the challenge event carrying the disputed dimension", () => {
    const seen: string[] = [];
    const listener = (event: Event) => {
      seen.push((event as CustomEvent<ChallengeDetail>).detail.context);
    };
    window.addEventListener(CHALLENGE_EVENT, listener);
    try {
      act(() => { root.render(<ScoreComposition rows={ROWS} totalScore={62} />); });
      const toggle = container.querySelector<HTMLButtonElement>('button[aria-expanded="false"]');
      act(() => toggle?.click());
      const challenge = [...container.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent?.trim() === "Challenge this");
      act(() => challenge?.click());

      expect(seen).toEqual(["Team & identity · scored 14/25"]);
    } finally {
      window.removeEventListener(CHALLENGE_EVENT, listener);
    }
  });

  it("renders nothing when there are no rows", () => {
    act(() => { root.render(<ScoreComposition rows={[]} totalScore={62} />); });
    expect(container.innerHTML).toBe("");
  });
});
