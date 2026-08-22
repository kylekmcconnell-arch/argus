import { describe, expect, it } from "vitest";
import {
  buildConversationReferentRegister,
  resolveConversationReferent,
  type ConversationReferent,
} from "./conversationReferents";

function packet() {
  return {
    subject: "$ARG",
    intelligence: {
      subject: { key: "project:argus", label: "Argus", entityKind: "company" },
    },
    projectAttributions: [
      { project: "Argus", name: "@ada", role: "Founder", evidenceState: "project_attributed" },
    ],
    candidateLeads: [
      { title: "Vitalik may be involved", match: "candidate" },
    ],
    investigationReasoning: {
      thesis: {
        subject: "Argus Token",
        symbol: "ARG",
        contract: "0xtoken",
      },
      projectEvidence: {
        handle: "@argus",
        name: "Argus",
        verifiedTeam: ["Ada Lovelace"],
      },
      connections: {
        tokenGraph: {
          nodes: [
            { type: "Token", key: "$ARG", label: "$ARG", subject: true },
            { type: "Person", key: "@ada", label: "Ada Lovelace" },
          ],
          edges: [],
        },
        projectGraph: { nodes: [], edges: [] },
        deployer: "0xdeployer",
        deployerTrail: {
          wallet: "0xdeployer",
          funder: { address: "0xfunder", label: "Funding wallet" },
          chain: [{ address: "0xbridge", label: "Bridge wallet" }],
        },
      },
      tokenEvidence: {
        topHolders: [{ address: "0xholder", label: "Top holder" }],
      },
    },
  };
}

describe("frozen conversation referents", () => {
  it("builds stable entity and wallet keys without admitting candidate leads", () => {
    const register = buildConversationReferentRegister(packet());

    expect(register).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "project:argus", label: "Argus", kind: "organization" }),
      expect.objectContaining({ key: "x:ada", label: "@ada", kind: "person" }),
      expect.objectContaining({ key: "0xtoken", label: "Argus Token", kind: "token" }),
      expect.objectContaining({ key: "wallet:0xdeployer", kind: "wallet", ordinal: 1 }),
      expect.objectContaining({ key: "wallet:0xfunder", kind: "wallet", ordinal: 2 }),
    ]));
    expect(register.filter((item) => item.kind === "token")).toHaveLength(1);
    expect(JSON.stringify(register)).not.toContain("Vitalik");
  });

  it("resolves a pronoun only from a prior user question naming one frozen person", () => {
    const register = buildConversationReferentRegister(packet());
    const resolution = resolveConversationReferent("What about her control?", ["What does @ada do?"], register);

    expect(resolution).toMatchObject({
      state: "resolved",
      resolved: { key: "x:ada", kind: "person" },
      requiresClarification: false,
    });
  });

  it("uses a unique frozen role for a founder follow-up", () => {
    const register = buildConversationReferentRegister(packet());
    const resolution = resolveConversationReferent("What about him?", ["Who is the founder?"], register);

    expect(resolution).toMatchObject({ state: "resolved", resolved: { key: "x:ada" } });
  });

  it("fails closed when two founders fit the same prior question", () => {
    const register: ConversationReferent[] = [
      { key: "x:ada", label: "Ada", kind: "person", aliases: ["ada", "founder", "the founder"], source: "frozen_report" },
      { key: "x:grace", label: "Grace", kind: "person", aliases: ["grace", "founder", "the founder"], source: "frozen_report" },
    ];

    expect(resolveConversationReferent("What about her?", ["Who is the founder?"], register)).toMatchObject({
      state: "ambiguous",
      requiresClarification: true,
      candidates: [{ key: "x:ada" }, { key: "x:grace" }],
    });
  });

  it("resolves wallet ordinals against frozen presentation order", () => {
    const register = buildConversationReferentRegister(packet());
    expect(resolveConversationReferent("Who controls the second wallet?", [], register)).toMatchObject({
      state: "resolved",
      resolved: { key: "wallet:0xfunder", kind: "wallet" },
    });
  });

  it("does not mistake a proposition reference for an entity reference", () => {
    expect(resolveConversationReferent("What does that imply about control?", [], buildConversationReferentRegister(packet()))).toMatchObject({
      state: "not_required",
      requiresClarification: false,
    });
  });

  it("withholds a pronoun when the frozen report contains no compatible entity", () => {
    expect(resolveConversationReferent("What did he control?", [], [])).toMatchObject({
      state: "unresolved",
      requiresClarification: true,
      candidates: [],
    });
  });

  it("does not bind a shorter handle inside a different frozen handle", () => {
    const register: ConversationReferent[] = [
      { key: "x:ada", label: "@ada", kind: "person", aliases: ["@ada"], source: "frozen_report" },
      { key: "x:adams", label: "@adams", kind: "person", aliases: ["@adams"], source: "frozen_report" },
    ];

    expect(resolveConversationReferent("What about him?", ["What does @adams control?"], register)).toMatchObject({
      state: "resolved",
      resolved: { key: "x:adams" },
    });
  });
});
