import { describe, expect, it } from "vitest";
import { resolveInput } from "./resolveInput";

describe("resolveInput", () => {
  it("treats an explicit cashtag as token intent, never a person handle", () => {
    expect(resolveInput("$PEPEBULL")).toEqual({
      kind: "token",
      ref: "$PEPEBULL",
      via: "ticker",
    });
    expect(resolveInput("@PEPEBULL")).toEqual({ kind: "handle", ref: "PEPEBULL" });
    expect(resolveInput("PEPEBULL")).toEqual({ kind: "handle", ref: "PEPEBULL" });
  });

  it.each(["$", "$A+B", "$THIS_TICKER_IS_FAR_TOO_LONG"])(
    "keeps invalid explicit cashtag intent out of the person runner: %s",
    (value) => {
      expect(resolveInput(value)).toMatchObject({ kind: "token" });
    },
  );

  it("preserves a canonical mixed-case Solana mint", () => {
    const mint = "52hneKeDvX3QMpysYXERquicq3QXxfVChqsEtYaLpump";
    expect(resolveInput(mint)).toEqual({ kind: "token", ref: mint, via: "solana" });
  });

  it("routes a historically case-folded Solana mint to canonical resolution", () => {
    const folded = "52hnekedvx3qmpysyxerquicq3qxxfvchqsetyalpump";
    expect(resolveInput(folded)).toEqual({
      kind: "token",
      ref: folded,
      via: "address-candidate",
    });
  });

  it("does not reinterpret an explicit long @ value as a token", () => {
    const value = "@52hneKeDvX3QMpysYXERquicq3QXxfVChqsEtYaLpump";
    expect(resolveInput(value)).toEqual({ kind: "handle", ref: value.slice(1) });
  });

  it("keeps token, DexScreener, X URL, site, and name-service routing distinct", () => {
    expect(resolveInput("0x1f9840a85d5af5bf1d1762f925bdaddc4201f984")).toMatchObject({ kind: "token", via: "evm" });
    expect(resolveInput("https://dexscreener.com/solana/abc123")).toMatchObject({ kind: "token", via: "dexscreener" });
    expect(resolveInput("https://x.com/gakonst")).toEqual({ kind: "handle", ref: "gakonst" });
    expect(resolveInput("neuro-mesh.io")).toEqual({ kind: "site", ref: "neuro-mesh.io" });
    expect(resolveInput("someone.sol")).toEqual({ kind: "handle", ref: "someone.sol" });
  });

  it("does not trust lookalike X or DexScreener hostnames", () => {
    expect(resolveInput("https://notx.com/Alice")).toEqual({ kind: "site", ref: "https://notx.com/Alice" });
    expect(resolveInput("https://notdexscreener.com/solana/abc123")).toEqual({
      kind: "site",
      ref: "https://notdexscreener.com/solana/abc123",
    });
  });

  it("requires the long-address candidate bounds", () => {
    expect(resolveInput("l".repeat(31))).toEqual({ kind: "handle", ref: "l".repeat(31) });
    expect(resolveInput("l".repeat(32))).toMatchObject({ kind: "token", via: "address-candidate" });
    expect(resolveInput("l".repeat(44))).toMatchObject({ kind: "token", via: "address-candidate" });
    expect(resolveInput("l".repeat(45))).toEqual({ kind: "handle", ref: "l".repeat(45) });
  });
});
