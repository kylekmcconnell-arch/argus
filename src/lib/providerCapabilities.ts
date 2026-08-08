const ENABLED_VALUE = /^(?:1|true|on|enabled)$/i;

/**
 * Arkham is dormant by default while the provider account is inactive.
 * Keeping this as a runtime function lets tests and a future deployment opt in
 * without restoring Arkham as an implicit dependency of every report.
 */
export function arkhamProviderEnabled(): boolean {
  // Vite provides import.meta.env in the browser bundle and Vitest mirrors it.
  // @ts-ignore The browser and server TypeScript projects load different ambient ImportMeta declarations.
  return ENABLED_VALUE.test(String(import.meta.env?.VITE_ARKHAM_PROVIDER_ENABLED ?? "").trim());
}
