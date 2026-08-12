import { describe, expect, it } from "vitest";
import { emptyEvidence, type CollectedEvidence } from "../src/data/evidence";
import {
  excludeScoreNeutralControlReality,
  verifiedEvmControlTarget,
} from "./orchestrate";

const EVM_ADDRESS = "0x1000000000000000000000000000000000000001";

function withProjectToken(
  chain: string,
  address: string,
): CollectedEvidence {
  const evidence = emptyEvidence("@argus");
  evidence.projectToken = {
    verified: true,
    verification: "official_domain",
    name: "Argus",
    symbol: "ARG",
    rank: null,
    chain,
    address,
    sourceUrl: "https://www.coingecko.com/en/coins/argus",
    capturedAt: "2026-08-01T10:00:00.000Z",
  };
  return evidence;
}

describe("EVM control reality orchestration boundary", () => {
  it("selects only a verified canonical address on a configured EVM chain", () => {
    expect(verifiedEvmControlTarget(withProjectToken("Ethereum", EVM_ADDRESS.toUpperCase())))
      .toEqual({ chain: "ethereum", address: EVM_ADDRESS });
    expect(verifiedEvmControlTarget(withProjectToken("solana", EVM_ADDRESS))).toBeNull();
    expect(verifiedEvmControlTarget(withProjectToken("ethereum", "0x1234"))).toBeNull();
    expect(verifiedEvmControlTarget(emptyEvidence("@argus"))).toBeNull();
  });

  it("removes the score-neutral lane before a model packet is built", () => {
    const packetInput = {
      profile: { handle: "@argus" },
      projectToken: { address: EVM_ADDRESS },
      evmControlReality: {
        state: "observed",
        receipts: [{ rawResult: "0x01" }],
      },
    };

    const modelEvidence = excludeScoreNeutralControlReality(packetInput);

    expect(modelEvidence).toEqual({
      profile: { handle: "@argus" },
      projectToken: { address: EVM_ADDRESS },
    });
    expect(modelEvidence).not.toHaveProperty("evmControlReality");
  });
});
