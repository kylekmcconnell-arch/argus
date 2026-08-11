import { describe, expect, it } from "vitest";

import { projectLinks } from "./links";

const base = {
  address: "0xb2ece11a988a54a79675d4b827fc9ac419fb4ba3",
  chain: "base",
  pairAddress: "0xPAIR",
  socials: [
    { label: "Website", url: "https://kupo.gg" },
    { label: "twitter", url: "https://x.com/kupo_gg" },
    { label: "telegram", url: "https://t.me/kupoterminal" },
    { label: "docs", url: "https://docs.kupo.gg" },
  ],
  cg: { listed: true, id: "kupo-terminal", homepage: "https://kupo.gg", twitter: "kupo_gg" },
} as never;

describe("projectLinks", () => {
  it("returns the pertinent links in Enigma's order", () => {
    const labels = projectLinks(base).map((l) => l.label);
    expect(labels).toEqual(["Website", "X", "Telegram", "DexScreener", "CoinGecko", "CMC", "Defined.fi", "Whitepaper"]);
  });

  it("builds DexScreener from the pair, CMC dexscan and Defined from chain maps", () => {
    const byLabel = Object.fromEntries(projectLinks(base).map((l) => [l.label, l.url]));
    expect(byLabel.DexScreener).toBe("https://dexscreener.com/base/0xPAIR");
    expect(byLabel.CMC).toBe("https://coinmarketcap.com/dexscan/base/0xPAIR/");
    expect(byLabel["Defined.fi"]).toBe("https://www.defined.fi/base/0xb2ece11a988a54a79675d4b827fc9ac419fb4ba3");
    expect(byLabel.CoinGecko).toBe("https://www.coingecko.com/en/coins/kupo-terminal");
  });

  it("falls back to CoinGecko homepage/twitter when DexScreener socials are bare", () => {
    const d = { ...(base as object), socials: [] } as never;
    const byLabel = Object.fromEntries(projectLinks(d).map((l) => [l.label, l.url]));
    expect(byLabel.Website).toBe("https://kupo.gg");
    expect(byLabel.X).toBe("https://x.com/kupo_gg");
  });

  it("omits unmapped chains (robinhood has no CMC/Defined page) instead of guessing", () => {
    const d = { ...(base as object), chain: "robinhood", cg: null, socials: [] } as never;
    const labels = projectLinks(d).map((l) => l.label);
    expect(labels).toEqual(["DexScreener"]);
  });

  it("surfaces YouTube and LinkedIn when the project links them", () => {
    const d = { ...(base as object), socials: [
      { label: "youtube", url: "https://youtube.com/@kupo" },
      { label: "linkedin", url: "https://linkedin.com/company/kupo" },
    ] } as never;
    const labels = projectLinks(d).map((l) => l.label);
    expect(labels).toContain("YouTube");
    expect(labels).toContain("LinkedIn");
  });
});
