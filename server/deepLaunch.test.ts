import { describe, expect, it, vi } from 'vitest';
import { researchLaunch, validateResearch } from '../skills/robinhood-chain-research-analyst/scripts/research.mjs';

const token = '0x' + '1'.repeat(40), wallet = '0x' + '2'.repeat(40);
const curve = '0x' + '3'.repeat(40), locker = '0x' + '4'.repeat(40);
const ponsV2 = '0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e';
const ponsV1 = '0xa5aab3f0c6eeadf30ef1d3eb997108e976351feb';
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
const encode = (...values: Array<string | bigint | number | boolean>) => `0x${values.map(value => {
  if (typeof value === 'boolean') return (value ? '1' : '0').padStart(64, '0');
  if (typeof value === 'number' || typeof value === 'bigint') return BigInt(value).toString(16).padStart(64, '0');
  return value.replace(/^0x/, '').padStart(64, '0');
}).join('')}`;
function ponsTransport(phase = 0, exactRecord = true, generation: 'v1' | 'v2' = 'v2') {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    if (!init?.body) {
      if (href.includes('dexscreener')) return Response.json({ pairs: [{ chainId: 'robinhood', pairAddress: wallet,
        baseToken: { address: token }, quoteToken: { address: wallet }, dexId: 'uniswap', liquidity: { usd: 25000 }, txns: { h24: { buys: 3, sells: 2 } }, url: `https://dexscreener.com/robinhood/${wallet}` }] });
      if (href.includes('geckoterminal')) return Response.json({ data: [{ attributes: { from_token_address: token, tx_hash: tx,
        block_number: 16, block_timestamp: '2026-09-10T00:00:00Z', from_token_amount: '10', volume_in_usd: '5' } }] });
      return Response.json({ status: '1', result: [{ contractAddress: token, txHash: tx, contractCreator: wallet }] });
    }
    const body = JSON.parse(String(init.body)); let result: unknown;
    if (body.method === 'eth_chainId') result = '0x1237';
    else if (body.method === 'eth_getBlockByNumber') result = { number: '0x50000', hash: blockHash, timestamp: '0x1' };
    else if (body.method === 'eth_getCode') result = '0x60016001';
    else if (body.method === 'eth_getStorageAt') result = word('0');
    else if (body.method === 'eth_getTransactionReceipt') result = { transactionHash: tx, status: '0x1', blockNumber: '0x10', blockHash, contractAddress: token, logs: [transfer] };
    else if (body.method === 'debug_traceTransaction') result = { type: 'CREATE', from: wallet, to: token, value: '0x0', calls: [] };
    else if (body.method === 'eth_getLogs') result = [{ address: curve, topics: ['0x8113d738abdcb6b38357e9d53a54a7157861a09031b453651f0fe7fe151f59df'], transactionHash: tx, blockNumber: '0x4ffff', removed: false }];
    else if (body.method === 'eth_call') {
      const data = body.params[0].data;
      result = data === '0x8da5cb5b' ? word(wallet) : data === '0x18160ddd' ? word('1000000')
        : data === '0x536dac9b' ? word(generation === 'v2' ? ponsV2 : ponsV1) : data === '0x7165485d' ? word(generation === 'v2' ? curve : '0')
        : data.startsWith('0x3cf28b5a') ? (generation === 'v2'
          ? encode(exactRecord ? token : wallet, curve, wallet, wallet, '0x' + '0'.repeat(40), 1000, 0, 1, 100, false, phase, 0, 0, 0, true)
          : encode(exactRecord ? token : wallet, wallet, wallet, curve, 42, 0, 0, 1, 1000000, true, 10000, true, 0))
        : data === '0xfc0c546a' ? word(token) : data === '0xc45a0155' ? word(ponsV2)
        : data === '0x0902f1ac' ? encode(1000000, 5000000) : data === '0x4f1f58fd' ? word('100000')
        : data === '0x15a55347' ? word('1000000') : data === '0x808bcddc' ? word(phase === 2 ? '0' : '4000000')
        : data === '0x24a9d853' ? word('100') : data === '0xc1bb8901' ? word('50') : data === '0xe7c2b772' ? word(phase === 2 ? '1' : '0')
        : data === '0x665a11ca' ? word(wallet) : data === '0x0861ac61' ? word('10')
        : data === '0xd7b96d4e' ? word(locker) : data.startsWith('0x4a4fbeec') ? word('1') : data.startsWith('0xfa22143d') ? word('2a')
        : data.startsWith('0x6352211e') ? word(locker) : word('0');
    }
    return Response.json({ jsonrpc: '2.0', id: body.id, result });
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
  it('rejects a parity creation under a reverted ancestor even when the ancestor appears later', async () => {
    const result = await researchLaunch({ chain: 'robinhood', address: token }, { fetcher: transport({
      debug_traceTransaction: new Response('', { status: 503 }),
      trace_transaction: [
        { type: 'create', traceAddress: [0, 1], action: { from: wallet }, result: { address: token } },
        { type: 'call', traceAddress: [0], error: 'Reverted', action: { from: wallet, to: curve } },
      ],
    }) });
    expect(result.findings.some(f => f.label === 'Internal creation call')).toBe(false);
    expect(result.gaps.some(g => g.area === 'trace' && g.reason.includes('No successful creation'))).toBe(true);
  });
  it('keeps a successful parity sibling separate from a reverted branch', async () => {
    const result = await researchLaunch({ chain: 'robinhood', address: token }, { fetcher: transport({
      debug_traceTransaction: new Response('', { status: 503 }),
      trace_transaction: [
        { type: 'create', traceAddress: [1], action: { from: wallet }, result: { address: token } },
        { type: 'call', traceAddress: [0], error: 'Reverted', action: { from: wallet } },
      ],
    }) });
    expect(result.findings.some(f => f.label === 'Internal creation call')).toBe(true);
  });
  it('does not corroborate indexed trades when the receipt block disagrees', async () => {
    const base = ponsTransport();
    const fetcher: typeof fetch = async (url, init) => {
      const response = await base(url, init);
      if (String(url).includes('geckoterminal')) {
        const data = await response.json() as { data: Array<{ attributes: { block_number: number } }> }; data.data[0].attributes.block_number = 15;
        return Response.json(data);
      }
      return response;
    };
    const result = await researchLaunch({ chain: 'robinhood', address: token }, { fetcher });
    expect(result.findings.some(f => f.label === 'Recent settled pool exit')).toBe(false);
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
  it('corroborates a PONS v2 curve, computes a pinned sell quote, and retains settled sells', async () => {
    const result = validateResearch(await researchLaunch({ chain: 'robinhood', address: token }, { fetcher: ponsTransport() }));
    expect(result.schemaVersion).toBe(2);
    // Gross output 99; protocol and creator fees round down separately (2 and 0).
    expect(result.findings.find(f => f.label === 'Pinned sell quote')?.detail).toContain('500 raw token units map to 97 raw quote units');
    expect(result.findings.find(f => f.label === 'Recent settled pool exit')?.detail).toContain('Only that transaction is corroborated');
    expect(result.findings.map(f => f.label)).toEqual(expect.arrayContaining([
      'Launch protocol verified', 'PONS launch lifecycle', 'Pinned sell quote', 'Settled curve sells', 'Indexed market liquidity', 'Indexed recent sells', 'Recent settled pool exit',
    ]));
    expect(result.findings.find(f => f.label === 'Pinned sell quote')?.detail).toContain('not a wallet execution guarantee');
  });
  it('does not count removed, wrong-contract or future logs as settled sells', async () => {
    const base = ponsTransport();
    const fetcher: typeof fetch = async (url, init) => {
      const response = await base(url, init);
      if (init?.body && JSON.parse(String(init.body)).method === 'eth_getLogs') {
        const data = await response.json() as { result: Array<Record<string, unknown>> };
        data.result = [ { ...data.result[0], removed: true }, { ...data.result[0], address: wallet }, { ...data.result[0], blockNumber: '0x60000' } ];
        return Response.json(data);
      }
      return response;
    };
    const result = await researchLaunch({ chain: 'robinhood', address: token }, { fetcher });
    expect(result.findings.some(f => f.label === 'Settled curve sells')).toBe(false);
  });
  it('does not describe future launch restrictions as already ended', async () => {
    const base = ponsTransport(0, true, 'v1');
    const fetcher: typeof fetch = async (url, init) => {
      if (init?.body && JSON.parse(String(init.body)).params?.[0]?.data === '0x0861ac61') return Response.json({ result: word('60000') });
      return base(url, init);
    };
    const result = await researchLaunch({ chain: 'robinhood', address: token }, { fetcher });
    expect(result.findings.find(f => f.label === 'PONS v1 pool')?.detail).toContain('are scheduled to end');
  });
  it('corroborates graduated PONS v2 liquidity only through the factory-selected locker', async () => {
    const result = validateResearch(await researchLaunch({ chain: 'robinhood', address: token }, { fetcher: ponsTransport(2) }));
    expect(result.findings.find(f => f.label === 'Graduated liquidity custody')?.detail).toContain('position 42');
    expect(result.findings.some(f => f.label === 'Pinned sell quote')).toBe(false);
  });
  it('does not attribute PONS when the factory record belongs to another token', async () => {
    const result = validateResearch(await researchLaunch({ chain: 'robinhood', address: token }, { fetcher: ponsTransport(0, false) }));
    expect(result.findings.some(f => f.label === 'Launch protocol verified')).toBe(false);
  });
  it('corroborates a PONS v1 pool and current position-NFT custody', async () => {
    const result = validateResearch(await researchLaunch({ chain: 'robinhood', address: token }, { fetcher: ponsTransport(0, true, 'v1') }));
    expect(result.findings.map(f => f.label)).toEqual(expect.arrayContaining(['Launch protocol verified', 'PONS v1 pool', 'PONS v1 liquidity custody']));
    expect(result.findings.find(f => f.label === 'PONS v1 liquidity custody')?.detail).toContain('not the absence of every possible exit path');
  });
});
