import { ScoreComposition } from "../components/ScoreComposition";
import { AskReport } from "../components/AskReport";

/* Dev-only harness for the composition strip (?design-preview=composition).
   Representative rows shaped like a governing FOUNDER role's axes; values
   invented, wording in the register the engine actually produces. */

const ROWS = [
  {
    axis: "P1_team_and_identity",
    label: "Team & identity",
    score: 14,
    weight: 25,
    rationale:
      "The founding pair is doxxed with verifiable prior work, but five of the fourteen named team members have no footprint predating this company, and one advisor wallet holds 0.8% of supply with no vesting and no disclosed role.",
    supportCount: 9,
    counterCount: 2,
    questionCount: 3,
  },
  {
    axis: "P2_track_record",
    label: "Track record",
    score: 17,
    weight: 20,
    rationale:
      "Two prior ventures went full cycle; one returned capital through the 2022 drawdown. References were strong, including two reached outside the provided list.",
    supportCount: 7,
    counterCount: 0,
    questionCount: 1,
  },
  {
    axis: "P3_technical_reality",
    label: "Technical reality",
    score: 10,
    weight: 20,
    rationale:
      "Commit velocity matches claimed headcount and the deployed program hash matches the repo, but 31 commits touching withdrawal paths are past the last audit.",
    supportCount: 6,
    counterCount: 1,
    questionCount: 2,
  },
  {
    axis: "P4_market_conduct",
    label: "Market conduct",
    score: 6,
    weight: 15,
    rationale:
      "31% of supply unlocks over the next two quarters into thin volume. Insider wallets are clean to date; the risk is structural, not behavioral.",
    supportCount: 5,
    counterCount: 0,
    questionCount: 2,
  },
  {
    axis: "P5_communications",
    label: "Communications",
    score: 8,
    weight: 10,
    rationale:
      "Claims in public posts reconcile with the onchain record; advertised and realized yields differ by 0.4%. Roughly a third of the follower base is low-quality.",
    supportCount: 4,
    counterCount: 1,
    questionCount: 0,
  },
  {
    axis: "P6_transparency_integrity",
    label: "Transparency & integrity",
    score: 7,
    weight: 10,
    rationale:
      "Treasury wallets are disclosed and reconcile. The undisclosed fifth multisig signer and the unexplained advisor allocation are the open integrity items.",
    supportCount: 5,
    counterCount: 0,
    questionCount: 2,
  },
];

export function CompositionPreview() {
  return (
    <div className="min-h-screen bg-void px-6 py-10 text-ink">
      <div className="mx-auto max-w-[760px]">
        <div className="eyebrow">design preview · composition strip</div>
        <h1 className="display mt-2 text-[32px] leading-tight">Auric Protocol</h1>
        <p className="mt-1 text-[13.5px] text-ink-dim">
          62 / 100 · CAUTION · the strip sits directly under the report hero
        </p>
        <ScoreComposition rows={ROWS} totalScore={62} />
        {/* The console the challenge affordance lands on. The fixture version
            id exists only so the input is live; /api/ask is absent in vite
            dev, so asking returns the network-error line — expected. */}
        <div id="ask-report" className="mt-5 scroll-mt-8">
          <AskReport subject="@auricprotocol" reportVersionId="00000000-0000-4000-8000-000000000000" />
        </div>
      </div>
    </div>
  );
}
