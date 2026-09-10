import type { LaunchResearch } from '../../../src/lib/deepLaunch.js';
export const VERSION: string;
export function researchLaunch(input: { chain: string; address: string }, options?: {
  rpcUrl?: string; archiveRpcUrl?: string; trace?: boolean; maxRequests?: number;
  timeoutMs?: number; fetcher?: typeof fetch;
}): Promise<LaunchResearch>;
export function validateResearch(result: unknown): LaunchResearch;
