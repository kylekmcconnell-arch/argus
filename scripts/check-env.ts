// Reports which ARGUS providers are wired and what that unlocks — WITHOUT ever
// printing a key value. Run: npm run check-env
import { providerStatus, PROVIDERS } from "../server/config";

try { process.loadEnvFile(".env"); } catch { /* no .env file — fall back to shell env */ }

const C = { reset: "\x1b[0m", green: "\x1b[32m", red: "\x1b[31m", dim: "\x1b[2m", bold: "\x1b[1m", yellow: "\x1b[33m" };
const rows = providerStatus();

console.log(`\n${C.bold}ARGUS provider status${C.reset}  ${C.dim}(key values are never read or shown)${C.reset}\n`);
for (const p of rows) {
  // configured covers truly-keyless providers (DexScreener) too. For unset ones,
  // distinguish free-to-obtain from paid — both still need a key.
  const mark = p.configured
    ? `${C.green}● wired       ${C.reset}`
    : p.free
      ? `${C.dim}○ unset (free)${C.reset}`
      : `${C.red}○ unset (paid)${C.reset}`;
  console.log(`  ${mark} ${p.label.padEnd(30)} ${C.dim}${p.feeds}${C.reset}`);
}

const has = (id: string) => rows.find((r) => r.id === id)?.configured ?? false;
const xSource = has("grok") || has("twitterapi");
const peopleLive = has("analyst") && xSource;

console.log(`\n${C.bold}Capabilities${C.reset}`);
console.log(`  Token + site audits     ${C.green}LIVE${C.reset} ${C.dim}— keyless, always on${C.reset}`);
console.log(
  `  People / founder audits ${peopleLive ? `${C.green}LIVE${C.reset}` : `${C.yellow}curated${C.reset}`}` +
    (peopleLive ? "" : `${C.dim} — needs ANTHROPIC_API_KEY${has("analyst") ? "" : " (missing)"} + an X source${xSource ? "" : " (XAI_API_KEY or TWITTERAPI_KEY, missing)"}${C.dim}`) +
    C.reset,
);
console.log(`  Analyst model           ${C.dim}${process.env.ARGUS_ANALYST_MODEL || "claude-sonnet-4-6"}${C.reset}`);

// Flag any provider that has SOME but not ALL of its required vars (e.g. only
// one of Reddit's two), which would silently leave it disabled.
for (const p of PROVIDERS) {
  const set = p.env.filter((k) => !!process.env[k]);
  if (p.env.length > 1 && set.length > 0 && set.length < p.env.length) {
    const missing = p.env.filter((k) => !process.env[k]);
    console.log(`\n  ${C.yellow}! ${p.label} is half-configured — still missing: ${missing.join(", ")}${C.reset}`);
  }
}
console.log("");
