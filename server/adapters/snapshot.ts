// Snapshot governance: who actually decides, and on how few wallets.
//
// WHAT THIS ANSWERS. A token report can say the top ten wallets hold 31% of
// supply. It cannot say that two addresses cast 80% of the voting power in the
// project's last governance vote, out of 118 that voted at all. That second
// number is the one that says who can move the protocol, and it is free and
// public: Snapshot's GraphQL hub is keyless.
//
// WHAT IT IS NOT. Voting power on Snapshot INCLUDES tokens delegated by other
// holders, which is the mechanism working as designed, so a large voter is a
// concentration of decision power and NOT evidence of a large holding, still
// less of wrongdoing. Most Snapshot proposals are also off-chain signalling
// with binding execution elsewhere. Both facts are stated wherever the numbers
// are, and this lane never concludes that a project is captured or centralised;
// it reports how many wallets carried a vote and lets the reader judge.
//
// BINDING IS THE HARD PART, AND NAME MATCHING CANNOT DO IT. Probed live:
// searching Snapshot for "uniswap" returns `uniswap-web3.eth` (1 follower),
// `uniswapdefi.eth` (2 followers, someone's personal handle) and `dodus.eth`,
// which is named "uniswap", has zero followers, and whose voting strategy
// points at the GENUINE UNI contract. A space's strategy address is chosen by
// whoever made the space, so a contract address alone proves nothing, exactly
// like the LP-locker names this codebase already refuses to trust. Snapshot's
// own `search` never returned the real space for "uniswap" or "gitcoin" at all,
// and it silently ignores orderBy.
//
// So: candidate space ids come from naming conventions (discovery), and a
// candidate is accepted only when Snapshot itself marks it verified AND one
// independent fact ties it to this subject: a strategy reading the audited
// token contract, the space's X handle matching the official one, or its
// website matching the official domain. Verified alone is still a name match
// and is refused. This is the shape of the DeFiLlama rule, where a slug finds
// the document and only the CoinGecko id lets it speak for the project.

const HUB = "https://hub.snapshot.org/graphql";
const CALL_TIMEOUT_MS = 12_000;

/** Space id suffixes seen on real DAO spaces (uniswapgovernance, aavedao, ens). */
const SPACE_SUFFIXES = ["", "dao", "governance", "gov", "foundation"];

/** Closed proposals summarized. Bounded: this is a free API, not a free budget. */
export const PROPOSAL_WINDOW = 5;
/** Voters read per proposal, highest voting power first. */
export const TOP_VOTERS = 10;

export interface GovernanceVoter {
  address: string;
  /** Voting power cast, delegation included. Never a holding. */
  votingPower: number;
  /** Share of the voting power cast on this proposal, 0-100. */
  sharePct: number;
}

export interface GovernanceProposal {
  id: string;
  title: string;
  /** Addresses that voted. */
  voters: number;
  totalVotingPower: number;
  quorum: number | null;
  /** Null when the space sets no quorum, so silence is not a pass. */
  quorumMet: boolean | null;
  topVoters: GovernanceVoter[];
  top1Pct: number | null;
  top2Pct: number | null;
  /** True when some choice other than the winner drew voting power. */
  contested: boolean;
  /**
   * On a CONTESTED vote only: the top voter's power exceeded the gap between
   * the two leading options. This is a magnitude comparison, not a claim that
   * the voter could flip the result: Snapshot's choice was not collected here.
   * Null on an uncontested vote, where the comparison is meaningless.
   */
  topVoterExceedsMargin: boolean | null;
  endedAt: string | null;
}

export type SpaceBinding = "official_x" | "official_domain";

export interface GovernanceSpace {
  id: string;
  name: string;
  verifiedBySnapshot: boolean;
  followers: number;
  proposalCount: number;
  twitter: string | null;
  website: string | null;
  strategyNames: string[];
  strategyAddresses: string[];
  binding: SpaceBinding;
}

export interface GovernanceReading {
  available: boolean;
  note: string | null;
  space: GovernanceSpace | null;
  proposals: GovernanceProposal[];
  /**
   * A strategy was RECOGNISED as delegation-aware. Positive detection only:
   * Aave's space runs opaque `contract-call` strategies whose delegation
   * behaviour cannot be read from the name, so false here means "not
   * recognised", never "delegation is not counted". Nothing may treat it as
   * evidence that voters are voting their own tokens.
   */
  delegationDetected: boolean;
}

const EMPTY = (note: string): GovernanceReading => ({
  available: false,
  note,
  space: null,
  proposals: [],
  delegationDetected: false,
});

