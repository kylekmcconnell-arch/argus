import { afterEach, describe, expect, it, vi } from "vitest";
import handler from "./keys-status";

interface ProviderRow {
  label: string;
  powers: string;
  configured: boolean;
}

interface KeylessRow {
  label: string;
}

interface RegistryBody {
  providers: ProviderRow[];
  keyless: KeylessRow[];
}

function responseHarness() {
  const captured: { status?: number; body?: RegistryBody; headers: Record<string, string> } = { headers: {} };
  const response = {
    setHeader(name: string, value: string) {
      captured.headers[name.toLowerCase()] = value;
      return response;
    },
    status(code: number) {
      captured.status = code;
      return response;
    },
    json(body: unknown) {
      captured.body = body as RegistryBody;
      return response;
    },
  };
  return { captured, response };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("provider registry truth", () => {
  it("labels inactive Bitquery honestly and separates credentialed Reddit from keyless Telegram", async () => {
    vi.stubEnv("BITQUERY_API_KEY", "configured");
    vi.stubEnv("REDDIT_CLIENT_ID", "client");
    vi.stubEnv("REDDIT_CLIENT_SECRET", "secret");
    vi.stubEnv("ARKHAM_API_KEY", "arkham");
    const { captured, response } = responseHarness();

    await handler({} as never, response as never);

    const providers = captured.body?.providers ?? [];
    const keyless = captured.body?.keyless ?? [];
    expect(providers.find((provider) => provider.label === "Bitquery")).toMatchObject({
      configured: true,
      powers: expect.stringContaining("does not currently run or attest audits"),
    });
    expect(providers.find((provider) => provider.label === "Reddit OAuth")).toMatchObject({ configured: true });
    expect(providers.find((provider) => provider.label === "Arkham")).toMatchObject({ configured: true });
    expect(keyless.map((provider) => provider.label)).toContain("Telegram");
    expect(keyless.map((provider) => provider.label)).not.toContain("Reddit + Telegram");
  });

  it("accepts the preferred opaque Supabase secret or the legacy service-role fallback", async () => {
    vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_example");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const first = responseHarness();
    await handler({} as never, first.response as never);
    expect(first.captured.body?.providers.find((provider) => provider.label === "Supabase"))
      .toMatchObject({ configured: true });

    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "legacy-service-role");
    const second = responseHarness();
    await handler({} as never, second.response as never);
    expect(second.captured.body?.providers.find((provider) => provider.label === "Supabase"))
      .toMatchObject({ configured: true });
  });
});
