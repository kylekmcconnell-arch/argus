import { AsyncLocalStorage } from "node:async_hooks";

const context = new AsyncLocalStorage<AbortSignal>();
/** Per-adapter scope; concurrent investigations never share a controller. */
export async function withProviderDeadline<T>(deadlineAt: number, work: () => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) throw new Error("collection_deadline_reached");
  const timer = setTimeout(() => controller.abort(new Error("collection_deadline_reached")), remaining);
  timer.unref?.();
  try {
    return await context.run(controller.signal, async () => {
      const result = await work();
      controller.signal.throwIfAborted();
      return result;
    });
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

export const deadlineFetch: typeof globalThis.fetch = (input, init) => {
  const signal = context.getStore();
  signal?.throwIfAborted();
  return globalThis.fetch(input, { ...init, signal: signal
    ? AbortSignal.any([signal, ...(init?.signal ? [init.signal] : [])]) : init?.signal });
};

export function providerDeadlineSignal(): AbortSignal | undefined { return context.getStore(); }
