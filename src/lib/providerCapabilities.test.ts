import { afterEach, describe, expect, it, vi } from "vitest";
import { arkhamProviderEnabled } from "./providerCapabilities";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("provider capabilities", () => {
  it("opts Arkham in when the env is empty", () => {
    vi.stubEnv("VITE_ARKHAM_PROVIDER_ENABLED", "");
    expect(arkhamProviderEnabled()).toBe(true);
  });

  it("keeps matching 1|true|on|enabled as on", () => {
    vi.stubEnv("VITE_ARKHAM_PROVIDER_ENABLED", "true");
    expect(arkhamProviderEnabled()).toBe(true);
  });

  it("disables on explicit false/off", () => {
    vi.stubEnv("VITE_ARKHAM_PROVIDER_ENABLED", "false");
    expect(arkhamProviderEnabled()).toBe(false);

    vi.stubEnv("VITE_ARKHAM_PROVIDER_ENABLED", "off");
    expect(arkhamProviderEnabled()).toBe(false);
  });
});
