// Migrate.fun migration detection. GET /api/migration?address=<mint>
//
// A token that migrated via Migrate.fun (Emblem Vault's on-chain program on
// Solana) gets a NEW mint - the chart restarts, and the claim distribution
// (independent depositors each claiming their new token from a program vault
// over ~90 days) naively looks like a bundled launch. This detects the migration
// from first principles: the program's project accounts each encode the old mint,
// the new mint and the creator, so we read them and match the scanned mint.
//
// Program ID verified from a live project account's owner (the "mig" vanity
// prefix confirms it); the project-account discriminator filters getProgramAccounts
// down to ~200 project records (not the per-user migration PDAs).
// Solana only.
import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = { maxDuration: 25 };

const PROGRAM = "migK824DsBMp2eZXdhSBAWFS6PbvA6UN8DV15HfmstR";
const PROJECT_DISCRIMINATOR = "YSC6fNifLgY"; // base58 of the 8-byte account discriminator
const SOL = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const B58MAP: Record<string, number> = {};
for (let i = 0; i < B58.length; i++) B58MAP[B58[i]] = i;
function b58encode(bytes: Buffer): string {
  const digits = [0];
  for (const b of bytes) { let carry = b; for (let j = 0; j < digits.length; j++) { carry += digits[j] << 8; digits[j] = carry % 58; carry = (carry / 58) | 0; } while (carry) { digits.push(carry % 58); carry = (carry / 58) | 0; } }
  let str = ""; for (const b of bytes) { if (b === 0) str += "1"; else break; }
  for (let k = digits.length - 1; k >= 0; k--) str += B58[digits[k]];
  return str;
}
function b58decode(s: string): Buffer | null {
  let n = 0n;
  for (const c of s) { const v = B58MAP[c]; if (v === undefined) return null; n = n * 58n + BigInt(v); }
  const hex = n.toString(16).padStart(64, "0");
  if (hex.length !== 64) return null;
  return Buffer.from(hex, "hex");
}

function rpcUrls(): string[] {
  const key = process.env.HELIUS_API_KEY;
  return key
    ? [`https://mainnet.helius-rpc.com/?api-key=${key}`, "https://api.mainnet-beta.solana.com"]
    : ["https://api.mainnet-beta.solana.com"];
}

async function programProjectAccounts(): Promise<{ pubkey: string; data: Buffer }[]> {
  for (const url of rpcUrls()) {
    try {
      const r = await fetch(url, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0", id: 1, method: "getProgramAccounts",
          params: [PROGRAM, { encoding: "base64", filters: [{ memcmp: { offset: 0, bytes: PROJECT_DISCRIMINATOR } }] }],
        }),
        signal: AbortSignal.timeout(18000),
      });
      if (!r.ok) continue;
      const d = (await r.json()) as { result?: Array<{ pubkey?: unknown; account?: { data?: unknown[] } }> };
      if (!Array.isArray(d.result)) continue;
      return d.result
        .filter((a): a is { pubkey: string; account: { data: [string, ...unknown[]] } } =>
          typeof a.pubkey === "string" && Array.isArray(a.account?.data) && typeof a.account.data[0] === "string")
        .map((a) => ({ pubkey: a.pubkey, data: Buffer.from(a.account.data[0], "base64") }));
    } catch { /* next url */ }
  }
  return [];
}

// Layout: [8 disc][u32 len + projectId][u32 len + name][creator:32][newMint:32][oldMint:32]…
function parseProject(data: Buffer): { projectId: string; name: string; creator: string; newMint: string; oldMint: string } | null {
  try {
    let off = 8;
    const len1 = data.readUInt32LE(off); off += 4;
    const projectId = data.slice(off, off + len1).toString("latin1"); off += len1;
    const len2 = data.readUInt32LE(off); off += 4;
    const name = data.slice(off, off + len2).toString("latin1"); off += len2;
    const creator = b58encode(data.slice(off, off + 32));
    const newMint = b58encode(data.slice(off + 32, off + 64));
    const oldMint = b58encode(data.slice(off + 64, off + 96));
    return { projectId, name, creator, newMint, oldMint };
  } catch {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const address = String(req.query.address ?? "").trim();
  if (!SOL.test(address)) { res.status(200).json({ available: true, migrated: false, note: "Migrate.fun is Solana-only" }); return; }
  const mintBytes = b58decode(address);
  if (!mintBytes) { res.status(400).json({ available: false, error: "bad address" }); return; }

  const accounts = await programProjectAccounts();
  if (!accounts.length) { res.status(200).json({ available: false, note: "could not read Migrate.fun program accounts" }); return; }

  const matches: { projectId: string; role: "new" | "old" | "referenced"; counterpartMint: string; creator: string }[] = [];
  for (const a of accounts) {
    if (a.data.indexOf(mintBytes) < 0) continue; // scanned mint not in this project
    const p = parseProject(a.data);
    if (!p) continue;
    const role = p.newMint === address ? "new" : p.oldMint === address ? "old" : "referenced";
    matches.push({ projectId: p.projectId, role, counterpartMint: role === "new" ? p.oldMint : p.newMint, creator: p.creator });
  }

  if (!matches.length) { res.status(200).json({ available: true, migrated: false }); return; }
  // "new" = this IS the post-migration token (chart restarted here).
  const asNew = matches.find((m) => m.role === "new");
  res.status(200).json({
    available: true,
    migrated: true,
    isPostMigrationToken: !!asNew,
    projects: matches,
    // The most useful single fact: this token migrated (or is migrating), so a
    // fresh contract age and a claim-style distribution are expected, not a rug.
    note: asNew
      ? `Migrated via Migrate.fun (${asNew.projectId}) - this is the NEW post-migration token, so its contract is new and the chart restarted. The pre-migration token was ${asNew.counterpartMint.slice(0, 8)}…. Claim distribution to original holders is expected, not a bundle.`
      : `This token is registered in a Migrate.fun migration (${matches[0].projectId}) as the ${matches[0].role} token - it migrates to ${matches[0].counterpartMint.slice(0, 8)}….`,
  });
}
