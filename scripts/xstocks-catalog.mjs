// Public, keyless issuer catalogue. Immutable receipts; current metadata is not
// proof of historical deployment dates, backing, liquidity or launchpad origin.
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
const directory = process.argv[2];
if (!directory) throw new Error('Usage: node scripts/xstocks-catalog.mjs <private-output-directory>');
const runDirectory = resolve(directory, `xstocks-${Date.now()}`);
await mkdir(runDirectory, { recursive: true, mode: 0o700 });
const assets = new Map();
const receipts = [];
let terminal = false;
for (let page = 0; page < 100; page++) {
  const sourceUrl = `https://api.xstocks.fi/api/v2/public/assets?page=${page}&pageSize=100`;
  const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(20000), redirect: 'error' });
  if (!response.ok) throw new Error(`Stopped at page ${page}: HTTP ${response.status}. Earlier receipts retained.`);
  const raw = await response.text();
  const capturedAt = new Date().toISOString();
  const sha256 = createHash('sha256').update(raw).digest('hex');
  await writeFile(join(runDirectory, `${page}-${sha256}.json`), raw, { flag: 'wx', mode: 0o600 });
  const data = JSON.parse(raw);
  if (!Array.isArray(data.nodes) || data.page?.currentPage !== page || typeof data.page?.hasNextPage !== 'boolean') throw new Error('Unusable issuer pagination');
  for (const row of data.nodes) {
    if (!row || typeof row.id !== 'string' || typeof row.symbol !== 'string' || !Array.isArray(row.deployments)) throw new Error('Invalid issuer asset');
    if (assets.has(row.id)) throw new Error('Page overlap: reconcile moving catalogue before declaring complete');
    assets.set(row.id, { ...row, sourceUrl, capturedAt, sha256 });
  }
  receipts.push({ page, sourceUrl, capturedAt, sha256, rows: data.nodes.length });
  if (!data.page.hasNextPage) { terminal = true; break; }
}
const result = { version: 1, provider: 'xStocks issuer API', terminal, scope: 'current-public-issuer-catalogue',
  note: 'Pages collected at different times. Not an atomic or historical catalogue. Token deployment addresses and wrappers remain issuer claims; join exact chain and address, never ticker.',
  receipts, assets: [...assets.values()] };
await writeFile(join(runDirectory, 'catalogue.json'), JSON.stringify(result, null, 2), { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ directory: runDirectory, terminal, assets: assets.size, pages: receipts.length,
  deployments: [...assets.values()].reduce((n, a) => n + a.deployments.length, 0), paidCalls: 0 }));
if (!terminal) process.exitCode = 1;
