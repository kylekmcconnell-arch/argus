export interface LaunchObservation {
  id: string; provider: string; method: string; params: unknown; capturedAt: string;
  status: string; result?: unknown; responseHash?: string; httpStatus?: number;
}
export interface LaunchResearch {
  schemaVersion: 1; toolVersion: string; status: 'partial' | 'unavailable';
  target: { chain: 'robinhood'; chainId: 4663; address: string; block: string | null; blockHash: string | null };
  startedAt: string; completedAt: string;
  findings: Array<{ label: string; detail: string; strength: 'measured' | 'source_attributed'; evidence: string[] }>;
  gaps: Array<{ area: string; reason: string }>;
  observations: LaunchObservation[];
  usage: { requests: number; maxRequests: number; elapsedMs: number; costUsd: null; note: string };
}
export interface LaunchResearchRun {
  run_id: string; state: 'running' | 'completed' | 'failed'; result: LaunchResearch | null;
  started_at: string; finished_at: string | null;
}
