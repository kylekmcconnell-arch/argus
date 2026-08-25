// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  HERO_SCORE_RING_SIZE,
  ScoreRing,
  easeOutQuint,
  scoreRingCompositionPieces,
  scoreRingEntrancePlan,
  scoreRingMotionAt,
  scoreRingPieceDuration,
} from "./ScoreRing";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("scoreRingCompositionPieces", () => {
  it("uses each row.score out of 100 and does not invent equal slices", () => {
    const pieces = scoreRingCompositionPieces([
      { axis: "a", score: 14, weight: 25 },
      { axis: "b", score: 17, weight: 20 },
      { axis: "c", score: 8, weight: 20 },
    ]);

    expect(pieces.map((piece) => piece.score)).toEqual([14, 17, 8]);
    expect(pieces.map((piece) => piece.to - piece.from)).toEqual([14, 17, 8]);
    expect(pieces[0]?.from).toBe(0);
    expect(pieces[1]?.from).toBe(14);
    expect(pieces[2]?.from).toBe(31);
    expect(pieces[2]?.to).toBe(39);
    expect(new Set(pieces.map((piece) => piece.to - piece.from)).size).toBe(3);
  });

  it("skips zero-score rows and stops at a full circle", () => {
    const pieces = scoreRingCompositionPieces([
      { axis: "empty", score: 0, weight: 20 },
      { axis: "keep", score: 40, weight: 40 },
      { axis: "overflow", score: 80, weight: 40 },
    ]);

    expect(pieces.map((piece) => piece.axis)).toEqual(["keep", "overflow"]);
    expect(pieces[1]?.to).toBe(100);
    expect(pieces[1]?.to - (pieces[1]?.from ?? 0)).toBe(60);
  });
});

describe("scoreRingMotionAt", () => {
  it("holds an empty ring while awaiting, then fills real pieces before the saved numeral", () => {
    const scores = [14, 8];
    const plan = scoreRingEntrancePlan(scores);

    expect(scoreRingPieceDuration(14)).toBeGreaterThan(scoreRingPieceDuration(8));
    expect(easeOutQuint(0)).toBe(0);
    expect(easeOutQuint(1)).toBe(1);
    expect(easeOutQuint(0.5)).toBeGreaterThan(0.5);
    expect(easeOutQuint(0.8)).toBeGreaterThan(easeOutQuint(0.4));
    expect(easeOutQuint(1.4)).toBe(1);

    const awaiting = scoreRingMotionAt(-1, scores, 52);
    expect(awaiting.phase).toBe("awaiting");
    expect(awaiting.fills).toEqual([0, 0]);
    expect(awaiting.numeral).toBe(0);
    expect(awaiting.scoreArc).toBe(0);

    const afterFirst = scoreRingMotionAt(plan.pieces[0]!.end, scores, 52);
    expect(afterFirst.fills[0]).toBe(1);
    expect(afterFirst.fills[1]).toBe(0);
    expect(afterFirst.phase).toBe("pieces");
    expect(afterFirst.numeral).toBe(0);

    const numeral = scoreRingMotionAt(plan.numeralEnd, scores, 52);
    expect(numeral.fills).toEqual([1, 1]);
    expect(numeral.numeral).toBe(52);
    expect(numeral.phase).toBe("verdict");

    const done = scoreRingMotionAt(Number.POSITIVE_INFINITY, scores, 52);
    expect(done.phase).toBe("done");
    expect(done.numeral).toBe(52);
    expect(done.scoreArc).toBe(0);
    expect(done.verdict).toBe(1);
  });

  it("animates only the score arc when composition rows are missing", () => {
    const missing = scoreRingMotionAt(Number.POSITIVE_INFINITY, [], 45);
    expect(missing.fills).toEqual([]);
    expect(missing.scoreArc).toBe(1);
    expect(missing.numeral).toBe(45);

    const start = scoreRingMotionAt(0, [], 45);
    expect(start.scoreArc).toBe(0);
    expect(start.phase).toBe("track");
  });
});