export interface GovernanceSubject {
  /** Project or token name, used only to GENERATE candidate ids. */
  name?: string | null;
  /** Audited token contract; the strongest corroboration when a strategy reads it. */
  tokenAddress?: string | null;
  /** Official X handle for the audited subject. */
  handle?: string | null;
  /** Official website for the audited subject. */
  website?: string | null;
  /** A space id already established elsewhere (for example a link on the site). */
  spaceId?: string | null;
}

function num(value: unknown): number | null {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
}

const normalizeHandle = (value: string | null | undefined): string =>
  String(value ?? "").trim().replace(/^@/, "").toLowerCase();

function hostOf(value: string | null | undefined): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  try {
    return new URL(raw.includes("://") ? raw : `https://${raw}`).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

/** Same registrable scope, so docs.example.com and example.com are one site. */
function relatedHosts(a: string | null, b: string | null): boolean {
  return Boolean(a && b && (a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`)));
}

/**
 * Candidate space ids from a project name. DISCOVERY ONLY.
 *
 * Nothing here is evidence: `uniswapgovernance.eth` is a guess until Snapshot
 * marks it verified and one independent fact ties it to this subject.
 */
export function candidateSpaceIds(name: string | null | undefined): string[] {
  const stem = String(name ?? "")
    .toLowerCase()
    .replace(/\b(dao|protocol|finance|network|foundation|labs?)\b/g, " ")
    .replace(/[^a-z0-9]+/g, "");
  if (stem.length < 3) return [];
  const out = new Set<string>();
  for (const suffix of SPACE_SUFFIXES) {
    out.add(`${stem}${suffix}.eth`);
    if (suffix) out.add(`${stem}-${suffix}.eth`);
  }
  return [...out];
}

interface RawSpace {
  id?: unknown;
  name?: unknown;
  verified?: unknown;
  followersCount?: unknown;
  proposalsCount?: unknown;
  twitter?: unknown;
  website?: unknown;
  strategies?: unknown;
}

function readSpace(raw: RawSpace): Omit<GovernanceSpace, "binding"> | null {
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  if (!id) return null;
  const strategies = Array.isArray(raw.strategies) ? raw.strategies : [];
  const strategyNames: string[] = [];
  const strategyAddresses: string[] = [];
  for (const entry of strategies) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as { name?: unknown; params?: unknown };
    if (typeof row.name === "string" && row.name.trim()) strategyNames.push(row.name.trim());
    const params = row.params && typeof row.params === "object" ? row.params as Record<string, unknown> : {};
    if (typeof params.address === "string" && params.address.trim()) {
      strategyAddresses.push(params.address.trim());
    }
  }
  return {
    id,
    name: typeof raw.name === "string" ? raw.name : id,
    verifiedBySnapshot: raw.verified === true,
    followers: num(raw.followersCount) ?? 0,
    proposalCount: num(raw.proposalsCount) ?? 0,
    twitter: typeof raw.twitter === "string" && raw.twitter.trim() ? raw.twitter.trim() : null,
    website: typeof raw.website === "string" && raw.website.trim() ? raw.website.trim() : null,
    strategyNames,
    strategyAddresses,
  };
}

/**
 * How, if at all, this space is tied to the audited subject.
 *
 * Snapshot's verified flag is necessary but never sufficient: the candidate id
 * was generated from the subject's NAME, so accepting on verified alone would
 * publish whichever real DAO happens to wear a similar name. One independent
 * corroboration is required on top of it.
 */
export function spaceBinding(
  space: Omit<GovernanceSpace, "binding">,
  subject: GovernanceSubject,
): SpaceBinding | null {
  if (!space.verifiedBySnapshot) return null;

  const handle = normalizeHandle(subject.handle);
  if (handle && normalizeHandle(space.twitter) === handle) return "official_x";
  if (relatedHosts(hostOf(space.website), hostOf(subject.website))) return "official_domain";
  return null;
}

/** Voting power that counts tokens delegated by other holders. */
const DELEGATION_STRATEGIES = /delegat|^uni$|erc20-votes|votes-/i;

export function usesDelegation(strategyNames: readonly string[]): boolean {
  return strategyNames.some((name) => DELEGATION_STRATEGIES.test(name));
}

/**
 * One proposal's concentration, from its scores and its highest voters.
 *
 * Shares are over the voting power actually CAST on that proposal, never over
 * supply: this measures who turned out and how heavily, not who owns what.
 */
export function summarizeProposal(
  proposal: {
    id?: unknown;
    title?: unknown;
    votes?: unknown;
    scores?: unknown;
    scores_total?: unknown;
    quorum?: unknown;
    end?: unknown;
  },
  voteRows: readonly { voter?: unknown; vp?: unknown }[],
): GovernanceProposal | null {
  const id = typeof proposal.id === "string" ? proposal.id : "";
  if (!id) return null;
  const total = num(proposal.scores_total) ?? 0;
  const scores = (Array.isArray(proposal.scores) ? proposal.scores : [])
    .map((value) => num(value) ?? 0);
  const sorted = [...scores].sort((a, b) => b - a);
  const winner = sorted[0] ?? 0;
  const runnerUp = sorted[1] ?? 0;
  // Uncontested means nothing else drew power. "Could one voter have flipped
  // it" is not a question worth answering when nobody voted the other way.
  const contested = runnerUp > 0;

  const topVoters: GovernanceVoter[] = [];
  for (const row of voteRows) {
    const address = typeof row.voter === "string" ? row.voter.trim() : "";
    const votingPower = num(row.vp);
    if (!address || votingPower === null || votingPower <= 0) continue;
    topVoters.push({
      address,
      votingPower,
      sharePct: total > 0 ? (votingPower / total) * 100 : 0,
    });
  }
  topVoters.sort((a, b) => b.votingPower - a.votingPower);

  const share = (count: number): number | null => {
    if (total <= 0 || topVoters.length < count) return null;
    return topVoters.slice(0, count).reduce((sum, voter) => sum + voter.sharePct, 0);
  };

  const quorum = num(proposal.quorum);
  const endRaw = num(proposal.end);
  return {
    id,
    title: typeof proposal.title === "string" ? proposal.title : id,
    voters: num(proposal.votes) ?? 0,
    totalVotingPower: total,
    quorum: quorum && quorum > 0 ? quorum : null,
    quorumMet: quorum && quorum > 0 ? total >= quorum : null,
    topVoters: topVoters.slice(0, TOP_VOTERS),
    top1Pct: share(1),
    top2Pct: share(2),
    contested,
    topVoterExceedsMargin: contested && topVoters.length > 0
      ? topVoters[0].votingPower > winner - runnerUp
      : null,
    endedAt: endRaw ? new Date(endRaw * 1000).toISOString() : null,
  };
}

async function hubQuery(query: string, fetchImpl: typeof fetch): Promise<unknown> {
  const response = await fetchImpl(HUB, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`snapshot ${response.status}`);
  const body = await response.json() as { data?: unknown; errors?: unknown };
  if (!body || body.data === undefined || body.data === null) throw new Error("snapshot returned no data");
  return body.data;
}

/**
 * The subject's governance, as Snapshot records it.
 *
 * Never throws and never blocks a report. `available: false` carries the reason,
 * so an unbound space reads as a question that could not be asked rather than a
 * project with no concentration.
 */
export async function fetchGovernance(
  subject: GovernanceSubject,
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<GovernanceReading> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const supplied = subject.spaceId?.trim();
  const candidates = supplied ? [supplied] : candidateSpaceIds(subject.name);
  if (!candidates.length) {
    return EMPTY("No Snapshot space could be looked up for this project, so its governance was not read.");
  }

  let spaces: RawSpace[];
  try {
    const data = await hubQuery(
      `{ spaces(first: 30, where: {id_in: ${JSON.stringify(candidates)}}) { id name verified followersCount proposalsCount twitter website strategies { name params } } }`,
      fetchImpl,
    ) as { spaces?: unknown };
    spaces = Array.isArray(data?.spaces) ? data.spaces as RawSpace[] : [];
  } catch {
    return EMPTY("Snapshot did not respond, so this project's governance was not read.");
  }

  let bound: GovernanceSpace | null = null;
  for (const raw of spaces) {
    const parsed = readSpace(raw);
    if (!parsed) continue;
    const binding = spaceBinding(parsed, subject);
    if (!binding) continue;
    // Prefer the busiest bound space when a project runs more than one.
    if (!bound || parsed.followers > bound.followers) bound = { ...parsed, binding };
  }
  if (!bound) {
    return EMPTY(
      spaces.length
        ? "A Snapshot space with a similar name exists, but nothing ties it to this project (Snapshot has not verified it, and its token, X account and website do not match), so no governance figures were taken from it."
        : "No Snapshot governance space was found for this project.",
    );
  }

  let proposalRows: Array<Record<string, unknown>>;
  try {
    const data = await hubQuery(
      `{ proposals(first: ${PROPOSAL_WINDOW}, where: {space: ${JSON.stringify(bound.id)}, state: "closed"}, orderBy: "created", orderDirection: desc) { id title votes scores scores_total quorum end } }`,
      fetchImpl,
    ) as { proposals?: unknown };
    proposalRows = Array.isArray(data?.proposals) ? data.proposals as Array<Record<string, unknown>> : [];
  } catch {
    return EMPTY("Snapshot did not return this project's proposals, so its governance was not read.");
  }
  if (!proposalRows.length) {
    return {
      available: true,
      note: `${bound.id} has no closed proposals, so there is no voting record to measure.`,
      space: bound,
      proposals: [],
      delegationDetected: usesDelegation(bound.strategyNames),
    };
  }

  // One aliased request for every proposal's top voters, rather than a call each.
  let voteData: Record<string, unknown> = {};
  try {
    const selections = proposalRows
      .map((row, index) => typeof row.id === "string"
        ? `p${index}: votes(first: ${TOP_VOTERS}, where: {proposal: ${JSON.stringify(row.id)}}, orderBy: "vp", orderDirection: desc) { voter vp }`
        : "")
      .filter(Boolean)
      .join(" ");
    voteData = await hubQuery(`{ ${selections} }`, fetchImpl) as Record<string, unknown>;
  } catch {
    // Proposal totals survive without the per-voter rows; concentration does not.
    voteData = {};
  }

  const proposals: GovernanceProposal[] = [];
  proposalRows.forEach((row, index) => {
    const rows = voteData[`p${index}`];
    const summary = summarizeProposal(row, Array.isArray(rows) ? rows as Array<{ voter?: unknown; vp?: unknown }> : []);
    if (summary) proposals.push(summary);
  });

  return {
    available: true,
    note: null,
    space: bound,
    proposals,
    delegationDetected: usesDelegation(bound.strategyNames),
  };
}

const pct = (value: number): string => `${value >= 10 ? value.toFixed(0) : value.toFixed(1)}%`;

/**
 * What the governance reading supports saying out loud.
 *
 * Concentration is reported as a count over a stated denominator, always with
 * the delegation caveat attached, and never as a judgement that a project is
 * captured. Snapshot is named as the source of the record.
 */
export function describeGovernance(reading: GovernanceReading): string[] {
  if (!reading.available || !reading.space) return [];
  const claims: string[] = [];
  const measured = reading.proposals.filter((proposal) => proposal.top2Pct !== null);
  if (!measured.length) return claims;

  const top2 = measured.map((proposal) => proposal.top2Pct as number);
  const highest = Math.max(...top2);
  const lowest = Math.min(...top2);
  const worst = measured.find((proposal) => proposal.top2Pct === highest);
  const measuredWindow = measured.length === reading.proposals.length
    ? `the last ${measured.length} closed proposals`
    : `${measured.length} of the last ${reading.proposals.length} closed proposals with readable voter-level data`;
  claims.push(
    `Across ${measuredWindow} in ${reading.space.id}, the two largest voters cast `
    + (measured.length === 1 || Math.abs(highest - lowest) < 0.5
      ? `${pct(highest)} of the voting power.`
      : `between ${pct(lowest)} and ${pct(highest)} of the voting power.`)
    + (worst ? ` The highest was "${worst.title}", where ${worst.voters} addresses voted in total.` : ""),
  );

  // Unconditional. This sentence was gated on recognising a delegation-aware
  // strategy by name, which meant Aave's opaque `contract-call` strategies
  // dropped it and the shares read as if they were holdings. The caveat is true
  // of every Snapshot space, so it is never withheld on a detection failure.
  claims.push(
    "These are shares of the voting power cast, not of tokens held. Voting power can include tokens delegated by "
    + "other holders, which is how the system is designed to work, so a large voter is a concentration of "
    + "decision-making power rather than evidence of a large holding.",
  );

  const marginExceeded = measured.filter((proposal) => proposal.topVoterExceedsMargin === true);
  if (marginExceeded.length) {
    claims.push(
      `On ${marginExceeded.length} of them the largest reported voter cast more voting power than the gap between the top two options. `
      + "This compares voting-power magnitude only. The read does not contain that voter's choice, so it supports no outcome-changing counterfactual.",
    );
  }

  const missedQuorum = measured.filter((proposal) => proposal.quorumMet === false);
  if (missedQuorum.length) {
    claims.push(`${missedQuorum.length} of these proposals closed below the space's own quorum.`);
  }

  claims.push(
    "Snapshot records off-chain signalling votes. Whether a result binds the protocol depends on the project's own process, which this reading does not check.",
  );
  return claims;
}
