// Migrate.fun migration detection (#5). A migrated token has a NEW mint (the
// chart restarted) and its claim distribution reads like a bundle — so knowing a
// token came out of a migration prevents both false positives (stale-age, bundle)
// and adds real context. Detection is proven on-chain in api/migration.ts (reads
// the migration program's project accounts). Solana only.

import type { MigrationInfo } from "./types";
import { apiFetch } from "./net";

export async function migrationCheck(chain: string, address: string): Promise<MigrationInfo | null> {
  if (chain !== "solana") return null;
  try {
    const res = await apiFetch(`/api/migration?address=${encodeURIComponent(address)}`, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) return null;
    const d = (await res.json()) as any;
    if (!d.available || !d.migrated) return null;
    return {
      migrated: true,
      isPostMigrationToken: !!d.isPostMigrationToken,
      projects: Array.isArray(d.projects) ? d.projects : [],
      note: d.note ?? "",
    };
  } catch {
    return null;
  }
}
