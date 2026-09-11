import type { LaunchResearch } from './deepLaunch';

export function launchFindingDetail(detail: string): string {
  // Old immutable snapshots keep their original payload. Correct known overclaims
  // in display copy without claiming new evidence or silently rewriting storage.
  return detail.replace("The token's immutable reference", "The token's reported factory address")
    .replace('This proves those observed exits settled, not that every wallet or future trade will succeed.',
      'Only the referenced transaction receipt was checked. The other trades and their trade details remain indexer-reported; future sellability is not established.');
}

export function launchFindingSources(result: LaunchResearch, evidence: string[]): string {
  const providers = [...new Set(result.observations.filter(record => evidence.includes(record.id)).map(record => record.provider))];
  return providers.length ? providers.join(', ') : 'Source details were not saved';
}
