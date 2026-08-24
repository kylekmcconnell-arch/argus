/// <reference types="vite/client" />

const ENABLED_VALUE = /^(?:1|true|on|enabled)$/i;
const DISABLED_VALUE = /^(?:0|false|off|disabled)$/i;

/**
 * Arkham is on for token reports; set VITE_ARKHAM_PROVIDER_ENABLED=false to disable.
 * Empty/unset env opts in. Explicit false/0/off/disabled still disables.
 */
export function arkhamProviderEnabled(): boolean {
  // Vite provides import.meta.env in the browser bundle and Vitest mirrors it.
  const raw = String(import.meta.env?.VITE_ARKHAM_PROVIDER_ENABLED ?? "").trim();
  if (!raw) return true;
  if (DISABLED_VALUE.test(raw)) return false;
  return ENABLED_VALUE.test(raw);
}
