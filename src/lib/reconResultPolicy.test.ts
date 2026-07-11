import { describe, expect, it } from "vitest";
import { reconResultPolicy } from "./reconResultPolicy";

describe("reconResultPolicy", () => {
  it("keeps a completed private result private after the next-run toggle changes", () => {
    expect(reconResultPolicy({
      hasRecon: true,
      resultPrivate: true,
      nextRunPrivate: false,
      snapshot: false,
      persistence: { state: "private" },
    })).toEqual({
      displayedPrivate: true,
      canRecord: false,
      canMutate: false,
      panelCostToken: undefined,
    });
  });

  it("keeps a completed public result writable after private is selected for the next run", () => {
    expect(reconResultPolicy({
      hasRecon: true,
      resultPrivate: false,
      nextRunPrivate: true,
      snapshot: false,
      persistence: {
        state: "persisted",
        reportVersionId: "00000000-0000-4000-8000-000000000111",
        panelCostToken: "signed-panel-token",
      },
    })).toEqual({
      displayedPrivate: false,
      canRecord: true,
      canMutate: true,
      panelCostToken: "signed-panel-token",
    });
  });

  it("never grants snapshot evidence a mutable or paid-panel context", () => {
    expect(reconResultPolicy({
      hasRecon: true,
      resultPrivate: false,
      nextRunPrivate: false,
      snapshot: true,
      persistence: {
        state: "persisted",
        panelCostToken: "must-not-escape",
      },
    })).toMatchObject({
      displayedPrivate: false,
      canRecord: false,
      canMutate: false,
      panelCostToken: undefined,
    });
  });

  it.each(["pending", "failed"] as const)("keeps a public %s save fail-closed", (state) => {
    expect(reconResultPolicy({
      hasRecon: true,
      resultPrivate: false,
      nextRunPrivate: false,
      snapshot: false,
      persistence: { state },
    })).toMatchObject({
      displayedPrivate: false,
      canRecord: false,
      canMutate: false,
      panelCostToken: undefined,
    });
  });
});
