import { requestChallenge } from "../lib/challenge";

/** Opens the existing report assistant; never submits or changes a score. */
export function ReportChallengeButton({ context, anchorId, label = "Challenge this section" }: {
  context: string;
  anchorId?: string | null;
  label?: string;
}) {
  if (!anchorId) return null;
  return <button type="button" className="btn-chip mt-2 min-h-11 text-[12px]"
    aria-label={`${label}: ${context}`}
    onClick={() => requestChallenge(context, anchorId)}>{label}</button>;
}
