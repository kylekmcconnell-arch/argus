import { afterEach, describe, expect, it, vi } from "vitest";
import { sameWalletAddress, screenDeployerRisk } from "./audit";

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

describe("same-address deployer gate", () => {
  it("does not treat mixed-case EVM checksums as different wallets", () => {
    expect(sameWalletAddress(
      "0xABCDEF0123456789ABCDEF0123456789ABCDEF01",
      "0xabcdef0123456789abcdef0123456789abcdef01",
    )).toBe(true);
  });

  it("compares non-EVM addresses as exact strings so a mint is not traced as a team wallet", () => {
    const mint = "5NHPWfmaUi19A5sjR3rCx1X2HuGYrasoTF9RmxCspump";
    expect(sameWalletAddress(mint, mint)).toBe(true);
    expect(sameWalletAddress(mint, "9AhKqLR67hwapvG8SA2JFXaCshXc9nALJjpKaHZrsbkw")).toBe(false);
  });
});
