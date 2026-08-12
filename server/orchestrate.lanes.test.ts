import { describe, expect, it } from "vitest";
import {
  ADAPTER_PROVIDERS,
  ADAPTERS_FOR_TEST,
  IDENTITY_LANE,
  TOKEN_LANE,
  WALLET_LANE,
} from "./orchestrate";

// The lane schedule replaces the serial adapter loop. These guards make the
// two catastrophic drift modes loud: an adapter added to the registry but
// never scheduled (silently skipped evidence), and two concurrent lanes
// sharing a cost-ledger provider (cross-attributed attempt accounting that
// corrupts the provider-truth checklist).
describe("adapter lane schedule", () => {
  it("partitions the full adapter registry across the lanes plus basic-facts", () => {
    const scheduled = [
      ...IDENTITY_LANE,
      ...TOKEN_LANE,
      ...WALLET_LANE,
    ].map((adapter) => adapter.id).concat("basic-facts").sort();
    expect(scheduled).toEqual(ADAPTERS_FOR_TEST.map((adapter) => adapter.id).sort());
  });

  it("keeps concurrent lanes disjoint in cost-ledger providers", () => {
    const laneProviders = (lane: readonly { id: string }[]) => new Set(
      lane.flatMap((adapter) => ADAPTER_PROVIDERS[adapter.id] ?? []));
    const lanes = [laneProviders(IDENTITY_LANE), laneProviders(TOKEN_LANE), laneProviders(WALLET_LANE)];
    for (let i = 0; i < lanes.length; i++) {
      for (let j = i + 1; j < lanes.length; j++) {
        const overlap = [...lanes[i]].filter((provider) => lanes[j].has(provider));
        expect(overlap).toEqual([]);
      }
    }
  });

  it("gives every concurrently-scheduled adapter a provider filter", () => {
    for (const adapter of [...IDENTITY_LANE, ...TOKEN_LANE, ...WALLET_LANE]) {
      expect(ADAPTER_PROVIDERS[adapter.id], `${adapter.id} missing from ADAPTER_PROVIDERS`).toBeDefined();
    }
  });
});
