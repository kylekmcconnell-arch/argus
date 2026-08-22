/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReferralsPage } from "./ReferralsPage";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ReferralsPage", () => {
  let root: Root;
  let node: HTMLDivElement;

  beforeEach(() => {
    node = document.createElement("div");
    document.body.appendChild(node);
    root = createRoot(node);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      access: "member",
      credit: { balance: 12 },
      referral: {
        code: "ARGUS123",
        publicName: "Ada",
        qualified: 3,
        rank: 2,
        bonusPerQualifiedReferral: 2,
        leaderboard: [{
          rank: 1,
          publicName: "Grace",
          code: "HIDDEN5678",
          access: "admitted",
          qualifiedReferrals: 4,
          paidReferrals: 0,
          revshareEarnedCents: 0,
          revsharePercent: 20,
          creditEarnedCents: 0,
          cashEarnedCents: 0,
          isCurrentUser: false,
        }],
      },
    }), { status: 200 })));
  });

  afterEach(() => {
    act(() => root.unmount());
    node.remove();
    vi.unstubAllGlobals();
  });

  it("loads a personal link and renders an access-credit leaderboard", async () => {
    await act(async () => { root.render(<ReferralsPage />); });
    await act(async () => { await Promise.resolve(); });
    const text = node.textContent || "";
    expect(text).toContain("ARGUS REFERRALS");
    expect(text).toContain("Code ARGUS123");
    expect(text).toContain("Credits earned6");
    expect(text).toContain("Grace");
    expect(text).toContain("••••5678");
    expect(text).not.toContain("HIDDEN5678");
    expect(text).not.toContain("payout");
  });
});
