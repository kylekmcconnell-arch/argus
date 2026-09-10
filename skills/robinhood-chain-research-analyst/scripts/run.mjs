import { access, writeFile } from 'node:fs/promises';
import { researchLaunch, validateResearch } from './research.mjs';
const args = process.argv.slice(2);
const value = name => args[args.indexOf(name) + 1];
if (!args.includes('--address') || !args.includes('--output')) {
  console.error('Usage: node scripts/run.mjs --address 0x… --output result.json [--no-trace]');
  process.exitCode = 1;
} else {
  try {
    let exists = false;
    try { await access(value('--output')); exists = true; } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (exists) throw new Error('Output already exists');
    const result = validateResearch(await researchLaunch({ chain: 'robinhood', address: value('--address') }, {
      rpcUrl: process.env.ROBINHOOD_RPC_URL,
      archiveRpcUrl: process.env.ROBINHOOD_ARCHIVE_RPC_URL,
      trace: !args.includes('--no-trace'),
    }));
    await writeFile(value('--output'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    console.log(`Saved ${result.findings.length} findings; ${result.usage.requests} requests; ${result.gaps.length} coverage gaps.`);
  } catch { console.error('Research failed or output already exists. Check configuration and use a new output filename.'); process.exitCode = 1; }
}
