import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../supabase/migrations/20260822160000_gap_investigation_proposals.sql", import.meta.url),
  "utf8",
);

describe("gap investigation database boundary", () => {
  it("keeps authorization, proposal persistence, promotion, and rollback server-owned", () => {
    expect(migration).toContain("create table if not exists public.gap_investigations");
    expect(migration).toContain("create or replace function public.authorize_gap_investigation");
    expect(migration).toContain("create or replace function public.persist_gap_investigation_proposal_bundle");
    expect(migration).toContain("create or replace function public.promote_gap_investigation_proposal");
    expect(migration).toContain("create or replace function public.rollback_gap_investigation_proposal");
    expect(migration).toMatch(/revoke all on function public\.promote_gap_investigation_proposal[\s\S]+from public, anon, authenticated/);
  });

  it("restores the exact source projection and blocks normal proposal activation", () => {
    const restore = migration.indexOf("Restore the exact source inside this same transaction");
    const proposalUpdate = migration.indexOf("set proposed_report_version_id");
    expect(restore).toBeGreaterThan(0);
    expect(proposalUpdate).toBeGreaterThan(restore);
    expect(migration).toContain("proposed gap investigation requires explicit analyst promotion");
    expect(migration).toContain("perform public.activate_report_version_with_graph");
  });
});
