import { describe, expect, it } from "vitest";
import type { PanoptesEdge, PanoptesNode } from "../engine";
import type { Investigation } from "../lib/investigation";
import {
  buildAliasResolver,
  buildNetwork,
  canonical,
  reconcileVerdict,
  tokenEntityKey,
  walletEntityKey,
  type GraphContribution,
} from "./network";
import { investigationContribution, tokenContribution, walletContribution } from "./store";

const EVM_A = "0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD";
const EVM_B = "0x1111111111111111111111111111111111111111";
const EVM_C = "0x2222222222222222222222222222222222222222";
const SOL_A = "Abcdefghijkmnopqrstuvwxyz1234567";
const SOL_CASE_VARIANT = "abcdefghijkmnopqrstuvwxyz1234567";

function tokenGraph(chain: string, address: string, symbol: string, wallet?: string): { nodes: PanoptesNode[]; edges: PanoptesEdge[] } {
  const subject = tokenEntityKey(chain, address);
  const nodes: PanoptesNode[] = [{ type: "Token", key: subject, label: `$${symbol}`, symbol, subject: true }];
  const edges: PanoptesEdge[] = [];
  if (wallet) {
    const key = walletEntityKey(chain, wallet);
    nodes.push({ type: "Identity", subtype: "Wallet", key, address: wallet, chain });
    edges.push({ src: subject, dst: key, type: "DEPLOYED_BY" });
  }
  return { nodes, edges };
}

describe("address-backed token identities", () => {
  it("keeps two contracts with the same ticker as separate subjects", () => {
    const a = tokenGraph("ethereum", EVM_A, "SAME");
    const b = tokenGraph("ethereum", EVM_B, "SAME");
    const contributions: GraphContribution[] = [
      tokenContribution("SAME", "PASS", a.nodes, a.edges),
      tokenContribution("SAME", "AVOID", b.nodes, b.edges),
    ];

    expect(contributions[0].handle).toBe(tokenEntityKey("ethereum", EVM_A));
    expect(contributions[1].handle).toBe(tokenEntityKey("ethereum", EVM_B));
    // The ambiguous ticker remains a display/search term, never an identity.
    expect(buildAliasResolver(contributions)("$SAME")).toBe("$same");

    const subjects = buildNetwork([], contributions).nodes.filter((n) => n.subject);
    expect(subjects).toHaveLength(2);
    expect(new Set(subjects.map((n) => n.id))).toEqual(new Set([
      tokenEntityKey("ethereum", EVM_A),
      tokenEntityKey("ethereum", EVM_B),
    ]));
    expect(subjects.every((n) => n.key === "$SAME")).toBe(true);
  });

  it("normalizes EVM checksum case without changing the full contract", () => {
    expect(tokenEntityKey("Ethereum", EVM_A)).toBe(tokenEntityKey("ethereum", EVM_A.toLowerCase()));
    expect(canonical(`ethereum:${EVM_A}`)).toBe(walletEntityKey("ethereum", EVM_A));
  });

  it("does not let a new address-backed token absorb a legacy same-ticker record", () => {
    const current = tokenGraph("ethereum", EVM_A, "SAME");
    const contributions: GraphContribution[] = [
      tokenContribution("SAME", "PASS", current.nodes, current.edges),
      { handle: "$SAME", verdict: "AVOID", nodes: [{ type: "Company", key: "$SAME", subject: true }], edges: [] },
    ];
    expect(buildAliasResolver(contributions)("$SAME")).toBe("$same");
    expect(buildNetwork([], contributions).nodes.filter((n) => n.subject)).toHaveLength(2);
  });

  it("upgrades recoverable subject and wallet prefixes in stored investigations", () => {
    const inv = {
      token: {
        chain: "ethereum",
        address: EVM_A,
        symbol: "OLD",
        verdict: "PASS",
        deployer: EVM_B,
        topHolders: [{ address: EVM_C, percent: 12 }],
        graph: {
          nodes: [
            { type: "Company", key: "$OLD", subject: true },
            { type: "Identity", subtype: "Wallet", key: `wallet:${EVM_B.slice(0, 8)}` },
            { type: "Identity", subtype: "Wallet", key: `holder:${EVM_C.slice(0, 8)}` },
          ],
          edges: [
            { src: "$OLD", dst: `wallet:${EVM_B.slice(0, 8)}`, type: "DEPLOYED_BY" },
            { src: "$OLD", dst: `holder:${EVM_C.slice(0, 8)}`, type: "HELD_BY" },
          ],
        },
      },
      deployerTrail: null,
    } as unknown as Investigation;

    const contribution = investigationContribution(inv)!;
    expect(contribution.handle).toBe(tokenEntityKey("ethereum", EVM_A));
    expect(contribution.nodes.map((n) => n.key)).toEqual([
      tokenEntityKey("ethereum", EVM_A),
      walletEntityKey("ethereum", EVM_B),
      walletEntityKey("ethereum", EVM_C),
    ]);
    expect(contribution.edges.every((e) => !/^(?:wallet|holder):0x[0-9a-f]{6}$/i.test(e.dst))).toBe(true);
  });

  it("reconciles through a shared full-address wallet id", () => {
    const good = tokenGraph("ethereum", EVM_A, "GOOD", EVM_C);
    const bad = tokenGraph("ethereum", EVM_B, "RUG", EVM_C.toUpperCase());
    const contributions = [
      tokenContribution("GOOD", "PASS", good.nodes, good.edges),
      tokenContribution("RUG", "AVOID", bad.nodes, bad.edges),
    ];
    expect(reconcileVerdict(tokenEntityKey("ethereum", EVM_A), contributions)?.severity).toBe("avoid");
  });
});

