import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const context = JSON.parse(readFileSync(resolve(root, "config/agent-context.json"), "utf8"));
const failures = [];
const requireValue = (condition, message) => { if (!condition) failures.push(message); };

requireValue(context.schemaVersion === 1, "schemaVersion must be 1");
requireValue(context.contractVersion === "2026-08-21.1", "contractVersion drifted");
requireValue(context.project?.canonicalRepository === context.repository?.name, "project repository mapping drifted");
requireValue(context.authority?.source === "github-default-branch", "source authority must be the GitHub default branch");
requireValue(context.authority?.engineeringHandoff === "github", "engineering handoff must be GitHub");
requireValue(context.authority?.runtimeContext === "oenbot", "runtime context must remain OENBOT");
requireValue(context.routing?.dashboard === "kylekmcconnell-arch/oenbot-dashboard-source", "dashboard route drifted");
requireValue(context.routing?.unknown === "needs-routing", "unknown work must fail closed");
requireValue(["canonical-product", "legacy-source-mirror", "oenbot-managed-artifact"].includes(context.repository?.role), "repository role is invalid");
if (context.repository?.role === "canonical-product") {
  requireValue(context.routing?.normalProductWork === context.repository?.name, "canonical product work must route to this repository");
} else {
  requireValue(context.routing?.normalProductWork !== context.repository?.name, "noncanonical repositories must not accept normal product work");
}

try {
  const remote = execFileSync("git", ["remote", "get-url", "origin"], { cwd: root, encoding: "utf8" }).trim();
  const normalized = remote.replace(/^git@github\.com:/u, "").replace(/^https:\/\/github\.com\//u, "").replace(/\.git$/u, "");
  requireValue(normalized === context.repository.name, `origin is ${normalized || "unknown"}, expected ${context.repository.name}`);
} catch {
  failures.push("origin repository could not be verified");
}

for (const [provider, relfile] of Object.entries(context.providerEntrypoints || {})) {
  const filename = resolve(root, relfile);
  requireValue(existsSync(filename), `${provider} entrypoint is missing: ${relfile}`);
  if (existsSync(filename) && provider !== "generic") {
    requireValue(readFileSync(filename, "utf8").includes("AGENTS.md"), `${provider} must delegate to AGENTS.md`);
  }
}
const contract = readFileSync(resolve(root, "AGENTS.md"), "utf8");
requireValue(contract.includes("oenbot-agent-contract:v1"), "AGENTS.md marker is missing");
requireValue(contract.includes("node scripts/validate-agent-context.mjs"), "AGENTS.md preflight is missing");

if (failures.length) {
  process.stderr.write(`${failures.map(value => `- ${value}`).join("\n")}\n`);
  process.exit(1);
}
process.stdout.write([
  `${context.project.name} agent contract ${context.contractVersion}`,
  `Repository role: ${context.repository.role}`,
  `Canonical checkout: ${context.repository.name}@${context.repository.defaultBranch}`,
  `Normal product work: ${context.routing.normalProductWork}`,
  "Engineering handoff: GitHub issue -> branch -> draft PR -> protected default branch",
  "Runtime context and approvals: OENBOT / existing guarded workflows",
].join("\n") + "\n");
