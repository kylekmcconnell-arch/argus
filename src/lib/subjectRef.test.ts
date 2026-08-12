import { describe, expect, it } from "vitest";
import { normalizeSubjectRef, sameSubjectRef } from "./subjectRef";

const SOLANA = "52hneKeDvX3QMpysYXERquicq3QXxfVChqsEtYaLpump";
const SOLANA_CASE_VARIANT = "52hNeKeDvX3QMpysYXERquicq3QXxfVChqsEtYaLpump";

describe("subject identity normalization", () => {
  it("preserves case-sensitive Solana identities", () => {
    expect(normalizeSubjectRef(SOLANA)).toBe(SOLANA);
    expect(sameSubjectRef(SOLANA, SOLANA_CASE_VARIANT)).toBe(false);
  });

  it("case-folds EVM addresses and human-facing aliases", () => {
    expect(normalizeSubjectRef("0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD")).toBe(
      "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
    );
    expect(normalizeSubjectRef("@$PePe")).toBe("pepe");
    expect(normalizeSubjectRef("HTTPS://Example.COM/")).toBe("example.com");
  });
});
