// Exercise the exact migration against legacy/colliding fixtures in a rolled-back transaction.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
const migration = readFileSync(new URL("../supabase/migrations/20260908165653_restore_threat_address_case.sql", import.meta.url), "utf8");
// The fixture supplies BEGIN/ROLLBACK in place of the production BEGIN/COMMIT.
if (!migration.startsWith("begin;\n") || !migration.endsWith("commit;\n")) throw new Error("Expected transactional migration");
const body = migration.slice("begin;\n".length, -"commit;\n".length);
const template = readFileSync(new URL("../supabase/tests/fixtures/threat_address_case.sql.in", import.meta.url), "utf8");
const directory = mkdtempSync(join(tmpdir(), "argus-threat-case-"));
try {
  const path = join(directory, "threat_address_case.sql");
  writeFileSync(path, template.replaceAll("\\ir ../migrations/20260908165653_restore_threat_address_case.sql", () => body));
  const result = spawnSync("supabase", ["test", "db", ...process.argv.slice(2), path], { stdio: "inherit" });
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(directory, { recursive: true, force: true });
}
