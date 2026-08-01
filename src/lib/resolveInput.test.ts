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

  it("extracts the handle from an X profile URL with a leading @ in the path", () => {
    expect(resolveInput("x.com/@gakonst")).toEqual({ kind: "handle", ref: "gakonst" });
    expect(resolveInput("https://x.com/@gakonst")).toEqual({ kind: "handle", ref: "gakonst" });
    expect(resolveInput("https://twitter.com/@gakonst")).toEqual({ kind: "handle", ref: "gakonst" });
    // Stripping the @ must not resurrect non-profile paths as handles.
    expect(resolveInput("https://x.com/@home")).toEqual({ kind: "site", ref: "https://x.com/@home" });
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

/**
 * Polymarket trader profiles. The wallet in a profile link and an EVM token
 * contract are the same 40 hex characters, so the ONLY thing separating them is
 * the link the poster published. Every case below exists to pin that line: the
 * path routes to the trader lane, the bare address does not, and neither moves
 * without failing a test here.
 */
describe("resolveInput: Polymarket profiles", () => {
  const WALLET = "0x4989bfed5900ba096b08ba1f9b718464527c983e";

  it("routes a Polymarket profile link to the trader lane as a lowercase wallet", () => {
    expect(resolveInput(`https://polymarket.com/profile/${WALLET}`)).toEqual({ kind: "polymarket", ref: WALLET });
    expect(resolveInput(`polymarket.com/profile/${WALLET}`)).toEqual({ kind: "polymarket", ref: WALLET });
    expect(resolveInput(`https://www.polymarket.com/profile/${WALLET}/`)).toEqual({ kind: "polymarket", ref: WALLET });
    expect(resolveInput(`https://polymarket.com/profile/${WALLET.toUpperCase().replace("0X", "0x")}`)).toEqual({
      kind: "polymarket",
      ref: WALLET,
    });
  });

  it("keeps a bare EVM address on the token lane", () => {
    // The regression this guard exists for. An EVM contract address is by far
    // the most common thing pasted into this box, and it is indistinguishable
    // from a Polymarket wallet offline. Only a published profile path is
    // evidence of trader intent, so a bare address must not move.
    expect(resolveInput(WALLET)).toEqual({ kind: "token", ref: WALLET, via: "evm" });
    // Uniswap's UNI, a real contract, checked with its live checksum casing.
    expect(resolveInput("0x1f9840a85d5af5bf1d1762f925bdaddc4201f984")).toMatchObject({ kind: "token", via: "evm" });
    expect(resolveInput("0x1F9840a85d5aF5bf1D1762F925BDADdC4201F984")).toMatchObject({ kind: "token", via: "evm" });
    // And a DexScreener link for an EVM pair still resolves as a token.
    expect(resolveInput(`https://dexscreener.com/ethereum/${WALLET}`)).toMatchObject({
      kind: "token",
      via: "dexscreener",
    });
  });

  it("does not trust a profile path on a lookalike host", () => {
    // A wallet in somebody else's path was never published by Polymarket as
    // that trader's, so attaching a stranger's record to it is the one mistake
    // this lane cannot make.
    expect(resolveInput(`https://notpolymarket.com/profile/${WALLET}`)).toEqual({
      kind: "site",
      ref: `https://notpolymarket.com/profile/${WALLET}`,
    });
    expect(resolveInput(`https://polymarket.com.evil.example/profile/${WALLET}`)).toMatchObject({ kind: "site" });
  });

  it("sends every other Polymarket page to site recon, not to the trader lane", () => {
    expect(resolveInput("https://polymarket.com")).toEqual({ kind: "site", ref: "https://polymarket.com" });
    expect(resolveInput("https://polymarket.com/markets")).toEqual({ kind: "site", ref: "https://polymarket.com/markets" });
    // A handle in a profile path is not a wallet and is never guessed into one.
    expect(resolveInput("https://polymarket.com/profile/macau.weather")).toMatchObject({ kind: "site" });
  });
});