describe("case-safe wallet identities", () => {
  it("preserves Solana case so case-distinct addresses cannot collide", () => {
    expect(SOL_A.toLowerCase()).toBe(SOL_CASE_VARIANT.toLowerCase());
    expect(walletEntityKey("solana", SOL_A)).not.toBe(walletEntityKey("solana", SOL_CASE_VARIANT));
    expect(canonical(`solana:${SOL_A}`)).toBe(walletEntityKey("solana", SOL_A));
    expect(canonical(`solana:${SOL_CASE_VARIANT}`)).toBe(walletEntityKey("solana", SOL_CASE_VARIANT));
    expect(canonical(`wallet:${SOL_A}`)).toBe(walletEntityKey("solana", SOL_A));
    expect(canonical(`wallet:${SOL_CASE_VARIANT}`)).toBe(walletEntityKey("solana", SOL_CASE_VARIANT));

    const a = tokenGraph("solana", SOL_A, "CASE", SOL_A);
    const b = tokenGraph("solana", SOL_CASE_VARIANT, "CASE", SOL_CASE_VARIANT);
    const net = buildNetwork([], [
      tokenContribution("CASE", "PASS", a.nodes, a.edges),
      tokenContribution("CASE", "PASS", b.nodes, b.edges),
    ]);
    const walletIds = net.nodes.filter((n) => n.type === "Identity").map((n) => n.id);
    expect(walletIds).toHaveLength(2);
    expect(new Set(walletIds)).toEqual(new Set([
      walletEntityKey("solana", SOL_A),
      walletEntityKey("solana", SOL_CASE_VARIANT),
    ]));
  });

  it("uses chain plus the complete address in wallet contributions", () => {
    const contribution = walletContribution("@analyst", [
      { chain: "ethereum", address: EVM_A },
      { chain: "solana", address: SOL_A },
    ]);
    expect(contribution).not.toBeNull();
    const walletKeys = contribution!.nodes.filter((n) => n.type === "Identity").map((n) => n.key);
    expect(walletKeys).toEqual([
      walletEntityKey("ethereum", EVM_A),
      walletEntityKey("solana", SOL_A),
    ]);
    expect(walletKeys.every((key) => !String(key).endsWith(EVM_A.slice(0, 8)) && !String(key).endsWith(SOL_A.slice(0, 8)))).toBe(true);
  });
});
