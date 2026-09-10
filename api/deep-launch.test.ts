import { beforeEach, describe, expect, it, vi } from 'vitest';
const { auth, research } = vi.hoisted(() => ({ auth: vi.fn(), research: vi.fn() }));
vi.mock('./_auth.js', () => ({ requireArgusAuth: auth, serviceCredentials: () => ({ url: 'https://db.example', key: 'test' }), serviceHeaders: () => ({}) }));
vi.mock('../skills/robinhood-chain-research-analyst/scripts/research.mjs', () => ({ researchLaunch: research, validateResearch: (r: unknown) => r, VERSION: 'robinhood-launch-v1' }));
import handler from './deep-launch';
const version = '00000000-0000-4000-8000-000000000123';
const org = '00000000-0000-4000-8000-000000000124';
const target = '0x' + '1'.repeat(40);
function response() { const res = { setHeader: vi.fn(), status: vi.fn(), json: vi.fn() }; res.status.mockReturnValue(res); return res; }
function database(options: { chain?: string; claim?: string | null; absent?: boolean; archived?: boolean } = {}) {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('/report_versions?')) return Response.json(options.absent ? [] : [{ case_id: version, payload: { token: { chain: options.chain ?? 'robinhood', address: target } } }]);
    if (url.includes('/cases?')) return Response.json([{ kind: 'investigation', status: options.archived ? 'archived' : 'open' }]);
    if (url.includes('/rpc/')) return Response.json(options.claim === undefined ? version : options.claim);
    if (init?.method === 'PATCH') return Response.json([{ state: 'completed', result: JSON.parse(String(init.body)).result }]);
    return Response.json([{ state: 'running', run_id: version }]);
  });
  vi.stubGlobal('fetch', fetcher); return fetcher;
}
beforeEach(() => { vi.resetAllMocks(); auth.mockResolvedValue({ organizationId: org, userId: version, role: 'analyst' }); research.mockResolvedValue({ status: 'partial' }); });
describe('deep launch version authorization and deduplication', () => {
  it('derives target from tenant-scoped saved payload, ignoring client identity and endpoints', async () => {
    const fetcher = database(), res = response();
    await handler({ method: 'POST', body: { reportVersionId: version, address: 'attacker', rpcUrl: 'https://evil.example' } } as never, res as never);
    expect(research.mock.calls[0][0]).toEqual({ chain: 'robinhood', address: target });
    expect(research.mock.calls[0][1].rpcUrl).not.toBe('https://evil.example');
    expect(fetcher.mock.calls.filter(([u]) => !u.includes('/rpc/')).every(([u]) => u.includes(`organization_id=eq.${org}`))).toBe(true);
    expect(res.status).toHaveBeenCalledWith(200);
  });
  it('never collects on GET', async () => {
    database(); const res = response(); await handler({ method: 'GET', query: { reportVersionId: version } } as never, res as never);
    expect(research).not.toHaveBeenCalled(); expect(auth).toHaveBeenCalledWith(expect.anything(),res,'viewer');
  });
  it('does not duplicate an already claimed run', async () => {
    database({ claim: null }); const res = response(); await handler({ method: 'POST', body: { reportVersionId: version } } as never,res as never);
    expect(research).not.toHaveBeenCalled(); expect(res.status).toHaveBeenCalledWith(202);
  });
  it.each([{ absent: true }, { chain: 'base' }, { archived: true }])('rejects invalid report scope %j', async options => {
    database(options); const res = response(); await handler({ method: 'POST', body: { reportVersionId: version } } as never,res as never);
    expect(research).not.toHaveBeenCalled(); expect(res.status.mock.calls[0][0]).toBeGreaterThanOrEqual(400);
  });
  it('rejects absent immutable version before touching storage', async () => {
    const fetcher = database(), res = response(); await handler({ method: 'POST', body: {} } as never,res as never);
    expect(fetcher).not.toHaveBeenCalled(); expect(res.status).toHaveBeenCalledWith(400);
  });
  it('does no work when authentication rejects the caller', async () => {
    auth.mockResolvedValue(null); const fetcher = database(); await handler({ method: 'POST',body: { reportVersionId: version } } as never,response() as never);
    expect(fetcher).not.toHaveBeenCalled(); expect(research).not.toHaveBeenCalled();
  });
});
