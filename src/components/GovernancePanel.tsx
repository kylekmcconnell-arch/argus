import { useEffect, useState } from "react";
import { shortAddr } from "../lib/wallets";
import { fetchPanelJson, panelRequestFailure, type PanelRequestFailure } from "../lib/panelCostHeaders";
import { PanelRequestNotice } from "./PanelRequestNotice";

/**
 * WHO ACTUALLY DECIDES.
 *
 * Every other panel here measures holdings. This one measures decisions: of the
 * addresses that voted on the project's last governance proposals, how few
 * carried the result. Two addresses casting 80% of the voting power out of 118
 * that voted is a fact about who can move a protocol, and it is not published
 * anywhere a reader would normally look.
 *
 * Two things are said wherever the numbers are, because without them the
 * figures read as an accusation they do not support. Voting power is not
 * ownership: it can include tokens delegated by other holders, which is the
 * system working as designed. And a Snapshot vote is off-chain signalling, so
 * whether a result binds the protocol depends on a process this does not check.
 *
 * The panel never renders a space that could not be tied to the subject. A
 * name match is not a binding: a zero-follower space named "uniswap" votes on
 * the genuine UNI contract, so an unbound space publishes nothing at all.
 */

interface Voter {
  address: string;
  votingPower: number;
  sharePct: number;
}

interface Proposal {
  id: string;
  title: string;
  voters: number;
  totalVotingPower: number;
  quorum: number | null;
  quorumMet: boolean | null;
  topVoters: Voter[];
  top1Pct: number | null;
  top2Pct: number | null;
  contested: boolean;
  topVoterExceedsMargin: boolean | null;
  endedAt: string | null;
}

export interface GovernancePayload {
  available: boolean;
  note: string | null;
  space: {
    id: string;
    name: string;
    verifiedBySnapshot: boolean;
    followers: number;
    proposalCount: number;
    binding: "token_contract" | "official_x" | "official_domain" | "supplied";
  } | null;
  proposals: Proposal[];
  delegationDetected: boolean;
  claims: string[];
}

const BINDING_COPY: Record<string, string> = {
  token_contract: "legacy token-strategy match; this alone does not bind the space to the project",
  official_x: "matched by the project's official X account",
  official_domain: "matched by the project's official domain",
  supplied: "legacy caller-supplied space; independent project binding was not recorded",
};

const pct = (value: number): string => `${value >= 10 ? value.toFixed(0) : value.toFixed(1)}%`;

export function GovernancePanel({
  name,
  address,
  handle,
  website,
}: {
  name?: string | null;
  address?: string | null;
  handle?: string | null;
  website?: string | null;
}) {
  const [data, setData] = useState<GovernancePayload | null>(null);
  const [failure, setFailure] = useState<PanelRequestFailure | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!name) return;
    let live = true;
    setLoading(true);
    const query = new URLSearchParams({ name });
    if (address) query.set("address", address);
    if (handle) query.set("handle", handle);
    if (website) query.set("website", website);
    fetchPanelJson<GovernancePayload>(`/api/governance?${query.toString()}`)
      .then((payload) => { if (live) setData(payload); })
      .catch((error) => { if (live) setFailure(panelRequestFailure(error)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [name, address, handle, website]);

  if (!name) return null;
  if (failure) return <PanelRequestNotice failure={failure} label="Governance concentration" />;
  if (loading && !data) {
    return (
      <div className="panel p-4">
        <div className="eyebrow mb-2">Who decides</div>
        <div className="scan-bar" />
      </div>
    );
  }
  if (!data) return null;

  // An unbound or unread space publishes its reason and no figures. A project
  // with no governance record must never look like one with a clean record.
  if (!data.available || !data.space) {
    return (
      <div className="panel p-4">
        <div className="eyebrow mb-2">Who decides</div>
        <p className="text-[12.5px] leading-relaxed text-ink-dim">
          {data.note ?? "No Snapshot governance record was read for this project."}
        </p>
      </div>
    );
  }

  const measured = data.proposals.filter((proposal) => proposal.top2Pct !== null);

  return (
    <section className="panel p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="eyebrow">Who decides</span>
        <span className="mono text-[11px] text-ink-faint">Snapshot · {data.space.id}</span>
      </div>

      <p className="mt-2 text-[12.5px] leading-relaxed text-ink-dim">
        {data.space.verifiedBySnapshot ? "Verified by Snapshot and " : ""}
        {BINDING_COPY[data.space.binding] ?? "matched to this project"}.
        {" "}Shares below are of the voting power cast on each proposal, over the addresses that voted.
      </p>

      {measured.length > 0 && (
        <ol className="mt-3 divide-y divide-line/60 border-t border-line/60">
          {measured.map((proposal) => (
            <li key={proposal.id} className="py-2">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="min-w-0 text-[12px] text-ink">{proposal.title}</span>
                <span className="mono shrink-0 text-[11.5px] tabular text-ink-dim">
                  top 2 = {pct(proposal.top2Pct as number)}
                  <span className="text-ink-faint"> of {proposal.voters} voters</span>
                </span>
              </div>
              <div className="mono mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10.5px] text-ink-faint">
                {proposal.topVoters.slice(0, 2).map((voter) => (
                  <span key={voter.address}>{shortAddr(voter.address)} {pct(voter.sharePct)}</span>
                ))}
                {proposal.quorumMet === false && (
                  <span style={{ color: "var(--color-caution)" }}>closed below quorum</span>
                )}
                {proposal.topVoterExceedsMargin === true && (
                  <span style={{ color: "var(--color-caution)" }}>largest voter exceeded the margin</span>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}

      {measured.length === 0 && (
        <p className="mt-3 text-[12.5px] text-ink-faint">
          {data.note ?? "No closed proposal in this space had a readable voting record, so concentration is not measured here."}
        </p>
      )}

      {data.claims.map((claim) => (
        <p key={claim} className="mt-3 text-[12.5px] leading-relaxed text-ink-dim">{claim}</p>
      ))}
    </section>
  );
}
