import { NewsSection } from "./NewsSection";
import { ProjectDocs } from "./ProjectDocs";
import { ProjectIntel } from "./ProjectIntel";
import { GithubForensics } from "./GithubForensics";
import { GithubShipping } from "./GithubShipping";
import type { ShippingClaim, ShippingPricePoint, ShippingSummary } from "../threat/shipping";

// Unified project-level research cluster. The token, investigation, and site
// reports were each hand-mounting a DIFFERENT subset of these OSINT sections in a
// different order (news was on the person report only, GitHub/domain-intel came
// and went), which is why the same project looked different depending on how you
// opened it. This renders the SAME four sections, in the SAME order, everywhere a
// project subject is shown — so there's one place to change them, and every report
// is consistent. Each sub-panel owns its loading + empty state.
export function ProjectResearch({
  name,
  symbol,
  domain,
  githubOrg,
  subjectKey,
  newsHandle,
  record = true,
  panelCostToken,
  sectorText,
  priceSeries,
  claims,
  token,
  projectHandle,
  docsText,
  previousShipping,
}: {
  name?: string | null;
  symbol?: string | null;
  domain?: string | null;
  githubOrg?: string | null;
  subjectKey?: string;
  newsHandle?: string | null;
  record?: boolean;
  panelCostToken?: string;
  /** Description / bio / site copy the shipping panel detects the sector from. */
  sectorText?: string | null;
  /** Daily closes for the project's token, so shipping can be read against the chart. */
  priceSeries?: ShippingPricePoint[];
  /** The project's own posts, so shipping claims can be graded against the commit log. */
  claims?: ShippingClaim[];
  /** The project's token, so the shipping panel can pull daily closes, the deployer's contract creations and the stage cohort on click. */
  token?: { address: string; chain: string; deployer?: string | null; mcap?: number; ageDays?: number } | null;
  /** The project's X handle, so the shipping panel can grade its own posts against the commit log. */
  projectHandle?: string | null;
  /** Roadmap or docs text with dated promises (investigations carry the site text). */
  docsText?: string | null;
  /** The frozen shipping summary from the previous saved report, for the delta line. */
  previousShipping?: ShippingSummary | null;
}) {
  const newsQuery = (name || symbol || domain || "").toString().trim();
  return (
    <div className="space-y-3">
      {newsQuery && (
        <div className="panel p-4">
          <div className="eyebrow mb-2">News &amp; press</div>
          <NewsSection query={newsQuery} handle={newsHandle ?? undefined} />
        </div>
      )}
      <ProjectDocs name={name} symbol={symbol} domain={domain} panelCostToken={panelCostToken} />
      {domain && <ProjectIntel domain={domain} />}
      {githubOrg && <GithubShipping org={githubOrg} sectorText={[name, sectorText].filter(Boolean).join(" · ")} priceSeries={priceSeries} claims={claims} docsText={docsText} previous={previousShipping} projectHandle={projectHandle} token={token ?? undefined} panelCostToken={panelCostToken} />}
      {githubOrg && <GithubForensics org={githubOrg} subjectKey={subjectKey} panelCostToken={panelCostToken} record={record} />}
    </div>
  );
}
