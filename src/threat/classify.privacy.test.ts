import { describe, expect, it } from "vitest";

import { classifyToken } from "./classify";

const base = () => ({
  address: "0x923d915ddf0fe60c04addac68e13f0d5af03164f", chain: "robinhood", dexId: "uniswap", symbol: "HADES", name: "Hades",
  cg: null, socials: [], findings: [], safety: {}, topHolders: [],
}) as never;

describe("privacy class", () => {
  it("is not reached from a bare name", () => {
    expect(classifyToken(base()).kind).not.toBe("privacy");
  });

  it("is reached when the linked product's own site sells private transfers", () => {
    const c = classifyToken(base(), null, { privacyProduct: true });
    expect(c.kind).toBe("privacy");
    expect(c.label).toBe("PRIVACY");
    expect(c.signals.join(" ")).toMatch(/product's own site sells private transfers/);
    expect(c.lens).toMatch(/mostly mixers and wrappers/);
  });

  it("is reached from the description and outranks utility language", () => {
    const d = { ...(base() as object), cg: { description: "A privacy protocol for private transfers across chains. Governance and staking.", categories: [], listed: true } } as never;
    expect(classifyToken(d).kind).toBe("privacy");
  });
});
