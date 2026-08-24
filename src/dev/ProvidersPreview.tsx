import { ProvidersPage, type ProviderPageData, type ProviderUsageFeed } from "../components/ProvidersPage";
import { PROVIDER_CATALOG } from "../lib/providerCatalog";

const configured = new Set(["grok", "twitterapi", "github", "pdl", "serper", "helius", "coingecko", "etherscan", "arkham", "gmgn", "supabase"]);

const previewData: ProviderPageData = {
  providers: PROVIDER_CATALOG.filter((provider) => provider.tier !== "keyless").map((provider) => ({
    ...provider,
    configured: configured.has(provider.id),
  })),
  keyless: PROVIDER_CATALOG.filter((provider) => provider.tier === "keyless").map((provider) => ({
    ...provider,
    configured: true,
  })),
  note: "Credential presence is not a live availability test. Recent request outcomes appear separately when recorded.",
};

const previewUsage: ProviderUsageFeed = {
  available: true,
  window: { limit: 40, eventCount: 4 },
  totals: { eventCount: 247, calls: 518, usd: 18.4275 },
  events: [
    { id: "preview-1", reportVersionId: "report-18", provider: "twitterapi", operation: "profile-and-posts", calls: 3, usd: 0.0024, status: "succeeded", createdAt: "2026-08-22T20:28:00.000Z", actor: "Kyle", report: { kind: "person", ref: "@example", label: "@example", version: 8 } },
    { id: "preview-2", reportVersionId: "report-18", provider: "goplus", operation: "contract-safety", calls: 1, usd: 0, status: "succeeded", meta: "keyless", createdAt: "2026-08-22T20:27:00.000Z", actor: "Kyle", report: { kind: "token", ref: "0xexample", label: "$EXAMPLE", version: 8 } },
    { id: "preview-3", reportVersionId: "report-17", provider: "courtlistener", operation: "legal-screen", calls: 1, usd: 0, status: "partial", meta: "caption match requires review", createdAt: "2026-08-22T19:54:00.000Z", actor: "Enigma", report: { kind: "person", ref: "Example Person", label: "Example Person", version: 3 } },
    { id: "preview-4", reportVersionId: "report-16", provider: "arkham", operation: "wallet-labels", calls: 1, usd: 0, status: "failed", meta: "subscription · timeout", createdAt: "2026-08-22T18:42:00.000Z", actor: "Kyle", report: { kind: "token", ref: "0xexample2", label: "$SAMPLE", version: 2 } },
  ],
};

export function ProvidersPreview() {
  return (
    <main className="min-h-screen bg-void text-ink">
      <ProvidersPage previewData={previewData} previewUsage={previewUsage} />
    </main>
  );
}
