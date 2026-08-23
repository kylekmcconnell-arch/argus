import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { grantManualTestCredits } from "./_growth";

describe("manual tester credit grants", () => {
  it("writes an append-only, idempotent owner grant", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const client = {
      from: vi.fn((table: string) => {
        expect(table).toBe("credit_ledger");
        return { upsert };
      }),
    } as unknown as SupabaseClient;

    await grantManualTestCredits(client, {
      organizationId: "00000000-0000-4000-8000-000000000001",
      userId: "00000000-0000-4000-8000-000000000020",
      actorUserId: "00000000-0000-4000-8000-000000000010",
      credits: 5,
      requestId: "00000000-0000-4000-8000-000000000030",
    });

    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      amount_millis: 5_000,
      reason: "manual_adjustment",
      idempotency_key: "beta-manual:00000000-0000-4000-8000-000000000020:00000000-0000-4000-8000-000000000030",
      metadata: expect.objectContaining({ grantCredits: 5 }),
    }), { onConflict: "organization_id,idempotency_key", ignoreDuplicates: true });
  });

  it("rejects a grant outside the server ceiling before touching storage", async () => {
    const from = vi.fn();
    const client = { from } as unknown as SupabaseClient;
    await expect(grantManualTestCredits(client, {
      organizationId: "org",
      userId: "user",
      actorUserId: "owner",
      credits: 50_001,
      requestId: "request",
    })).rejects.toThrow("outside the allowed range");
    expect(from).not.toHaveBeenCalled();
  });
});
