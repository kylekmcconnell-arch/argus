/**
 * Timestamp a provider observation. Offline replays use the recording boundary
 * instead of pretending that a frozen response was observed today.
 */
export function captureTimestamp(): string {
  if (process.env.ARGUS_EVAL_MODE === "replay") {
    const recordedAt = process.env.ARGUS_EVAL_CAPTURED_AT?.trim();
    if (recordedAt && Number.isFinite(Date.parse(recordedAt))) {
      return new Date(recordedAt).toISOString();
    }
  }
  return new Date().toISOString();
}
