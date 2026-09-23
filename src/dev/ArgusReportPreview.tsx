import { Report } from "../components/Report";
import { TokenReport } from "../components/TokenReport";
import type { TokenDossier } from "../token/audit";
import { storedPersonDossier, type StoredReport } from "../lib/reports";
import type { ShippingSummary } from "../threat/shipping";
import fixture from "../reports/argus/__fixtures__/altcoinist-v4.json";

/* Development-only harness for the ARGUS report design.
   ?design-preview=argus-report            owner view of the saved Altcoinist v4 report
   ?design-preview=argus-report&mode=share recipient (read-only) view
   ?design-preview=argus-report&code=demo  the Code chapter with a made-up development read
   ?design-preview=argus-report&kind=token the token scan of the same saved case
   The scroll container mirrors the workspace's main pane so sticky chrome
   behaves exactly as it does inside the app shell. */

/* A fabricated development read, for laying out the Code chapter only. The
   saved Altcoinist report predates the development lane, so nothing real
   exercises the populated states. This never leaves the dev preview: it is not
   imported by the app, the report or any test of saved data. */
const DEMO_SHIPPING: ShippingSummary = {
  version: 1,
  target: "example-org",
  capturedAt: "2026-09-18T09:00:00.000Z",
  windowDays: 90,
  grade: "shipping-solo",
  headline: "Shipping, but one account writes 86% of it: 214 commits in 90 days",
  cadenceStatus: "shipping",
  totalCommits: 214,
  activeWeeks: 11,
  distinctHuman: 3,
  concentration: "single-author",
  authorship: "mixed",
  origin: "original",
  stars: "suspect",
  market: "shipping-into-weakness",
  claimsSupported: 4,
  claimsUnsupported: 2,
  live: "live",
  adoption: "noticed",
  health: "mixed",
  leadDeparted: false,
  reposRead: 6,
  commitsRead: 214,
  releasesInWindow: 5,
  committers: [
    { name: "Christian Andsberg", login: "andzberg", commits: 184, sharePct: 86, kind: "human", freshAccount: false, accountCreatedAt: "2016-04-02T00:00:00.000Z", last30: 61, prior60: 123, twitter: "andzberg", company: "Altcoinist" },
    { name: "dev-contract", login: "dev-contract", commits: 22, sharePct: 10, kind: "human", freshAccount: true, accountCreatedAt: "2026-07-14T00:00:00.000Z", last30: 0, prior60: 22 },
    { name: "github-actions[bot]", login: "github-actions", commits: 8, sharePct: 4, kind: "bot", freshAccount: false, last30: 3, prior60: 5 },
  ],
  goneQuiet: ["dev-contract"],
  churnDetail: "The lead committer is still active. One other human account stopped committing in the last 30 days.",
  license: "permissive",
  licenseId: "MIT",
  ci: "success",
  auditInTree: false,
  lockfileAgeDays: 41,
  medianLinesChanged: 96,
  medianFiles: 4,
  trivialSharePct: 18,
  bulkDropCount: 1,
  aiTrailerCount: 63,
  genericMessageSharePct: 12,
  mirrorSharePct: 0,
  starsTotal: 1840,
  starBurstSharePct: 71,
  starBurstWindowStart: "2026-08-02T00:00:00.000Z",
  starLaunchBurst: false,
  starHistoryDays: 420,
  externalPrs: 2,
  externalIssues: 9,
  activeForks: 3,
  packageDownloadsLastMonth: 310,
  packages: ["@example/sdk"],
  deploysInWindow: 4,
  publishesInWindow: 6,
  codeToChain: 4,
  peerSector: "Trading and execution infrastructure",
  peerPositionCommits: "below",
  peerPositionAuthors: "below",
  peerPositionStars: "above",
  cohortLabel: "Base tokens at a similar stage",
  cohortSize: 9,
  cohortPercentileCommits: 62,
  cohortShippingSharePct: 44,
  roadmapMet: 2,
  roadmapMissed: 1,
  roadmapPending: 3,
  coverageNotes: [
    "GitHub restricted the list of accounts that starred a repository to its admins on 30 June 2026, so star authenticity is read from timing and proportion only.",
    "Four of the six repositories were mined for commit history; the rest had no commits in the window.",
  ],
  reposTotal: 6,
  commitsCounted: 214,
  hygiene: "partial",
  trendWeeks: Array.from({ length: 52 }, (_, index) => {
    const start = Date.UTC(2025, 8, 21) + index * 7 * 864e5;
    const ramp = index < 20 ? 2 + (index % 4) : index < 34 ? 9 + ((index * 5) % 11) : 14 + ((index * 7) % 17);
    return {
      weekStart: new Date(start).toISOString(),
      commits: index === 27 || index === 41 ? 0 : ramp,
      releases: index % 11 === 6 ? 1 : 0,
      deploys: index === 33 || index === 47 ? 1 : 0,
      price: 0.42 + Math.sin(index / 6) * 0.11 - index * 0.0035,
    };
  }),
  trendSource: "provider-weekly" as const,
  top1SharePct: 86,
  botSharePct: 4,
};

export function ArgusReportPreview() {
  const params = new URLSearchParams(window.location.search);
  const share = params.get("mode") === "share";
  const dossier = storedPersonDossier(fixture as unknown as StoredReport);
  // The token leg of the same saved case, rendered as a token scan.
  if (params.get("kind") === "token") {
    const token = { ...(dossier.threat?.dossier as TokenDossier) };
    if (params.get("code") === "demo") token.shipping = DEMO_SHIPPING;
    return (
      <div className="flex h-screen overflow-hidden bg-void">
        <main className="thin-scroll flex-1 overflow-x-hidden overflow-y-auto">
          <TokenReport
            dossier={token}
            onReset={() => undefined}
            onAudit={() => undefined}
            onRescan={() => undefined}
            shareView={share}
          />
        </main>
      </div>
    );
  }
  if (params.get("code") === "demo" && dossier.threat?.dossier) {
    dossier.threat.dossier.shipping = DEMO_SHIPPING;
  }
  return (
    <div className="flex h-screen overflow-hidden bg-void">
      <main className="thin-scroll flex-1 overflow-x-hidden overflow-y-auto">
        <Report
          dossier={dossier}
          onReset={() => undefined}
          shareView={share}
          {...(share ? {} : { onRescan: () => undefined, onAudit: () => undefined })}
        />
      </main>
    </div>
  );
}