describe("ScoreRing", () => {
  let root: Root;
  let container: HTMLDivElement;
  const observers: MockObserver[] = [];
  const frames: FrameRequestCallback[] = [];

  class MockObserver {
    cb: IntersectionObserverCallback;
    el: Element | null = null;
    constructor(cb: IntersectionObserverCallback) {
      this.cb = cb;
      observers.push(this);
    }
    observe(el: Element) { this.el = el; }
    unobserve() {}
    disconnect() {}
    takeRecords(): IntersectionObserverEntry[] { return []; }
    trigger(intersecting: boolean) {
      if (!this.el) return;
      this.cb([{ isIntersecting: intersecting, target: this.el } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    }
  }

  function matchMedia(matches: boolean): MediaQueryList {
    return {
      matches,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
    } as unknown as MediaQueryList;
  }

  beforeEach(() => {
    observers.length = 0;
    frames.length = 0;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.stubGlobal("IntersectionObserver", MockObserver);
    vi.stubGlobal("matchMedia", vi.fn(() => matchMedia(false)));
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps a 64px ring static even when composition rows are passed", () => {
    act(() => {
      root.render(
        <ScoreRing
          score={52}
          verdict="CAUTION"
          size={64}
          composition={[
            { axis: "a", score: 14, weight: 25 },
            { axis: "b", score: 17, weight: 20 },
          ]}
        />,
      );
    });

    expect(container.querySelector("[data-composition-piece]")).toBeNull();
    expect(container.querySelector("[data-score-arc]")).not.toBeNull();
    expect(container.querySelector("[data-score-ring-entrance]")).toBeNull();
    expect(observers).toHaveLength(0);
    expect(container.textContent).toContain("52");
  });

  it("renders composition pieces on a hero ring and counts the saved score under reduced motion", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => matchMedia(true)));
    act(() => {
      root.render(
        <ScoreRing
          score={52}
          verdict="CAUTION"
          size={HERO_SCORE_RING_SIZE}
          bands
          composition={[
            { axis: "a", score: 14, weight: 25 },
            { axis: "b", score: 17, weight: 20 },
          ]}
        >
          <p className="score-ring-verdict">Caution</p>
        </ScoreRing>,
      );
    });

    expect(container.querySelector('[data-composition-piece="a"]')).not.toBeNull();
    expect(container.querySelector('[data-composition-piece="b"]')).not.toBeNull();
    expect(container.querySelector("[data-score-arc]")).toBeNull();
    expect(container.querySelector("[data-score-ring-entrance]")?.getAttribute("data-score-ring-entrance")).toBe("done");
    expect(container.textContent).toContain("52");
    expect(container.textContent).toContain("Caution");
    expect(observers).toHaveLength(0);
  });

  it("starts the hero entrance once the ring enters view", () => {
    act(() => {
      root.render(
        <ScoreRing score={52} verdict="CAUTION" size={HERO_SCORE_RING_SIZE} bands />,
      );
    });

    expect(container.querySelector("[data-score-ring-entrance]")?.getAttribute("data-score-ring-entrance")).toBe("awaiting");
    expect(container.querySelector("[data-score-arc]")).not.toBeNull();
    expect(observers).toHaveLength(1);

    act(() => observers[0]?.trigger(true));
    act(() => { frames[0]?.(20); });
    expect(container.querySelector("[data-score-ring-entrance]")?.getAttribute("data-score-ring-entrance")).toBe("track");
  });

  it("shows the final hero state in static markup", () => {
    const html = renderToStaticMarkup(
      <ScoreRing
        score={52}
        verdict="CAUTION"
        size={HERO_SCORE_RING_SIZE}
        composition={[{ axis: "a", score: 14, weight: 25 }]}
      />,
    );
    expect(html).toContain('data-composition-piece="a"');
    expect(html).toContain(">52<");
    expect(html).toContain('width="280"');
  });
});
