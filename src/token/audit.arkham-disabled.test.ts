import { afterEach, describe, expect, it, vi } from "vitest";
import { screenDeployerRisk } from "./audit";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("disabled Arkham screening", () => {
  it("returns before making a provider request", async () => {
    vi.stubEnv("VITE_ARKHAM_PROVIDER_ENABLED", "false");
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(screenDeployerRisk("0x4444444444444444444444444444444444444444", fetchImpl)).resolves.toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
