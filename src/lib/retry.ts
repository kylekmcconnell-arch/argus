// Automatic retry for the flaky, keyless third-party fetches the scanners rely
// on (DexScreener, GoPlus, RugCheck, Honeypot.is, our own /api/* helpers). A
// transient timeout / 429 / 5xx should self-heal inside this one call instead
// of bubbling up and forcing an entire scan to be redone. A real 4xx (bad
// address, not found) is not retried — retrying it can't change the answer.
export async function retryFetch(input: string, init?: RequestInit, attempts = 3): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(input, init);
      if (res.ok || (res.status !== 429 && res.status < 500)) return res;
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (e) {
      lastErr = e;
    }
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, 300 * 2 ** i));
  }
  throw lastErr;
}
