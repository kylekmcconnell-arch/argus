import { describe, expect, it, vi } from 'vitest';
import { researchLaunch, validateResearch } from '../skills/robinhood-chain-research-analyst/scripts/research.mjs';

const token = '0x' + '1'.repeat(40), wallet = '0x' + '2'.repeat(40);
const tx = '0x' + 'a'.repeat(64), blockHash = '0x' + 'b'.repeat(64);
const word = (s: string) => '0x' + s.replace(/^0x/, '').padStart(64, '0');
const transfer = { address: token, topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', word('0'), word(wallet)], data: word('10'), logIndex: '0x0' };
function transport(overrides: Record<string, unknown> = {}) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const method = init?.body ? JSON.parse(String(init.body)).method : String(url).includes('sourcify.dev') ? 'sourcify' : 'explorer';
    const values: Record<string, unknown> = {
      eth_chainId: '0x1237', eth_getBlockByNumber: { number: '0x10', hash: blockHash, timestamp: '0x1' },
      eth_getCode: '0x60016001', eth_call: word(wallet), eth_getStorageAt: word('0'),
      explorer: { status: '1', result: [{ contractAddress: token, txHash: tx, contractCreator: wallet }] },
      eth_getTransactionReceipt: { transactionHash: tx, status: '0x1', blockNumber: '0x10', blockHash, contractAddress: token, logs: [transfer] },
      debug_traceTransaction: { type: 'CREATE', from: wallet, to: token, value: '0x0', calls: [] },
      ...overrides,
    };
    const value = values[method];
    if (value instanceof Response) return value.clone();
    return Response.json(init?.body ? { jsonrpc: '2.0', id: 1, result: value } : value);
  }) as unknown as typeof fetch;
}
describe('bounded launch research', () => {
  it('binds the exact chain and retains evidence for each finding without a score', async () => {
    const fetcher = transport();
    const result = validateResearch(await researchLaunch({ chain: 'robinhood', address: token }, { fetcher }));
    expect(result.target.blockHash).toBe(blockHash);
    expect(result.findings.some(f => f.label === 'Creation corroborated')).toBe(true);
    expect(result.findings.find(f => f.label === 'Transfers in creation transaction')?.detail).toContain('1 distinct nonzero recipients');
    expect(result).not.toHaveProperty('score');
    expect(result.usage.costUsd).toBeNull();
    expect(result.usage.requests).toBeLessThanOrEqual(20);
    expect(vi.mocked(fetcher).mock.calls.every(([, init]) => init?.redirect === 'error')).toBe(true);
  });
  it('stops before contract reads on a different chain', async () => {
    const fetcher = transport({ eth_chainId: '0x1' });
    const result = validateResearch(await researchLaunch({ chain: 'robinhood', address: token }, { fetcher }));
    expect(result.status).toBe('unavailable'); expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.findings).toHaveLength(0);
  });
  it('does not accept another contract from the explorer or treat transfer evidence as buys', async () => {
    const result = await researchLaunch({ chain: 'robinhood', address: token }, { fetcher: transport({ explorer: { status: '1', result: [{ contractAddress: wallet, txHash: tx }] } }) });
    expect(result.findings.some(f => /creation|Transfers/.test(f.label))).toBe(false);
    expect(result.gaps.some(g => g.area === 'creation')).toBe(true);
  });
  it('retains restricted capability separately and does not leak provider bodies or URLs', async () => {
    const result = await researchLaunch({ chain: 'robinhood', address: token }, { rpcUrl: 'https://rpc.example/private-secret',
      fetcher: transport({ debug_traceTransaction: new Response('private-secret', { status: 429 }) }) });
    expect(result.observations.some(o => o.status === 'reachable_but_restricted')).toBe(true);
    expect(JSON.stringify(result)).not.toContain('private-secret');
  });
  it('bounds requests and records deferred work', async () => {
    const fetcher = transport();
    const result = validateResearch(await researchLaunch({ chain: 'robinhood', address: token }, { fetcher, maxRequests: 3 }));
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(result.observations.some(o => o.status === 'budget_deferred')).toBe(true);
  });
  it('recovers creation via an exact-chain Sourcify record when the explorer is restricted', async () => {
    const result = validateResearch(await researchLaunch({ chain: 'robinhood', address: token }, { fetcher: transport({
      explorer: new Response('blocked', { status: 403 }), sourcify: { chainId: '4663', address: token, deployment: { transactionHash: tx, deployer: wallet } },
    }) }));
    expect(result.findings.some(f => f.label === 'Creation corroborated')).toBe(true);
    expect(result.observations.some(o => o.provider === 'sourcify' && o.status === 'available')).toBe(true);
  });
  it('rejects a same-address Sourcify record on another chain', async () => {
    const result = await researchLaunch({ chain: 'robinhood', address: token }, { fetcher: transport({
      explorer: new Response('blocked', { status: 403 }), sourcify: { chainId: '1', address: token, deployment: { transactionHash: tx } },
    }) });
    expect(result.findings.some(f => f.label === 'Indexed creation transaction')).toBe(false);
  });
  it('does not promote reverted internal creates', async () => {
    const result = await researchLaunch({ chain: 'robinhood', address: token }, { fetcher: transport({ debug_traceTransaction: {
      type: 'CALL', error: 'execution reverted', calls: [{ type: 'CREATE', from: wallet, to: token }],
    } }) });
    expect(result.findings.some(f => f.label === 'Internal creation call')).toBe(false);
  });
  it('rejects findings whose observation IDs have no retained evidence', async () => {
    const result = await researchLaunch({ chain: 'robinhood', address: token }, { fetcher: transport() });
    result.findings[0].evidence = ['invented'];
    expect(() => validateResearch(result)).toThrow('Finding lacks retained evidence');
  });
  it('does not claim block consistency after a reorganization', async () => {
    const base = transport(); let reads = 0;
    const fetcher: typeof fetch = async (url, init) => {
      if (init?.body && JSON.parse(String(init.body)).method === 'eth_getBlockByNumber' && ++reads === 3) return Response.json({ result: { hash: '0x' + 'c'.repeat(64) } });
      return base(url, init);
    };
    const result = await researchLaunch({ chain: 'robinhood', address: token }, { fetcher });
    expect(result.status).toBe('unavailable');
    expect(result.gaps.some(g => g.area === 'block consistency')).toBe(true);
  });
});
