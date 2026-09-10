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
});
