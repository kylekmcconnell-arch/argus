export function requiredPanelHeaders(panelCostToken: string): Record<string, string> {
  const token = panelCostToken.trim();
  if (!token) throw new Error("A signed panel cost token is required.");
  return {
    "x-argus-panel-context": "required",
    "x-argus-panel-token": token,
  };
}

export type PanelRequestFailure = "rescan_required" | "unavailable";

export class PanelRequestError extends Error {
  readonly failure: PanelRequestFailure;
  readonly status: number;

  constructor(failure: PanelRequestFailure, status: number, message: string) {
    super(message);
    this.name = "PanelRequestError";
    this.failure = failure;
    this.status = status;
  }
}

type ErrorPayload = { error?: unknown; message?: unknown; note?: unknown };

function errorPayload(value: unknown): ErrorPayload {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as ErrorPayload
    : {};
}

// Supplemental panels must never interpret an HTTP error body as provider data.
// In particular, an expired signed report capability is an explicit rescan state,
// not an empty result that could be mistaken for a clean investigation.
export async function readPanelResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null) as unknown;
  const payload = errorPayload(body);
  if (!response.ok) {
    const code = typeof payload.error === "string" ? payload.error : "";
    const message = typeof payload.message === "string" ? payload.message : "";
    if (response.status === 409 && code === "invalid_panel_context") {
      throw new PanelRequestError(
        "rescan_required",
        response.status,
        message || "This saved report expired. Rescan before running supplemental intelligence.",
      );
    }
    throw new PanelRequestError(
      "unavailable",
      response.status,
      message || `Supplemental provider request failed (${response.status}).`,
    );
  }

  // Several older panel routes return HTTP 200 so an optional provider failure
  // never takes down the report, but also include `error` beside an empty result.
  // Treating that body as data turns "the check failed" into a clean-looking
  // zero in every caller that defaults a missing array. The transport may stay
  // non-fatal; the semantic result still has to be unavailable.
  const semanticError = typeof payload.error === "string" ? payload.error.trim() : "";
  if (semanticError) {
    const message = typeof payload.message === "string" && payload.message.trim()
      ? payload.message.trim()
      : typeof payload.note === "string" && payload.note.trim()
        ? payload.note.trim()
        : semanticError;
    throw new PanelRequestError("unavailable", response.status, message);
  }
  return body as T;
}

export async function fetchPanelJson<T>(input: string | URL | Request, init?: RequestInit): Promise<T> {
  try {
    return await readPanelResponse<T>(await fetch(input, init));
  } catch (error) {
    if (error instanceof PanelRequestError) throw error;
    throw new PanelRequestError(
      "unavailable",
      0,
      error instanceof Error ? error.message : "Supplemental provider request failed.",
    );
  }
}

export function panelRequestFailure(error: unknown): PanelRequestFailure {
  return error instanceof PanelRequestError ? error.failure : "unavailable";
}
