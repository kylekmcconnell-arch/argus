// In eval mode, a public-web request still needs the production transport's
// DNS pinning when it is allowed to go live, but record/replay must see the
// request before that socket opens. This in-memory callback lets the fetch
// harness invoke the pinned native request only for a record or explicit live
// lane. A frozen replay hit never calls it.

const EVAL_NATIVE_REQUEST = Symbol.for("argus.eval.native-request");

type NativeRequest = () => Promise<Response>;

export function attachEvalNativeRequest(init: RequestInit, request: NativeRequest): RequestInit {
  Object.defineProperty(init, EVAL_NATIVE_REQUEST, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: request,
  });
  return init;
}

export function evalNativeRequest(init?: RequestInit): NativeRequest | null {
  if (!init || typeof init !== "object") return null;
  const candidate = (init as unknown as Record<PropertyKey, unknown>)[EVAL_NATIVE_REQUEST];
  return typeof candidate === "function" ? candidate as NativeRequest : null;
}
