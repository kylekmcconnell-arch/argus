import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUDIT_STREAM_INACTIVITY_TIMEOUT_MS } from "./investigationRuntime";
import { streamAudit } from "./live";

const encoder = new TextEncoder();

describe("audit SSE liveness", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("allows a responsive audit to run past the former 195 second client cap", async () => {
    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(body, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const handlers = { onStep: vi.fn(), onDone: vi.fn(), onError: vi.fn() };

    const abort = streamAudit("@argus", false, handlers);
    await vi.advanceTimersByTimeAsync(0);

    for (let index = 0; index < 3; index += 1) {
      await vi.advanceTimersByTimeAsync(80_000);
      streamController.enqueue(encoder.encode(`: argus-heartbeat-${index}\n\n`));
      await vi.advanceTimersByTimeAsync(0);
      expect(handlers.onError).not.toHaveBeenCalled();
    }

    await vi.advanceTimersByTimeAsync(80_000);
    streamController.enqueue(encoder.encode(
      'event: done\ndata: {"handle":"@argus","report":{}}\n\n',
    ));
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(handlers.onStep).not.toHaveBeenCalled();
    expect(handlers.onDone).toHaveBeenCalledOnce();
    expect(handlers.onError).not.toHaveBeenCalled();
    abort();
  });

  it("aborts and reports a genuinely inactive stream", async () => {
    const body = new ReadableStream<Uint8Array>({ start() {} });
    let requestSignal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_input, init?: RequestInit) => {
      requestSignal = init?.signal as AbortSignal | undefined;
      return Promise.resolve(new Response(body, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }));
    }));
    const handlers = { onStep: vi.fn(), onDone: vi.fn(), onError: vi.fn() };

    streamAudit("@argus", false, handlers);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(AUDIT_STREAM_INACTIVITY_TIMEOUT_MS);

    expect(requestSignal?.aborted).toBe(true);
    expect(handlers.onError).toHaveBeenCalledWith("timed out: the audit stream stopped responding");
    expect(handlers.onDone).not.toHaveBeenCalled();
  });
});
