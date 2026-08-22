/** @vitest-environment jsdom */

import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { ReferralLeaderboard } from "./ReferralLeaderboard";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ReferralLeaderboard", () => {
  let root: Root | null = null;
  let node: HTMLDivElement | null = null;

  afterEach(() => {
    if (root && node) {
      act(() => { root?.unmount(); });
      node.remove();
    }
    root = null;
    node = null;
  });

  it("renders Fomo-style rank, referrer, credit, and access columns without cash", () => {
    node = document.createElement("div");
    document.body.appendChild(node);
    root = createRoot(node);
    act(() => {
      root?.render(
        <ReferralLeaderboard
          empty="none"
          rows={[{
            rank: 1,
            publicName: "Enigma",
            access: "admitted",
            qualifiedReferrals: 8,
            paidReferrals: 1,
            revshareEarnedCents: 1980,
            revsharePercent: 20,
            creditEarnedCents: 495,
            cashEarnedCents: 1485,
            isCurrentUser: true,
          }]}
        />,
      );
    });
    const text = node.textContent || "";
    expect(text).toContain("#1");
    expect(text).toContain("Enigma · you");
    expect(text).toContain("Live access");
    expect(text).toContain("Credits earned");
    expect(text).toContain("16");
    expect(text).not.toContain("Cash");
    expect(text).not.toContain("Revshare");
  });
});
