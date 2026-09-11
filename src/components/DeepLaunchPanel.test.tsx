// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeepLaunchPanel } from './DeepLaunchPanel';
vi.mock('../auth-context', () => ({ useArgusAuth: () => ({ role: 'analyst' }) }));
afterEach(() => vi.unstubAllGlobals());
describe('deep launch explicit action', () => {
  it('loads saved data without starting research and posts only the immutable version on click', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({ run: null })); vi.stubGlobal('fetch', fetcher);
    const container = document.createElement('div'); const root = createRoot(container);
    await act(async () => { root.render(<DeepLaunchPanel chain="robinhood" reportVersionId="version-one" />); });
    expect(fetcher).toHaveBeenCalledTimes(1); expect(fetcher.mock.calls[0][1]?.method).toBeUndefined();
    const button = [...container.querySelectorAll('button')].find(b => b.textContent === 'Run deep launch analysis');
    expect(button).toBeTruthy();
    await act(async () => { button!.click(); });
    expect(fetcher.mock.calls[1][1]?.method).toBe('POST');
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toEqual({ reportVersionId: 'version-one' });
    await act(async () => root.unmount());
  });
  it('does not fetch for unsupported chains or unsaved reports', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const container = document.createElement('div'); const root = createRoot(container);
    await act(async () => { root.render(<DeepLaunchPanel chain="base" reportVersionId="one" />); });
    expect(container.textContent).toBe('');
    await act(async () => { root.render(<DeepLaunchPanel chain="robinhood" />); });
    expect(container.textContent).toContain('after this report is saved'); expect(fetcher).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });
  it('offers an explicit missing-evidence retry for a completed partial result', async () => {
    const run = { run_id: 'r', state: 'completed', started_at: new Date(0).toISOString(), finished_at: new Date().toISOString(), result: {
      schemaVersion: 2, toolVersion: 'robinhood-launch-v2', status: 'partial', target: { chain: 'robinhood', chainId: 4663, address: `0x${'1'.repeat(40)}`, block: '0x1', blockHash: `0x${'2'.repeat(64)}` },
      startedAt: new Date(0).toISOString(), completedAt: new Date().toISOString(), findings: [], gaps: [{ area: 'trace', reason: 'unavailable' }], observations: [],
      usage: { requests: 1, maxRequests: 32, elapsedMs: 1, costUsd: null, note: '' },
    } };
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => Response.json(init?.method === 'POST'
      ? { run: { state: 'failed', run_id: 'failed', result: null }, previousRun: run }
      : { run })); vi.stubGlobal('fetch', fetcher);
    const container = document.createElement('div'); const root = createRoot(container);
    await act(async () => { root.render(<DeepLaunchPanel chain="robinhood" reportVersionId="version-two" />); });
    const button = [...container.querySelectorAll('button')].find(b => b.textContent === 'Refresh launch analysis');
    expect(container.textContent).toContain('reruns the full bounded launch analysis');
    await act(async () => { button!.click(); });
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toEqual({ reportVersionId: 'version-two', retryMissing: true });
    expect(container.textContent).toContain('Showing the last successful analysis');
    expect(container.textContent).toContain('Coverage gaps (1)');
    await act(async () => root.unmount());
  });
});
