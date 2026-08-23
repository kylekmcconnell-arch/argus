import type { Investigation } from "../lib/investigation";
import { AuthContext } from "../auth-context";
import { AppShell } from "../components/AppShell";
import { FeedbackButton } from "../components/FeedbackButton";
import { InvestigationReport } from "../components/InvestigationReport";

const REPORT_VERSION_ID = "00000000-0000-4000-8000-000000000777";

function previewInvestigation(): Investigation {
  return {
    rootRef: "0xe934e36A439C94017B64a3FecE66AF12099aBF50",
    projectX: "@ClutchMarkets",
    siteUrl: "https://stonkbrokers.io/",
    recon: null,
    founders: [],
    founderNote: "OxSimpleFarmer was recovered from source-bound founder evidence.",
    deployerTrail: {
      wallet: "0x4c197eEa40000000000000000000000000000001",
      funder: { address: "0x8f3a000000000000000000000000000000009b21", label: "Hot wallet", kind: "wallet" },
      chain: [{
        from: "0x8f3a000000000000000000000000000000009b21",
        to: "0x4c197eEa40000000000000000000000000000001",
        label: "seed funding",
        kind: "wallet",
      }],
      tokensCreated: 1,
      serialDeployer: false,
      walletAgeDays: 42,
      firstActivity: "2026-06-26T10:00:00.000Z",
      note: "Deployer received seed funding from one wallet.",
    },
    webTeam: [],
    token: {
      address: "0xe934e36A439C94017B64a3FecE66AF12099aBF50",
      chain: "ethereum",
      dexId: "uniswap",
      symbol: "STONKBROKER",
      name: "StonkBrokers",
      verdict: "CAUTION",
      score: 58,
      capApplied: null,
      headline: "Identity is increasingly clear, but control and early funding still need deeper review.",
      axes: [],
      safety: { available: false, simChecked: false },
      socials: [],
      projectX: "@ClutchMarkets",
      deployer: "0x4c197eEa40000000000000000000000000000001",
      topHolders: [
        { address: "0x8f3a000000000000000000000000000000009b21", pct: 8.4, tag: "holder" },
        { address: "0xc21d000000000000000000000000000000007e44", pct: 4.9, tag: "holder" },
      ],
      insiderPct: 12.2,
      bundleCount: 3,
      bundleRisk: "medium",
      cg: null,
      graph: {
        nodes: [
          { type: "Token", key: "$STONKBROKER", label: "$STONKBROKER", subject: true },
          { type: "Identity", subtype: "Wallet", key: "wallet:0x4c197eea", label: "deployer wallet" },
          { type: "Identity", subtype: "HolderWallet", key: "holder:0x8f3a", label: "hot wallet" },
          { type: "Identity", subtype: "HolderWallet", key: "holder:0xc21d", label: "treasury" },
          { type: "Identity", subtype: "Wallet", key: "wallet:0xaa9e", label: "deployer" },
        ],
        edges: [
          { src: "$STONKBROKER", dst: "wallet:0x4c197eea", type: "DEPLOYED_BY" },
          { src: "holder:0x8f3a", dst: "wallet:0x4c197eea", type: "FUNDED" },
          { src: "$STONKBROKER", dst: "holder:0xc21d", type: "HELD_BY" },
          { src: "$STONKBROKER", dst: "wallet:0xaa9e", type: "FUNDED_BY" },
        ],
      },
      findings: [{ claim: "Early funding origin remains unresolved", source: "deployer trace", tone: "warn" }],
      trace: [],
      live: true,
      safetyChecked: false,
    },
    projectAccount: {
      handle: "@ClutchMarkets",
      display_name: "Clutch Markets",
      avatar: "",
      bio: "The laboratory for decentralized onchain markets.",
      followers: "17.3K",
      joined: "",
      identity_note: "Exact X account bound to the STONKBROKER contract.",
      profile_captured_at: "2026-08-07T12:00:00.000Z",
      headline: "Project identity is bound; operator control still needs review.",
      live: true,
      notableFollowers: [],
      contradictions: [],
      webTeam: [{
        name: "Dillon",
        handle: "@trustdev_eth",
        role: "Operator",
        evidence: 'Their current X bio states "Shipping real-time dApps on Solana + EVM ex @clutchmarkets".',
        source: "project scan",
        sourceUrl: "https://x.com/ClutchMarkets/status/1",
        provider: "twitterapi",
        evidence_origin: "deterministic",
        artifact_verified: true,
        handleProvenance: "subject_first_party",
      }],
      leaderDepartures: [],
      basicFacts: [
        {
          factId: "clutch-legal",
          subjectKey: "@ClutchMarkets",
          predicate: "legal_entity",
          value: "Clutch Labs LLC",
          normalizedValue: "clutch labs llc",
          status: "verified",
          critical: false,
          sources: [{
            url: "https://clutch.markets/terms",
            title: "Clutch Markets terms",
            sourceClass: "official_subject",
            relation: "supports",
            excerpt: "Clutch Labs LLC operates the Clutch Markets service.",
            contentHash: "a".repeat(64),
            capturedAt: "2026-08-07T12:00:00.000Z",
            provider: "public-web",
            artifactVerified: true,
          }],
          evidence_origin: "deterministic",
          artifact_verified: true,
          provider: "public-web",
        },
        {
          factId: "clutch-product",
          subjectKey: "@ClutchMarkets",
          predicate: "product",
          value: "Clutch Swap",
          normalizedValue: "clutch swap",
          status: "verified",
          critical: true,
          sources: [{
            url: "https://clutch.markets/",
            title: "Clutch Markets",
            sourceClass: "official_subject",
            relation: "supports",
            excerpt: "Clutch Swap is an onchain perpetual-markets product.",
            contentHash: "b".repeat(64),
            capturedAt: "2026-08-07T12:00:00.000Z",
            provider: "public-web",
            artifactVerified: true,
          }],
          evidence_origin: "deterministic",
          artifact_verified: true,
          provider: "public-web",
        },
        {
          factId: "clutch-product-perps",
          subjectKey: "@ClutchMarkets",
          predicate: "product",
          value: "Clutch Perps",
          normalizedValue: "clutch perps",
          status: "verified",
          critical: false,
          sources: [{
            url: "https://docs.clutch.markets/perps",
            title: "Clutch Perps documentation",
            sourceClass: "official_subject",
            relation: "supports",
            excerpt: "Clutch Perps is the project's perpetual-markets product.",
            contentHash: "c".repeat(64),
            capturedAt: "2026-08-07T12:00:00.000Z",
            provider: "public-web",
            artifactVerified: true,
          }],
          evidence_origin: "deterministic",
          artifact_verified: true,
          provider: "public-web",
        },
        {
          factId: "clutch-product-earn",
          subjectKey: "@ClutchMarkets",
          predicate: "product",
          value: "Clutch Earn",
          normalizedValue: "clutch earn",
          status: "verified",
          critical: false,
          sources: [{
            url: "https://docs.clutch.markets/earn",
            title: "Clutch Earn documentation",
            sourceClass: "official_subject",
            relation: "supports",
            excerpt: "Clutch Earn is the project's yield product.",
            contentHash: "d".repeat(64),
            capturedAt: "2026-08-07T12:00:00.000Z",
            provider: "public-web",
            artifactVerified: true,
          }],
          evidence_origin: "deterministic",
          artifact_verified: true,
          provider: "public-web",
        },
      ],
      basicFactLeads: [{
        subject: "Clutch",
        predicate: "funding",
        value: "$50 million Series D",
        questionId: "project.funding",
        excerpt: "Canadian used-car retailer Clutch raised a Series D.",
        sourceUrl: "https://torys.com/clutch-series-d",
        sourceTitle: "Clutch Series D financing",
        evidence_origin: "model_lead",
        artifact_verified: false,
        provider: "claude-web-search",
      }],
      report: {
        composite_verdict: "INCOMPLETE",
        governing_score: null,
        identity_confidence: "Confirmed",
        roles: [],
      },
      evidence: {
        ventures: [],
        testimonials: [],
        advised: [],
        associates: [{
          associate_key: "@0xSimpleFarmer",
          relation: "team:Founder",
          notes: "The official Clutch Markets account identifies @0xSimpleFarmer as founder.",
          evidence_url: "https://x.com/ClutchMarkets/status/1",
          evidence_origin: "deterministic",
          artifact_verified: true,
          provider: "official-x",
        }],
        wallets: [],
        promotions: [],
      },
      graph: { nodes: [], edges: [] },
    } as unknown as NonNullable<Investigation["projectAccount"]>,
    versionContext: {
      version: 1,
      reportVersionId: REPORT_VERSION_ID,
      caseId: "00000000-0000-4000-8000-000000000778",
      createdAt: "2026-08-07T12:00:00.000Z",
      checks: [],
      completenessState: "partial",
      attestationState: "server_collected",
    },
  } as unknown as Investigation;
}

export function ArgusEyePreview() {
  const inv = previewInvestigation();
  return (
    <AuthContext.Provider value={{
      user: { id: "preview", email: "preview@argus.local", displayName: "Kyle McConnell" },
      organizationId: "preview",
      role: "owner",
      signOut: async () => undefined,
    }}>
      <FeedbackButton />
      <AppShell onNav={() => undefined} onAudit={() => undefined} activeHandle="$STONKBROKER" view="audit">
        <InvestigationReport
          inv={inv}
          onAudit={() => undefined}
          onReset={() => undefined}
          onOpenToken={() => undefined}
          onOpenProjectAccount={() => undefined}
          onReAudit={() => undefined}
          onOpenBrief={() => undefined}
        />
      </AppShell>
    </AuthContext.Provider>
  );
}
