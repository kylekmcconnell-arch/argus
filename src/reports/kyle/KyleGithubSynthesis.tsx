import { Code, GitBranch, SealCheck } from "@phosphor-icons/react";
import type { GithubAssessment } from "../../data/evidence";

function maintenanceRead(days?: number): { label: string; detail: string } {
  if (days == null) return { label: "Recency unknown", detail: "The saved assessment did not contain a latest-push date." };
  if (days <= 45) return { label: "Actively maintained", detail: `The most recent saved repository activity was ${days} ${days === 1 ? "day" : "days"} before this assessment.` };
  if (days <= 180) return { label: "Recently maintained", detail: `The most recent saved repository activity was about ${Math.max(1, Math.round(days / 30))} months before this assessment.` };
  return { label: "Maintenance signal is aging", detail: `The most recent saved repository activity was about ${Math.max(1, Math.round(days / 365))} ${days < 548 ? "year" : "years"} before this assessment.` };
}

function validationRead(stars: number): { label: string; detail: string } {
  if (stars >= 1_000) return { label: "Strong external validation", detail: `${stars.toLocaleString("en-US")} stars across original repositories indicate material developer attention.` };
  if (stars >= 100) return { label: "Visible external validation", detail: `${stars.toLocaleString("en-US")} stars across original repositories show meaningful outside attention.` };
  if (stars > 0) return { label: "Modest external validation", detail: `${stars.toLocaleString("en-US")} stars across original repositories show some outside attention, but not broad adoption.` };
  return { label: "External validation not established", detail: "The saved assessment found no stars across the original repositories it reviewed." };
}

export function KyleGithubSynthesis({ assessment }: { assessment: GithubAssessment }) {
  const total = assessment.originalCount + assessment.forkCount;
  const originalShare = total > 0 ? Math.round((assessment.originalCount / total) * 100) : 0;
  const maintenance = maintenanceRead(assessment.daysSinceActivity);
  const validation = validationRead(assessment.totalStarsOnOriginals);
  const sourceConfidence = assessment.confidence === "gold"
    ? "The account is bound through a verified X-to-GitHub link."
    : "The GitHub account match is not independently confirmed.";
  const headline = `${maintenance.label}, ${validation.label.toLowerCase()}.`;

  return (
    <section className="kyle-github-synthesis" aria-label="ARGUS GitHub interpretation">
      <p className="kyle-overline mono">ARGUS DEVELOPMENT READ</p>
      <h3>{headline}</h3>
      <p>
        {assessment.originalCount} of {total} reviewed repositories are original ({originalShare}%). {maintenance.detail} {validation.detail}
      </p>
      <div>
        <span><Code size={17} weight="duotone" aria-hidden="true" /><strong>{maintenance.label}</strong><small>Repository recency</small></span>
        <span><GitBranch size={17} weight="duotone" aria-hidden="true" /><strong>{originalShare}% original</strong><small>Original versus forked work</small></span>
        <span><SealCheck size={17} weight="duotone" aria-hidden="true" /><strong>{assessment.confidence === "gold" ? "Verified identity link" : "Identity link unresolved"}</strong><small>{sourceConfidence}</small></span>
      </div>
    </section>
  );
}
