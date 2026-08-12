import { describe, expect, it } from "vitest";
import { arkhamOf, type ArkhamLabel } from "./useArkhamLabels";
import { providerAddressKey } from "./providerAddress";

const SOLANA_ADDRESS = "SoLanaMixedCaseAddress111111111111111111111";
const EVM_ADDRESS = `0x${"AbCd".repeat(10)}`;
const label: ArkhamLabel = {
  name: "Known operator",
  isCex: false,
  isContract: false,
};

describe("provider address identity", () => {
  it("preserves case-sensitive base58 keys and keeps case variants distinct", () => {
    expect(providerAddressKey(SOLANA_ADDRESS)).toBe(SOLANA_ADDRESS);
    expect(providerAddressKey(SOLANA_ADDRESS.toLowerCase())).toBe(SOLANA_ADDRESS.toLowerCase());
    expect(providerAddressKey(SOLANA_ADDRESS)).not.toBe(providerAddressKey(SOLANA_ADDRESS.toLowerCase()));

    expect(arkhamOf({ [SOLANA_ADDRESS]: label }, SOLANA_ADDRESS)).toBe(label);
    expect(arkhamOf({ [SOLANA_ADDRESS]: label }, SOLANA_ADDRESS.toLowerCase())).toBeUndefined();
  });

  it("normalizes EVM keys and lookups to lowercase", () => {
    const expected = EVM_ADDRESS.toLowerCase();
    expect(providerAddressKey(EVM_ADDRESS)).toBe(expected);
    expect(arkhamOf({ [expected]: label }, EVM_ADDRESS)).toBe(label);
  });
});
