// No provider calls. Validate first; explicit --apply writes dated workspace evidence.
import { readFileSync } from "node:fs";
import { importFomoWalletSweep } from "../server/fomoHolderStore.js";
import { serviceCredentials, serviceHeaders } from "../api/_auth.js";
const [file, organizationId, ...flags] = process.argv.slice(2);
if (!file || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(organizationId ?? "") || flags.some(flag => flag !== "--apply")) throw new Error("Usage: tsx scripts/import-fomo-wallets.ts <wallet-sweep.json> <organization-uuid> [--apply]");
const observations = importFomoWalletSweep(readFileSync(file, "utf8"));
console.log(JSON.stringify({ mode: flags.includes("--apply") ? "apply" : "validate-only", observations: observations.length,
  receiptHash: observations[0]?.receiptHash ?? null, providerCalls: 0,
  note: "Only exact-chain wallet-resolution hits/misses are imported. Receipt hashes preserve content identity, not provider authenticity. Stored provider claims do not establish current ownership." }));
if (flags.includes("--apply") && observations.length) {
  const credentials = serviceCredentials();
  if (!credentials) throw new Error("Workspace storage credentials are unavailable");
  for (let i = 0; i < observations.length; i += 250) {
    const rows = observations.slice(i, i + 250).map(row => ({ organization_id: organizationId, chain: row.chain, address: row.address,
      captured_at: row.capturedAt, source_url: row.sourceUrl, receipt_hash: row.receiptHash, state: row.state, label: row.label ?? null, twitter: row.twitter ?? null }));
    const response = await fetch(`${credentials.url}/rest/v1/fomo_wallet_observations`, { method: "POST",
      headers: { ...serviceHeaders(credentials.key), prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify(rows), signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`Import stopped at batch ${i / 250 + 1}. Earlier batches remain; rerunning this exact receipt is idempotent. HTTP ${response.status}`);
  }
  console.log("Workspace observations imported. Existing saved reports are unchanged.");
}
