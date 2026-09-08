/** Cancel provider requests at the stage deadline and ignore late results. */
export async function withWallClockBox<T>(work: (fetcher: typeof fetch) => Promise<T>, budgetMs: number): Promise<T | null> {
  if (budgetMs <= 0) return null;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const fetcher: typeof fetch = (input, init) => {
    controller.signal.throwIfAborted();
    return fetch(input, { ...init, signal: init?.signal
      ? AbortSignal.any([controller.signal, init.signal]) : controller.signal });
  };
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => { controller.abort(); resolve(null); }, budgetMs);
    timer.unref?.();
  });
  try {
    return await Promise.race([work(fetcher), timeout]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
