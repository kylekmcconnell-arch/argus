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
        commission: {
          earnedCents: 1_980,
          creditCents: 495,
          cashCents: 1_485,
          payableCashCents: 0,
        },
        revenueShare: {
          commissionPercent: 20,
          creditSplitPercent: 25,
          cashSplitPercent: 75,
          cashPayoutsActive: false,
        },
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
    expect(text).toContain("Investigate more.Earn when your network does.");
    expect(text).toContain("Code ARGUS123");
    expect(text).toContain("Investigation credits earned+6");
    expect(text).toContain("Cash earned$14.85");
    expect(text).toContain("20% subscription reward");
    expect(text).toContain("Cash balance is being tracked");
    expect(text).toContain("Grace");
    expect(text).toContain("••••5678");
    expect(text).not.toContain("HIDDEN5678");
    expect(text).toContain("Cash payouts are not active yet");

    const copyButton = [...node.querySelectorAll("button")].find((button) => button.textContent?.includes("Copy invite link"));
    await act(async () => { copyButton?.click(); });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining("ref=ARGUS123"));
    expect(node.textContent).toContain("Copied");
  });
});
