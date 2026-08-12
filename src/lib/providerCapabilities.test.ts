import { afterEach, describe, expect, it, vi } from "vitest";
import { arkhamProviderEnabled } from "./providerCapabilities";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("provider capabilities", () => {
  it("keeps Arkham disabled unless it is explicitly enabled", () => {
    vi.stubEnv("VITE_ARKHAM_PROVIDER_ENABLED", "");
    expect(arkhamProviderEnabled()).toBe(false);

    vi.stubEnv("VITE_ARKHAM_PROVIDER_ENABLED", "true");
    expect(arkhamProviderEnabled()).toBe(true);
  });
});
