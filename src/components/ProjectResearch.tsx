import { NewsSection } from "./NewsSection";
import { ProjectDocs } from "./ProjectDocs";
import { ProjectIntel } from "./ProjectIntel";
import { GithubForensics } from "./GithubForensics";

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
}: {
  name?: string | null;
  symbol?: string | null;
  domain?: string | null;
  githubOrg?: string | null;
  subjectKey?: string;
  newsHandle?: string | null;
  record?: boolean;
  panelCostToken?: string;
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
      {githubOrg && <GithubForensics org={githubOrg} subjectKey={subjectKey} panelCostToken={panelCostToken} record={record} />}
    </div>
  );
}
