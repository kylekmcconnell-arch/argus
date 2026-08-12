import { describe, expect, it } from "vitest";
import type { ArkhamLabel } from "../lib/useArkhamLabels";
import { arkhamGraphEntities } from "./ArkhamGraphBridge";

const label = (overrides: Partial<ArkhamLabel>): ArkhamLabel => ({
  name: "Named entity",
  isCex: false,
  isContract: false,
  ...overrides,
});

describe("Arkham graph context", () => {
  it("keeps provider risk taxonomy out of verdict-bearing risk nodes", () => {
    const [entity] = arkhamGraphEntities({
      "0x0000000000000000000000000000000000000001": label({
        entityId: "entity-1",
        risk: {
          level: "SEVERE",
          category: "hacker",
          score: 100,
          isSeed: true,
          categoryScores: [],
          topSources: [],
        },
      }),
    });

    expect(entity).toMatchObject({
      key: "arkham-risk:0x0000000000000000000000000000000000000001",
      subtype: "arkham-provider-risk",
      edgeType: "ARKHAM_RISK_CONTEXT",
      label: expect.stringContaining("Arkham reports"),
    });
    expect(entity.key).not.toMatch(/^risk:/);
  });

  it("uses Arkham entity ids so equal display names do not collide", () => {
    const entities = arkhamGraphEntities({
      "0x0000000000000000000000000000000000000001": label({ name: "Same Name", entityId: "entity-a", type: "fund" }),
      "0x0000000000000000000000000000000000000002": label({ name: "Same Name", entityId: "entity-b", type: "fund" }),
    });

    expect(entities.map((entity) => entity.key)).toEqual([
      "arkham-entity:entity-a",
      "arkham-entity:entity-b",
    ]);
  });
});
