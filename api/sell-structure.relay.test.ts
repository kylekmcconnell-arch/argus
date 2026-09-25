import { describe, expect, it } from "vitest";

// The pass-through rule and the Robinhood infrastructure set are exercised
// through the exported helper so the netting logic is tested without a live
// Etherscan read.
import { relayAddresses } from "./sell-structure";

describe("sell-structure relay detection", () => {
  it("treats an address that receives and forwards inside one transaction, three times, as infrastructure", () => {
    const txs = [
      { hash: "0xa", from: "0xpool", to: "0xrelay", value: "5" }, { hash: "0xa", from: "0xrelay", to: "0xuser1", value: "5" },
      { hash: "0xb", from: "0xpool", to: "0xrelay", value: "5" }, { hash: "0xb", from: "0xrelay", to: "0xuser2", value: "5" },
      { hash: "0xc", from: "0xuser3", to: "0xrelay", value: "5" }, { hash: "0xc", from: "0xrelay", to: "0xpool", value: "5" },
      { hash: "0xd", from: "0xpool", to: "0xholder", value: "5" },
    ];
    expect([...relayAddresses(txs, new Set(["0xpool"]))]).toEqual(["0xrelay"]);
  });

  it("needs three hops - two round trips are a trader, not a relay", () => {
    const txs = [
      { hash: "0xa", from: "0xpool", to: "0xw", value: "5" }, { hash: "0xa", from: "0xw", to: "0xpool", value: "5" },
      { hash: "0xb", from: "0xpool", to: "0xw", value: "5" }, { hash: "0xb", from: "0xw", to: "0xpool", value: "5" },
    ];
    expect([...relayAddresses(txs, new Set(["0xpool"]))]).toEqual([]);
  });
});
