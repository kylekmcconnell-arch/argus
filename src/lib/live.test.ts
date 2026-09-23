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

  it.each([false, true])("opts into server token completion only for a public scan (private=%s)", async priv => {
    const fetcher = vi.fn().mockResolvedValue(new Response('event: error\ndata: {"error":"stopped"}\n\n'));
    vi.stubGlobal("fetch", fetcher);
    streamAudit("@argus", priv, { onStep: vi.fn(), onDone: vi.fn(), onError: vi.fn() }, "investment_due_diligence", undefined, "owned-run-123", true);
    await vi.advanceTimersByTimeAsync(0);
    expect(String(fetcher.mock.calls[0][0]).includes("tokenExecution=server")).toBe(!priv);
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
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/^\/api\/audit\?handle=%40argus&intent=investment_due_diligence&creditKey=[0-9a-f-]+$/),
      expect.objectContaining({ headers: { accept: "text/event-stream" } }),
    );
    expect(handlers.onStep).not.toHaveBeenCalled();
    expect(handlers.onDone).toHaveBeenCalledOnce();
    expect(handlers.onError).not.toHaveBeenCalled();
    abort();
  });

  it("sends the decision intent to the research director", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('event: done\ndata: {"handle":"@argus","report":{}}\n\n'));
        controller.close();
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(body, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    streamAudit("@argus", true, { onStep: vi.fn(), onDone: vi.fn(), onError: vi.fn() }, "identity_and_control");
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/^\/api\/audit\?handle=%40argus&intent=identity_and_control&creditKey=[0-9a-f-]+&private=1$/),
      expect.any(Object),
    );
  });

  it("forwards the investigation contract into the embedded project scan", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('event: done\ndata: {"handle":"@CLUTCHMARKETS","report":{}}\n\n'));
        controller.close();
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(body, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    streamAudit(
      "@CLUTCHMARKETS",
      true,
      { onStep: vi.fn(), onDone: vi.fn(), onError: vi.fn() },
      "investment_due_diligence",
      {
        tokenAddress: "0xe934e36A439C94017B64a3FecE66AF12099aBF50",
        tokenChain: "robinhood",
        tokenSymbol: "STONKBROKER",
      },
    );
    await vi.advanceTimersByTimeAsync(0);

    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain("handle=%40CLUTCHMARKETS");
    expect(url).toContain("address=0xe934e36A439C94017B64a3FecE66AF12099aBF50");
    expect(url).toContain("chain=robinhood");
    expect(url).toContain("symbol=STONKBROKER");
    expect(url).toContain("private=1");
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
    // A silent stream is a dropped connection, not a server rejection: the
    // caller must keep polling for the server's own save, never relaunch.
    expect(handlers.onError).toHaveBeenCalledWith("timed out: the audit stream stopped responding", { kind: "stream_dropped" });
    expect(handlers.onDone).not.toHaveBeenCalled();
  });
});

describe("scan replay recovery", () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  it.each([
    ["scan_run_already_claimed", "stream_dropped"],
    ["idempotency_subject_mismatch", "rejected"],
  ])("classifies %s without issuing a replacement request", async (error, kind) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error, message: "request conflict" }), { status: 409 }));
    vi.stubGlobal("fetch", fetchMock);
    const handlers = { onStep: vi.fn(), onDone: vi.fn(), onError: vi.fn() };
    streamAudit("@example", false, handlers, undefined, undefined, "owned-run-key");
    await vi.waitFor(() => expect(handlers.onError).toHaveBeenCalledWith(expect.any(String), { kind }));
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("creditKey=owned-run-key"), expect.objectContaining({ method: "POST", cache: "no-store" }));
  });
  it("ignores all events after the terminal event", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('event: done\ndata: {"handle":"@example"}\n\nevent: step\ndata: {"token":{"address":"late"}}\n\nevent: error\ndata: {"error":"late"}\n\n')));
    const handlers = { onStep: vi.fn(), onDone: vi.fn(), onError: vi.fn() };
    streamAudit("@example", false, handlers);
    await vi.waitFor(() => expect(handlers.onDone).toHaveBeenCalledOnce());
    expect(handlers.onStep).not.toHaveBeenCalled();
    expect(handlers.onError).not.toHaveBeenCalled();
  });
  it("cannot finish an explicitly cancelled scan when a late response arrives", async () => {
    let respond!: (value: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => { respond = resolve; })));
    const handlers = { onStep: vi.fn(), onDone: vi.fn(), onError: vi.fn() };
    const cancel = streamAudit("@example", false, handlers);
    cancel();
    respond(new Response('event: done\ndata: {"handle":"@example"}\n\n'));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(handlers.onDone).not.toHaveBeenCalled();
    expect(handlers.onError).not.toHaveBeenCalled();
  });
});
