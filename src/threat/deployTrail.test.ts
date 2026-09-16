import { describe, expect, it, vi } from "vitest";
import { deployTrailReadable, readDeployTrail } from "./deployTrail";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const WALLET = "0xfdfbcae9ed23dc88757a48b2c0cc3910e6c1afa6";

describe("deployTrail", () => {
  it("knows which chains it can read", () => {
    expect(deployTrailReadable("robinhood")).toBe(true);
    expect(deployTrailReadable("ethereum")).toBe(false);
    expect(deployTrailReadable("ethereum", "key")).toBe(true);
    expect(deployTrailReadable("solana", "key")).toBe(false);
  });

  it("reads creations from Blockscout without a key and keeps only the wallet's own creations, oldest first", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      expect(url.startsWith("https://robinhoodchain.blockscout.com/api?")).toBe(true);
      expect(url).not.toContain("apikey");
      return json({ status: "1", message: "OK", result: [
        { from: WALLET, to: "", contractAddress: "0x1111111111111111111111111111111111111111", timeStamp: "1789000000" },
        { from: "0x2222222222222222222222222222222222222222", to: "", contractAddress: "0x3333333333333333333333333333333333333333", timeStamp: "1789000100" },
        { from: WALLET, to: "0x4444444444444444444444444444444444444444", contractAddress: "", timeStamp: "1789000200" },
        { from: WALLET.toUpperCase().replace("0X", "0x"), to: "", contractAddress: "0x5555555555555555555555555555555555555555", timeStamp: "1789000300" },
        { from: WALLET, to: "", contractAddress: "0x5555555555555555555555555555555555555555", timeStamp: "1789000400" },
      ] });
    });
    const trail = await readDeployTrail({ chain: "robinhood", wallet: WALLET, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(trail).toEqual([
      { address: "0x1111111111111111111111111111111111111111", at: new Date(1789000000 * 1000).toISOString() },
      { address: "0x5555555555555555555555555555555555555555", at: new Date(1789000300 * 1000).toISOString() },
    ]);
  });

  it("uses Etherscan v2 with the key on its chains and treats no transactions as a measured empty", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      expect(url.startsWith("https://api.etherscan.io/v2/api?")).toBe(true);
      expect(url).toContain("chainid=42161");
      expect(url).toContain("apikey=k");
      return json({ status: "0", message: "No transactions found", result: [] });
    });
    expect(await readDeployTrail({ chain: "arbitrum", wallet: WALLET, etherscanKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch })).toEqual([]);
  });

  it("returns null for an unreadable chain, a bad wallet, an explorer failure or an unavailable answer", async () => {
    expect(await readDeployTrail({ chain: "ethereum", wallet: WALLET })).toBeNull();
    expect(await readDeployTrail({ chain: "robinhood", wallet: "nope" })).toBeNull();
    const failing = vi.fn(async () => new Response("boom", { status: 502 }));
    expect(await readDeployTrail({ chain: "robinhood", wallet: WALLET, fetchImpl: failing as unknown as typeof fetch })).toBeNull();
    const unavailable = vi.fn(async () => json({ status: "0", message: "NOTOK", result: "Max rate limit reached" }));
    expect(await readDeployTrail({ chain: "robinhood", wallet: WALLET, fetchImpl: unavailable as unknown as typeof fetch })).toBeNull();
  });
});
