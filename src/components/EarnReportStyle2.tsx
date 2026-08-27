import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowClockwiseIcon,
  ArrowRightIcon,
  BuildingsIcon,
  CaretDownIcon,
  ChartLineUpIcon,
  CheckCircleIcon,
  GlobeIcon,
  InfoIcon,
  ScanIcon,
  ShieldCheckIcon,
  WarningIcon,
  XLogoIcon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { EARN_ACCUSATION_CLAIM, EARN_ACCUSATION_SOURCE_URL } from "../data/earnReport";
import "./EarnReportStyle2.css";

type ScoreSegment = {
  label: string;
  points: number;
  tone: "support" | "caution" | "concern" | "unknown";
};

type EvidenceRow = {
  label: string;
  result: string;
  detail: string;
  state: "verified" | "partial" | "open";
  source: string;
};

const projectSegments: ScoreSegment[] = [
  { label: "Team & leadership", points: 9, tone: "caution" },
  { label: "Product & execution", points: 13, tone: "support" },
  { label: "Token conduct", points: 15, tone: "support" },
  { label: "Backers & partners", points: 3, tone: "unknown" },
  { label: "Traction & usage", points: 11, tone: "support" },
  { label: "Transparency", points: 3, tone: "caution" },
];

const tokenSegments: ScoreSegment[] = [
  { label: "Onchain health", points: 11, tone: "support" },
  { label: "Holders", points: 13, tone: "caution" },
  { label: "Token mechanics", points: 12, tone: "support" },
  { label: "Code & security", points: 16, tone: "caution" },
  { label: "Liquidity", points: 18, tone: "caution" },
  { label: "Maturity & presence", points: 9, tone: "support" },
];

const projectEvidence: EvidenceRow[] = [
  {
    label: "Official identity",
    result: "@earnonhood and earnonhood.com resolve to the same project",
    detail: "The account, website and token references cross-link consistently in the saved evidence.",
    state: "verified",
    source: "Official X · project site",
  },
  {
    label: "Product surface",
    result: "Live vault and Omnipool product claims are visible",
    detail: "Product existence is supported; independently measured usage and retention remain limited.",
    state: "partial",
    source: "earnonhood.com · DEX activity",
  },
  {
    label: "Team disclosure",
    result: "A creator is associated, but the operating team is not fully resolved",
    detail: "Named leadership, legal entity and accountable roles need stronger first-party evidence.",
    state: "open",
    source: "X profiles · public web",
  },
  {
    label: "External validation",
    result: "No institutional backer or independent audit was bound to this report",
    detail: "Absence is not proof that none exists; it is an evidence gap in this saved scan.",
    state: "open",
    source: "Saved public-source search",
  },
];

const tokenEvidence: EvidenceRow[] = [
  {
    label: "Contract safety",
    result: "No critical provider flag was recorded",
    detail: "The token contract completed the saved automated safety review without a critical failure.",
    state: "verified",
    source: "GoPlus · saved 25 Aug 2026",
  },
  {
    label: "Buy / sell simulation",
    result: "Tradeability check completed",
    detail: "The saved route simulation did not establish a transfer or sell restriction.",
    state: "verified",
    source: "DEX route simulation",
  },
  {
    label: "Holder distribution",
    result: "Concentration remains a monitoring risk",
    detail: "The assessed holder set was not severe enough to fail, but concentration can change quickly.",
    state: "partial",
    source: "On-chain holder sample",
  },
  {
    label: "Sanctions screen",
    result: "No matched address in the saved screen",
    detail: "This result covers the addresses ARGUS resolved at scan time, not every future counterparty.",
    state: "verified",
    source: "OFAC address screening",
  },
];

const loadingSteps = [
  "Binding EARN on Hood to $EARN",
  "Reading team and product evidence",
  "Checking contract, holders and liquidity",
  "Mapping market and social activity",
  "Writing the decision memo",
];

type DimensionRow = {
  label: string;
  weight: number;
  score: number;
  contribution: number;
  support: "Strong" | "Some" | "Limited";
  summary: string;
  sources: number;
  open?: number;
};

const projectDimensions: DimensionRow[] = [
  { label: "Team and leadership", weight: 16, score: 56, contribution: 9, support: "Some", summary: "One source-grounded creator is linked to the project; the full operating team and legal identity remain unresolved.", sources: 4, open: 1 },
  { label: "Product and execution", weight: 24, score: 54, contribution: 13, support: "Some", summary: "The official site describes yield vaults and an Omnipool, while independently measured product usage remains limited.", sources: 3 },
  { label: "Token design and conduct", weight: 20, score: 75, contribution: 15, support: "Strong", summary: "The canonical $EARN contract is bound through official channels and has observable market and holder activity.", sources: 4 },
  { label: "Backers and partnerships", weight: 14, score: 21, contribution: 3, support: "Limited", summary: "No verified investor, integration, advisor or operating-partner record was captured.", sources: 1, open: 1 },
  { label: "Traction and usage", weight: 14, score: 79, contribution: 11, support: "Strong", summary: "Recent posting, product claims and measured token volume support current activity.", sources: 3 },
  { label: "Transparency and integrity", weight: 12, score: 25, contribution: 3, support: "Limited", summary: "Official account and token data are public; governance, treasury and legal disclosures were not found.", sources: 2, open: 1 },
];

const tokenDimensions: DimensionRow[] = [
  { label: "Onchain health", weight: 12, score: 92, contribution: 11, support: "Strong", summary: "The selected pool recorded 1,219 buys, 1,846 sells and active volume during the saved window.", sources: 2 },
  { label: "The holders", weight: 16, score: 81, contribution: 13, support: "Strong", summary: "966 holders were recorded; the largest reported holder was 4% in the assessed provider view.", sources: 2 },
  { label: "The token", weight: 12, score: 100, contribution: 12, support: "Strong", summary: "Saved contract settings reported 0% buy and sell taxes and no mintable supply flag.", sources: 2 },
  { label: "Code and security", weight: 26, score: 62, contribution: 16, support: "Some", summary: "Source code is published, but ownership is active and the implementation is upgradeable.", sources: 3, open: 1 },
  { label: "The liquidity", weight: 24, score: 75, contribution: 18, support: "Some", summary: "$198.3K of liquidity was observed; a lock or permanent burn was not verified.", sources: 2, open: 1 },
  { label: "Maturity and presence", weight: 10, score: 90, contribution: 9, support: "Some", summary: "The pair was 33 days old with official social links, but no reliable global market rank was available.", sources: 3 },
];

const tokenFileChapters = [
  { label: "Launch", headline: "The pair is 33 days old; the deployer is recorded.", facts: ["Pair age · 33 days", "Deployer · 0xc856…b723"] },
  { label: "Liquidity", headline: "Liquidity is $198.3K; protection is not established.", facts: ["Observed pool · $198.3K", "LP lock · not confirmed"] },
  { label: "Holders", headline: "966 holders are recorded; the largest is reported at 4%.", facts: ["Holders · 966", "Top holder · 4%", "Creator holdings · 0.0%"] },
  { label: "Contract", headline: "Four governing contract checks are on record.", facts: ["Honeypot · not flagged", "Mintable · no", "Ownership · held", "Source · verified"] },
  { label: "Presence", headline: "Official channels resolve; independent listing coverage is thin.", facts: ["Official X · @earnonhood", "CoinGecko rank · unavailable", "Centralized exchanges · 0 recorded"] },
  { label: "Not verified", headline: "One core market check remains incomplete.", facts: ["Liquidity lock proof · missing", "Independent live buy/sell · not performed"] },
];

const notableMentions = [
  { handle: "@alterfind_", followers: "209.3K", quote: "Let’s drive awareness for $EARN beyond the echo chamber.", url: "https://x.com/alterfind_/status/2092251412566561064" },
  { handle: "@globalcoinhub", followers: "150.6K", quote: "@EARNONHOOD… Let’s talk.", url: "https://x.com/GlobalCoinHub/status/2091650668495036639" },
  { handle: "@thetokenxpress", followers: "150.3K", quote: "@EARNONROBINHOOD @EARNONHOOD", url: "https://x.com/TheTokenXpress/status/2092428535080337409" },
  { handle: "@crypt0_pioneer", followers: "130.9K", quote: "@EARNONROBINHOOD @EARNONHOOD can I get a follow back?", url: "https://x.com/Crypt0_Pioneer/status/2092403061960683782" },
  { handle: "@sana_shahuk", followers: "128.5K", quote: "Definitely feels like one to watch.", url: "https://x.com/Sana_ShahUk/status/2092402296185610670" },
  { handle: "@bankrbot", followers: "115.1K", quote: "$EARN on Robinhood Chain: price, volume, holders and contract snapshot.", url: "https://x.com/bankrbot/status/2091700582910448045" },
  { handle: "@znsconnect", followers: "108K", quote: "Feels like the early days of a full onchain finance stack.", url: "https://x.com/ZNSConnect/status/2090807772312965262" },
  { handle: "@robin_hoodailys", followers: "89.3K", quote: "@EARNONHOOD Nice.", url: "https://x.com/robin_Hoodailys/status/2092037381939777760" },
];

const connectionRows = [
  { kind: "people", subject: "@earnonhood", relation: "is the official account for", object: "$EARN / EARN on Hood", evidence: "Official" },
  { kind: "people", subject: "@0xTharmas", relation: "is publicly linked as creator of", object: "EARN on Hood", evidence: "Source-grounded" },
  { kind: "wallets", subject: "0xc856…b723", relation: "created", object: "$EARN contract", evidence: "Onchain" },
  { kind: "wallets", subject: "0xA3b6…7ba3", relation: "is reported among holders of", object: "$EARN", evidence: "Provider" },
  { kind: "wallets", subject: "0xeE7a…D051", relation: "is reported among holders of", object: "$EARN", evidence: "Provider" },
  { kind: "companies", subject: "earnonhood.com", relation: "is the official site for", object: "EARN on Hood", evidence: "Official" },
];

const methodologyCoverage = [
  ["Control", 1, 2], ["Security", 0, 2], ["Treasury", 0, 1], ["Supply", 2, 3], ["Economics", 0, 3], ["Liquidity", 9, 0], ["Team", 0, 2],
  ["Legal", 0, 3], ["Market", 5, 1], ["Identity", 3, 1], ["Product", 0, 2], ["Funding", 0, 2], ["Governance", 1, 1], ["Chronology", 8, 2],
] as const;

function SourceTag({ children }: { children: ReactNode }) {
  return <span className="earn-v2-source-tag">{children}</span>;
}

function StatePill({ state }: { state: EvidenceRow["state"] }) {
  const label = state === "verified" ? "Verified" : state === "partial" ? "Partial" : "Open";
  return <span className={`earn-v2-state earn-v2-state--${state}`}>{label}</span>;
}

function ScoreComposition({
  label,
  score,
  segments,
  animationKey,
}: {
  label: string;
  score: number;
  segments: ScoreSegment[];
  animationKey: number;
}) {
  const reduceMotion = useReducedMotion();
  const [activeIndex, setActiveIndex] = useState(() => reduceMotion ? segments.length - 1 : -1);

  useEffect(() => {
    if (reduceMotion) return;
    const timers = segments.map((_, index) => window.setTimeout(() => setActiveIndex(index), 360 + index * 430));
    return () => timers.forEach(window.clearTimeout);
  }, [animationKey, reduceMotion, segments]);

  const active = activeIndex >= 0 && activeIndex < segments.length ? segments[activeIndex] : null;
  return (
    <article className="earn-v2-score-card">
      <div className="earn-v2-score-card__head">
        <div>
          <p className="earn-v2-kicker">{label}</p>
          <p className="earn-v2-score-number"><strong>{score}</strong><span>/ 100</span></p>
        </div>
        <span className={`earn-v2-score-verdict ${score >= 70 ? "earn-v2-score-verdict--pass" : "earn-v2-score-verdict--caution"}`}>
          {score >= 70 ? "Pass" : "Caution"}
        </span>
      </div>
      <div className="earn-v2-segment-track" aria-label={`${label} evidence composition`}>
        {segments.map((segment, index) => (
          <motion.span
            key={`${animationKey}-${segment.label}`}
            className={`earn-v2-segment earn-v2-segment--${segment.tone}`}
            initial={{ flexGrow: 0, opacity: 0.2 }}
            animate={{ flexGrow: segment.points, opacity: 1 }}
            transition={{ duration: reduceMotion ? 0 : 0.48, delay: reduceMotion ? 0 : 0.28 + index * 0.43, ease: [0.2, 0.8, 0.2, 1] }}
          />
        ))}
      </div>
      <div className="earn-v2-score-active" aria-live="polite">
        {active ? <><span>Adding {active.label}</span><strong>+{active.points} pts</strong></> : <><span>Building score composition</span><strong>0 pts</strong></>}
      </div>
      <ul className="earn-v2-score-legend">
        {segments.map((segment) => (
          <li key={segment.label} className={active?.label === segment.label ? "is-active" : undefined}>
            <i className={`earn-v2-dot earn-v2-dot--${segment.tone}`} />
            <span>{segment.label}</span>
            <strong>{segment.points}</strong>
          </li>
        ))}
      </ul>
    </article>
  );
}

function EvidenceTable({ rows }: { rows: EvidenceRow[] }) {
  const [expanded, setExpanded] = useState<string | null>(rows[0]?.label ?? null);
  return (
    <div className="earn-v2-evidence-table">
      {rows.map((row) => {
        const open = expanded === row.label;
        return (
          <article key={row.label} className="earn-v2-evidence-row">
            <button
              type="button"
              className="earn-v2-evidence-row__button"
              onClick={() => setExpanded(open ? null : row.label)}
              aria-expanded={open}
            >
              <span className="earn-v2-evidence-row__label">{row.label}</span>
              <span className="earn-v2-evidence-row__result">{row.result}</span>
              <StatePill state={row.state} />
              <CaretDownIcon size={16} aria-hidden className={open ? "is-open" : undefined} />
            </button>
            <AnimatePresence initial={false}>
              {open ? (
                <motion.div
                  className="earn-v2-evidence-row__detail"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                >
                  <p>{row.detail}</p>
                  <SourceTag>{row.source}</SourceTag>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </article>
        );
      })}
    </div>
  );
}

function DimensionLedger({ rows, score }: { rows: DimensionRow[]; score: number }) {
  return (
    <div className="earn-v2-dimension-ledger">
      <div className="earn-v2-dimension-ledger__summary">
        <span>Weighted contribution</span>
        <strong>{score} pts earned of 100</strong>
      </div>
      {rows.map((row) => (
        <details key={row.label} className="earn-v2-dimension-row">
          <summary>
            <span className="earn-v2-dimension-row__label">{row.label}</span>
            <span>{row.weight}% weight</span>
            <strong>{row.score}<small>/100</small></strong>
            <em>+{row.contribution} pts</em>
            <CaretDownIcon size={16} aria-hidden />
          </summary>
          <div className="earn-v2-dimension-row__detail">
            <p>{row.summary}</p>
            <div>
              <SourceTag>{row.support} support · {row.sources} source{row.sources === 1 ? "" : "s"}</SourceTag>
              {row.open ? <span className="earn-v2-open-note">{row.open} open question</span> : <span className="earn-v2-verified-note">No governing question open</span>}
            </div>
          </div>
        </details>
      ))}
    </div>
  );
}

function FactStatus({ tone, children }: { tone: "ok" | "risk" | "open"; children: ReactNode }) {
  return <span className={`earn-v2-fact-status earn-v2-fact-status--${tone}`}>{children}</span>;
}

function LoadingCurtain({ step }: { step: number }) {
  return (
    <motion.div className="earn-v2-loading" initial={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.35 }}>
      <div className="earn-v2-loading__mark">
        <img src="/brand/argus-eye-badge.svg" alt="" />
      </div>
      <p className="earn-v2-kicker">ARGUS decision intelligence</p>
      <h1>Building the EARN decision memo</h1>
      <div className="earn-v2-loading__track"><motion.span animate={{ width: `${((step + 1) / loadingSteps.length) * 100}%` }} /></div>
      <ol>
        {loadingSteps.map((label, index) => (
          <li key={label} className={index < step ? "is-done" : index === step ? "is-active" : undefined}>
            {index < step ? <CheckCircleIcon size={16} weight="fill" aria-hidden /> : index === step ? <ScanIcon size={16} aria-hidden /> : <span>{String(index + 1).padStart(2, "0")}</span>}
            {label}
          </li>
        ))}
      </ol>
      <p className="earn-v2-loading__note">Each score segment will name the evidence dimension as it is added.</p>
    </motion.div>
  );
}

export function EarnReportStyle2() {
  const reduceMotion = useReducedMotion();
  const [loading, setLoading] = useState(true);
  const [loadingStep, setLoadingStep] = useState(0);
  const [animationKey, setAnimationKey] = useState(0);
  const [socialWindow, setSocialWindow] = useState<"24h" | "7d">("24h");
  const [showAllMentions, setShowAllMentions] = useState(false);
  const [connectionFilter, setConnectionFilter] = useState<"all" | "people" | "companies" | "wallets">("all");
  const [challengeText, setChallengeText] = useState("");
  const [challengeSaved, setChallengeSaved] = useState(false);
  const reportRef = useRef<HTMLElement>(null);

  const runLoadingSequence = useCallback(() => {
    setAnimationKey((value) => value + 1);
    if (reduceMotion) {
      setLoading(false);
      setLoadingStep(loadingSteps.length - 1);
      return;
    }
    setLoadingStep(0);
    setLoading(true);
  }, [reduceMotion]);

  useEffect(() => {
    if (!loading) return;
    if (reduceMotion) {
      const reducedMotionFinish = window.setTimeout(() => setLoading(false), 0);
      return () => window.clearTimeout(reducedMotionFinish);
    }
    const stepTimers = loadingSteps.slice(1).map((_, index) => window.setTimeout(() => setLoadingStep(index + 1), 420 + index * 430));
    const finish = window.setTimeout(() => setLoading(false), 420 + loadingSteps.length * 430);
    return () => {
      stepTimers.forEach(window.clearTimeout);
      window.clearTimeout(finish);
    };
  }, [animationKey, loading, reduceMotion]);

  const socialBars = useMemo(() => (
    socialWindow === "24h"
      ? [2, 7, 3, 1, 3, 2, 5, 6, 5, 2, 5, 5, 9, 1, 5, 8, 4, 1, 1, 1, 1, 3, 4, 1]
      : [19, 28, 34, 31, 45, 38, 51]
  ), [socialWindow]);
  const filteredConnections = connectionFilter === "all"
    ? connectionRows
    : connectionRows.filter((row) => row.kind === connectionFilter);

  return (
    <div className="earn-v2-app earn-v2-app--embedded">
      <AnimatePresence>{loading ? <LoadingCurtain step={loadingStep} /> : null}</AnimatePresence>
      <main className="earn-v2-main" ref={reportRef}>
        <div className="earn-v2-content" id="report-top">
          <motion.header className="earn-v2-masthead" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}>
            <div className="earn-v2-title-lockup">
              <div>
                <p className="earn-v2-kicker">Decision memo</p>
                <h1>EARN on Hood</h1>
                <div className="earn-v2-connected-subjects">
                  <img src="https://www.google.com/s2/favicons?sz=128&domain=earnonhood.com" alt="" /><span>@earnonhood</span><i /><img src="https://www.google.com/s2/favicons?sz=128&domain=earnonhood.com" alt="" /><span>$EARN</span>
                </div>
                <a className="earn-v2-web-entry" href="#web-product">
                  <GlobeIcon size={17} aria-hidden />
                  <span><small>Web analysis</small><strong>earnonhood.com</strong></span>
                  <ArrowRightIcon size={15} aria-hidden />
                </a>
                <button className="earn-v2-replay" type="button" onClick={runLoadingSequence}>
                  <ArrowClockwiseIcon size={15} aria-hidden /> Replay analysis
                </button>
              </div>
            </div>
            <dl className="earn-v2-metadata">
              <div><dt>Saved</dt><dd>25 Aug 2026</dd></div>
              <div><dt>Scope</dt><dd><span>Project diligence</span><span>Token safety</span></dd></div>
              <div><dt>Analyst</dt><dd>ARGUS</dd></div>
            </dl>
          </motion.header>

          <section className="earn-v2-hero" id="decision">
            <motion.div className="earn-v2-verdict" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }}>
              <p className="earn-v2-kicker">Overall verdict</p>
              <h2>Promising,<br />with material gaps</h2>
              <p className="earn-v2-verdict__summary">
                EARN on Hood provides onchain strategies tied to tokenized stocks. The saved report observed market participation and public attention, while team transparency, independent validation and economic durability remain material gaps.
              </p>
              <div className="earn-v2-recommendation">
                <span><ArrowRightIcon size={20} aria-hidden /></span>
                <div><p className="earn-v2-kicker">Recommendation</p><strong>Proceed to deeper review</strong><small>Prioritize team verification, independent contract review and token-economics validation.</small></div>
              </div>
            </motion.div>
            <div className="earn-v2-scores">
              <p className="earn-v2-kicker">Scores & evidence composition</p>
              <div className="earn-v2-score-grid">
                <ScoreComposition key={`project-${animationKey}`} label="Project diligence" score={54} segments={projectSegments} animationKey={animationKey} />
                <ScoreComposition key={`token-${animationKey}`} label="Token safety" score={79} segments={tokenSegments} animationKey={animationKey} />
              </div>
              <p className="earn-v2-score-explainer"><InfoIcon size={15} aria-hidden />These are related but different scores. Project diligence measures the organization; token safety measures the asset and market mechanics.</p>
            </div>
          </section>

          <section className="earn-v2-story-grid" aria-label="Decision narrative">
            <article className="earn-v2-story earn-v2-story--positive">
              <span>01</span><p className="earn-v2-kicker">Why it earns attention</p>
              <h3>The product is live and the market is active, but neither establishes quality on its own.</h3>
              <p>The official site describes tokenized-stock yield strategies. Saved DEX activity and public mentions show that the project has market attention; they do not establish adoption, durability or safety.</p>
              <SourceTag>Product site · DEX · X activity</SourceTag>
            </article>
            <article className="earn-v2-story earn-v2-story--caution">
              <span>02</span><p className="earn-v2-kicker">What could break the thesis</p>
              <h3>Thin team disclosure and limited independent assurance make execution risk hard to price.</h3>
              <p>The saved scan does not bind a complete operating team, legal entity, treasury register or current independent security audit.</p>
              <SourceTag>Public web · disclosures</SourceTag>
            </article>
            <article className="earn-v2-story earn-v2-story--concern">
              <span>03</span><p className="earn-v2-kicker">What to verify next</p>
              <h3>Close three specific gaps before treating early momentum as durable evidence.</h3>
              <p>Verify accountable leaders, audit the deployed contract and reconcile token utility, supply control and treasury authority.</p>
              <SourceTag>Follow-up plan · 3 open</SourceTag>
            </article>
          </section>

          <section className="earn-v2-signal-strip" id="market-social">
            <div>
              <p className="earn-v2-kicker">Social pulse · 24 hours</p>
              <strong>57</strong><span>unique accounts</span><em>↓ 20% vs prior day</em>
            </div>
            <div>
              <p className="earn-v2-kicker">Seven-day conversation</p>
              <strong>328</strong><span>matched posts</span><em>from at least 152 accounts</em>
            </div>
            <div className="earn-v2-signal-strip__notice earn-v2-signal-strip__notice--activity">
              <CheckCircleIcon size={19} weight="fill" aria-hidden />
              <span><strong>Active observed conversation</strong><small>At least 152 accounts and 328 posts were captured in seven days.</small></span>
            </div>
            <div>
              <p className="earn-v2-kicker">Saved market cap</p>
              <strong>$1.53M</strong><span>at the captured valuation</span><em>approx. top 20% by market cap</em>
            </div>
          </section>

          <nav className="earn-v2-report-nav" aria-label="Report sections">
            <a href="#decision">Decision</a>
            <a href="#web-product">Web & product</a>
            <a href="#people">People</a>
            <a href="#token-file">Token</a>
            <a href="#market">Market</a>
            <a href="#social">Social</a>
            <a href="#connections">Connections</a>
            <a href="#evidence">Evidence</a>
            <a href="#risks">Open risks</a>
            <a href="#method">Method</a>
          </nav>

          <section className="earn-v2-section earn-v2-web-section" id="web-product">
            <div className="earn-v2-section-heading">
              <div><p className="earn-v2-kicker">02 · Web, identity & product</p><h2>This is the @earnonhood ARGUS audited</h2></div>
              <p>The project account, official website and $EARN contract resolve to the same subject. That binding is established; the operating substance behind it is only partly evidenced.</p>
            </div>
            <div className="earn-v2-web-hero">
              <div className="earn-v2-web-identity">
                <div className="earn-v2-web-identity__title">
                  <img src="https://www.google.com/s2/favicons?sz=128&domain=earnonhood.com" alt="" />
                  <div><span>First-party product site</span><h3>earnonhood.com</h3><p>Provides onchain yield strategies tied to tokenized stocks and describes automated strategy management.</p></div>
                </div>
                <div className="earn-v2-web-actions">
                  <a href="https://earnonhood.com/" target="_blank" rel="noreferrer"><GlobeIcon size={16} aria-hidden />Open website</a>
                  <a href="https://x.com/earnonhood" target="_blank" rel="noreferrer"><XLogoIcon size={16} aria-hidden />Open @earnonhood</a>
                </div>
                <SourceTag>Official site · first-party claim</SourceTag>
              </div>
              <dl className="earn-v2-web-metrics">
                <div><dt>Domain registered</dt><dd>23 Jul 2026</dd><small>about one month old at scan</small></div>
                <div><dt>Account created</dt><dd>Jul 2026</dd><small>official project account</small></div>
                <div><dt>Last saved post</dt><dd>26 Aug 2026</dd><small>posted during scan window</small></div>
                <div><dt>Project binding</dt><dd>Matched</dd><small>site · X · contract</small></div>
              </dl>
            </div>
            <div className="earn-v2-web-grid">
              <article>
                <p className="earn-v2-kicker">What the website establishes</p>
                <h3>The site describes three product components.</h3>
                <ul>
                  <li><CheckCircleIcon size={17} weight="fill" aria-hidden /><span><strong>Yield vaults</strong><small>Described on the official project surface.</small></span></li>
                  <li><CheckCircleIcon size={17} weight="fill" aria-hidden /><span><strong>Omnipool</strong><small>Presented as part of the Robinhood Chain product.</small></span></li>
                  <li><CheckCircleIcon size={17} weight="fill" aria-hidden /><span><strong>Canonical token</strong><small>$EARN contract is repeated by the official account.</small></span></li>
                </ul>
              </article>
              <article>
                <p className="earn-v2-kicker">What the web does not establish</p>
                <h3>Product operation is not the same as independent validation.</h3>
                <ul>
                  <li><WarningIcon size={17} aria-hidden /><span><strong>Usage and retention</strong><small>No independent cohort, TVL history or customer-retention record was bound.</small></span></li>
                  <li><WarningIcon size={17} aria-hidden /><span><strong>Security assurance</strong><small>No current independent audit was tied to the exact deployment.</small></span></li>
                  <li><WarningIcon size={17} aria-hidden /><span><strong>Governance and treasury</strong><small>No public governance, treasury or accountable-entity record was found.</small></span></li>
                </ul>
              </article>
            </div>
          </section>

          <section className="earn-v2-section earn-v2-people-section" id="people">
            <div className="earn-v2-section-heading">
              <div><p className="earn-v2-kicker">03 · People, entity & backing</p><h2>One creator is source-grounded; the organization is not fully resolved</h2></div>
              <p>ARGUS separates a public project link from proof of a complete accountable operating team.</p>
            </div>
            <div className="earn-v2-people-layout">
              <article className="earn-v2-person-card">
                <img className="earn-v2-person-card__avatar" src="https://unavatar.io/x/0xTharmas" alt="Tharmas profile" referrerPolicy="no-referrer" />
                <div><p className="earn-v2-kicker">Named creator</p><h3>Tharmas <span>@0xTharmas</span></h3><p>The official account follows @0xTharmas, whose public bio states “making RWAs @earnonhood.” This supports a role link; full legal identity and prior operating history remain open.</p>
                  <a href="https://x.com/0xTharmas" target="_blank" rel="noreferrer">Open role source <ArrowRightIcon size={14} aria-hidden /></a>
                </div>
              </article>
              <dl className="earn-v2-people-facts">
                <div><dt>Named people</dt><dd>1</dd><small>source-grounded creator</small></div>
                <div><dt>Operating roles</dt><dd>Open</dd><small>responsibility map incomplete</small></div>
                <div><dt>Legal entity</dt><dd>None recorded</dd><small>jurisdiction unestablished</small></div>
                <div><dt>Verified raise</dt><dd>None found</dd><small>not proof that none exists</small></div>
                <div><dt>Backers / partners</dt><dd>0 verified</dd><small>one evidence question open</small></div>
                <div><dt>Identity confidence</dt><dd>Partial</dd><small>project link established</small></div>
              </dl>
            </div>
          </section>

          <section className="earn-v2-section" id="evidence">
            <div className="earn-v2-section-heading">
              <div><p className="earn-v2-kicker">04 · Governing evidence</p><h2>The evidence behind the call</h2></div>
              <p>Every conclusion below is tied to what ARGUS actually saved. Open a row to see its boundary and source.</p>
            </div>
            <div className="earn-v2-evidence-columns">
              <article>
                <div className="earn-v2-column-title"><BuildingsIcon size={20} aria-hidden /><div><h3>Project diligence</h3><p>Team, product, validation and transparency</p></div><strong>54</strong></div>
                <EvidenceTable rows={projectEvidence} />
              </article>
              <article>
                <div className="earn-v2-column-title"><ShieldCheckIcon size={20} aria-hidden /><div><h3>Token safety</h3><p>Contract, tradeability, holders and sanctions</p></div><strong>79</strong></div>
                <EvidenceTable rows={tokenEvidence} />
              </article>
            </div>
          </section>

          <section className="earn-v2-section earn-v2-composition-section" id="composition">
            <div className="earn-v2-section-heading">
              <div><p className="earn-v2-kicker">05 · Full score composition</p><h2>Twelve dimensions. Two different questions.</h2></div>
              <p>Open any row to see the evidence boundary, source strength and unresolved question behind its weighted contribution.</p>
            </div>
            <div className="earn-v2-composition-grid">
              <article>
                <div className="earn-v2-column-title"><BuildingsIcon size={20} aria-hidden /><div><h3>Project diligence</h3><p>Can this organization support conviction?</p></div><strong>54</strong></div>
                <DimensionLedger rows={projectDimensions} score={54} />
              </article>
              <article>
                <div className="earn-v2-column-title"><ShieldCheckIcon size={20} aria-hidden /><div><h3>Token safety</h3><p>Do the saved asset mechanics clear the baseline?</p></div><strong>79</strong></div>
                <DimensionLedger rows={tokenDimensions} score={79} />
              </article>
            </div>
          </section>

          <section className="earn-v2-section earn-v2-token-file" id="token-file">
            <div className="earn-v2-section-heading">
              <div><p className="earn-v2-kicker">06 · The token file</p><h2>Six chapters. Two governing gaps.</h2></div>
              <p>Each chapter keeps sourced facts separate from unestablished conditions. Missing proof is not treated as a pass or a failure.</p>
            </div>
            <div className="earn-v2-token-chapters">
              {tokenFileChapters.map((chapter, index) => (
                <article key={chapter.label}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <p className="earn-v2-kicker">{chapter.label}</p>
                  <h3>{chapter.headline}</h3>
                  <ul>{chapter.facts.map((fact) => <li key={fact}>{fact}</li>)}</ul>
                </article>
              ))}
            </div>
            <div className="earn-v2-token-detail-grid">
              <article>
                <p className="earn-v2-kicker">Contract safety</p>
                <div className="earn-v2-check-grid">
                  <div><span>Honeypot flag</span><FactStatus tone="ok">not flagged</FactStatus></div>
                  <div><span>Supply mintable</span><FactStatus tone="ok">no</FactStatus></div>
                  <div><span>Ownership</span><FactStatus tone="risk">held</FactStatus></div>
                  <div><span>Upgradeable proxy</span><FactStatus tone="risk">yes</FactStatus></div>
                  <div><span>Source code</span><FactStatus tone="ok">verified</FactStatus></div>
                  <div><span>Transfers pausable</span><FactStatus tone="ok">not flagged</FactStatus></div>
                  <div><span>Buy / sell tax</span><FactStatus tone="ok">0% / 0%</FactStatus></div>
                  <div><span>Tax modifiable</span><FactStatus tone="ok">not flagged</FactStatus></div>
                  <div><span>Liquidity lock</span><FactStatus tone="open">not confirmed</FactStatus></div>
                  <div><span>Sell simulation</span><FactStatus tone="open">provider route only</FactStatus></div>
                </div>
              </article>
              <article>
                <p className="earn-v2-kicker">Holder concentration</p>
                <div className="earn-v2-holder-summary"><strong>966</strong><span>holders recorded</span><em>top 10 provider rows · 61%</em></div>
                <ol className="earn-v2-holder-list">
                  {[['0xA3b…7ba3','15.0%'],['0xeE7…D051','14.1%'],['0x836…0951','9.3%'],['0xcf3…4Fe2','4.4%'],['0x3e6…eBEd','4.3%'],['0x340…7a08','3.5%'],['0x85A…9905','3.1%'],['0x2B8…Ae6d','2.7%'],['0xdF7…475d','2.4%'],['0x97B…8DDA','2.0%']].map(([wallet, share], index) => <li key={wallet}><span>{index + 1}</span><code>{wallet}</code><strong>{share}</strong></li>)}
                </ol>
                <p className="earn-v2-boundary-copy">Provider rows can include pools, contracts or other non-person wallets. This table is not a beneficial-ownership conclusion.</p>
              </article>
            </div>
          </section>

          <section className="earn-v2-section earn-v2-market-section" id="market">
            <div className="earn-v2-section-heading">
              <div><p className="earn-v2-kicker">07 · Market position</p><h2>Real activity, still at an early scale</h2></div>
              <p>Market data describes present activity. It does not by itself prove durable demand or an all-time-high comparison.</p>
            </div>
            <div className="earn-v2-market-layout">
              <div className="earn-v2-market-thesis">
                <p className="earn-v2-kicker">Analyst reading</p>
                <h3>Liquidity appears usable for the current scale, but the market remains sensitive to concentration and short-term flow.</h3>
                <p>At roughly $1.53M, EARN sits in the upper fifth of the benchmark market universe. That shows real market formation, while remaining small enough for liquidity and a few wallets to move price quickly.</p>
                <SourceTag>DexScreener · captured 25 Aug 2026</SourceTag>
              </div>
              <dl className="earn-v2-market-metrics">
                <div><dt>Market position</dt><dd>Top ~20%</dd><small>Approximate · by saved market cap</small></div>
                <div><dt>Liquidity</dt><dd>$211.6K</dd><small>Primary saved pool</small></div>
                <div><dt>24h volume</dt><dd>$600.8K</dd><small>Snapshot value</small></div>
                <div><dt>24h move</dt><dd className="is-positive">+0.3%</dd><small>Not decision-controlling</small></div>
              </dl>
            </div>
            <div className="earn-v2-price-history">
              <div className="earn-v2-price-history__head">
                <div><p className="earn-v2-kicker">Saved price history</p><h3>28 days of reported range and close data</h3></div>
                <div><strong>+465%</strong><span>over the saved window</span></div>
                <div><strong className="is-caution">−43.8%</strong><span>from the window high</span></div>
              </div>
              <div className="earn-v2-price-bars" aria-label="Twenty-eight saved daily price observations">
                {[8,9,8,10,11,13,14,18,17,22,24,29,36,31,42,55,49,68,63,78,72,88,82,94,74,68,61,56].map((value, index) => <span key={index} style={{ height: `${value}%` }} />)}
              </div>
              <div className="earn-v2-price-history__foot"><span>29 Jul</span><span>reported range · $4.88e−7 to $0.0000241</span><span>25 Aug</span></div>
              <div className="earn-v2-intervals" aria-label="Captured interval momentum">
                <div><span>5m</span><strong className="is-positive">+0.8%</strong></div>
                <div><span>1h</span><strong className="is-positive">+1.8%</strong></div>
                <div><span>6h</span><strong className="is-negative">−8.3%</strong></div>
                <div><span>24h</span><strong className="is-positive">+0.3%</strong></div>
              </div>
              <p className="earn-v2-boundary-copy">This is the highest reported price inside the saved 28-day window, not a verified all-time high. The percentile is a broad market-cap comparison, not an exact token rank.</p>
            </div>
          </section>

          <section className="earn-v2-section earn-v2-social-section" id="social">
            <div className="earn-v2-section-heading">
              <div><p className="earn-v2-kicker">08 · Social activity</p><h2>Attention is active, visible and worth reading</h2></div>
              <div className="earn-v2-toggle" aria-label="Social activity window">
                <button type="button" className={socialWindow === "24h" ? "is-active" : undefined} onClick={() => setSocialWindow("24h")}>24 hours</button>
                <button type="button" className={socialWindow === "7d" ? "is-active" : undefined} onClick={() => setSocialWindow("7d")}>7 days</button>
              </div>
            </div>
            <div className="earn-v2-social-grid">
              <div className="earn-v2-social-chart">
                <div className="earn-v2-social-chart__summary">
                  <div><strong>{socialWindow === "24h" ? "57" : "152+"}</strong><span>{socialWindow === "24h" ? "unique accounts in 24 hours" : "unique accounts in 7 days"}</span></div>
                  <div><strong className="is-caution">{socialWindow === "24h" ? "−20%" : "328"}</strong><span>{socialWindow === "24h" ? "versus previous 24 hours" : "matched posts in 7 days"}</span></div>
                </div>
                <div className="earn-v2-bars" aria-label={`${socialWindow} matched social activity`}>
                  {socialBars.map((value, index) => <motion.span key={`${socialWindow}-${index}`} initial={{ height: 0 }} animate={{ height: `${Math.max(8, value * (socialWindow === "24h" ? 8 : 1.7))}%` }} transition={{ delay: index * 0.025 }} />)}
                </div>
                <div className="earn-v2-chart-axis"><span>{socialWindow === "24h" ? "25 Aug · 02:00" : "20 Aug"}</span><span>UTC</span><span>{socialWindow === "24h" ? "26 Aug · 02:00" : "26 Aug"}</span></div>
                <div className="earn-v2-coverage-note earn-v2-coverage-note--observed"><CheckCircleIcon size={18} weight="fill" aria-hidden /><span><strong>Active observed conversation</strong>These are minimum observed counts. Social activity describes attention, not project quality or safety.</span></div>
              </div>
              <aside className="earn-v2-notable">
                <div className="earn-v2-notable__head"><p className="earn-v2-kicker">Notable public mentions</p><span>{notableMentions.length} saved</span></div>
                {notableMentions.slice(0, showAllMentions ? notableMentions.length : 3).map((mention) => (
                  <article key={mention.handle}>
                    <img src={`https://unavatar.io/x/${mention.handle.slice(1)}`} alt={mention.handle} />
                    <div><strong>{mention.handle} <small>{mention.followers} followers</small></strong><p>“{mention.quote}”</p><a href={mention.url} target="_blank" rel="noreferrer">View post <ArrowRightIcon size={13} aria-hidden /></a></div>
                  </article>
                ))}
                <button type="button" className="earn-v2-show-mentions" onClick={() => setShowAllMentions((value) => !value)}>{showAllMentions ? "Show fewer mentions" : `Show all ${notableMentions.length} mentions`}<CaretDownIcon size={14} className={showAllMentions ? "is-open" : undefined} aria-hidden /></button>
                <p className="earn-v2-notable__boundary">Ranked by saved follower count. A mention is evidence of attention, not endorsement or project quality.</p>
              </aside>
            </div>
            <div className="earn-v2-social-method">
              <div><span>At least</span><strong>152</strong><small>unique accounts in seven days</small></div>
              <div><span>At least</span><strong>328</strong><small>matched posts in seven days</small></div>
              <div><span>Observed activity level</span><strong>Active</strong><small>volume tier · not a quality score</small></div>
              <p>This saved search matched public X posts to @earnonhood and $EARN and excluded reposts. The counts are minimums; no safety or project score depends on them.</p>
            </div>
            <div className="earn-v2-accusation-stage" id="subject-leads">
              <div className="earn-v2-accusation-stage__head">
                <span><WarningIcon size={19} aria-hidden /></span>
                <div><p className="earn-v2-kicker">Adverse conversation · direct-subject lead</p><h3>What people accused</h3><p>One saved lead names @earnonhood directly. It is uncorroborated, never counted in either score, and shown here so the social record is not falsely clean.</p></div>
                <strong>1 lead · not scored</strong>
              </div>
              <article>
                <div className="earn-v2-accusation-stage__source"><span>?</span><div><strong>Sotwe profile</strong><small>Social mirror · weak source</small></div></div>
                <blockquote>“{EARN_ACCUSATION_CLAIM}”</blockquote>
                <dl>
                  <div><dt>Verification status</dt><dd>Uncorroborated. ARGUS found no independent source confirming the allegation.</dd></div>
                  <div><dt>Check next</dt><dd>Locate the original post, an independent report, or a first-party response from EARN on Hood.</dd></div>
                </dl>
                <a href={EARN_ACCUSATION_SOURCE_URL} target="_blank" rel="noreferrer">Open candidate source <ArrowRightIcon size={13} aria-hidden /></a>
              </article>
            </div>
          </section>

          <section className="earn-v2-section earn-v2-connections-section" id="connections">
            <div className="earn-v2-section-heading">
              <div><p className="earn-v2-kicker">09 · People, wallets & connected surfaces</p><h2>Seven recorded links form the current relationship map</h2></div>
              <p>A recorded link shows an observed relationship. It does not imply common control, endorsement or wrongdoing.</p>
            </div>
            <div className="earn-v2-connection-filters" aria-label="Connection filters">
              {(["all", "people", "companies", "wallets"] as const).map((filter) => <button type="button" key={filter} className={connectionFilter === filter ? "is-active" : undefined} onClick={() => setConnectionFilter(filter)}>{filter}</button>)}
            </div>
            <div className="earn-v2-connection-ledger">
              {filteredConnections.map((row) => (
                <article key={`${row.subject}-${row.object}`}>
                  <span className={`earn-v2-connection-kind earn-v2-connection-kind--${row.kind}`}>{row.kind.slice(0, 1).toUpperCase()}</span>
                  <strong>{row.subject}</strong><p>{row.relation}</p><strong>{row.object}</strong><SourceTag>{row.evidence}</SourceTag>
                </article>
              ))}
            </div>
            <div className="earn-v2-connections-summary"><strong>7</strong><span>recorded links</span><i /> <strong>1</strong><span>named person</span><i /> <strong>4</strong><span>sampled holder rows</span><i /> <strong>1</strong><span>official domain</span></div>
          </section>

          <section className="earn-v2-section" id="risks">
            <div className="earn-v2-section-heading">
              <div><p className="earn-v2-kicker">10 · Decision risks</p><h2>Three gaps keep conviction out of reach</h2></div>
              <p>These are not generic caveats. Each one can materially change the project-diligence conclusion.</p>
            </div>
            <div className="earn-v2-risk-list">
              <article><span>01</span><div><h3>Accountable team and entity</h3><p>The project identity resolves, but the saved evidence does not fully establish responsible operating leaders, corporate entity or jurisdiction.</p></div><strong>Material</strong></article>
              <article><span>02</span><div><h3>Independent security assurance</h3><p>Automated token checks passed, but ARGUS did not bind a current independent audit to the deployed contract.</p></div><strong>Material</strong></article>
              <article><span>03</span><div><h3>Token utility and control</h3><p>Utility claims, treasury authority and future supply controls need reconciliation against deployed contracts and first-party policy.</p></div><strong>Material</strong></article>
            </div>
          </section>

          <section className="earn-v2-verification" id="verification">
            <div>
              <p className="earn-v2-kicker">11 · Verification plan</p>
              <h2>What would change the call</h2>
              <p>Resolve these checks in order. A materially different verified result should create a new report version, not rewrite this saved one.</p>
            </div>
            <ol>
              <li><span>01</span><div><strong>Bind the operating team</strong><p>Verify named leaders, roles, legal entity and decision authority from first-party and independent records.</p></div><em>Identity · high priority</em></li>
              <li><span>02</span><div><strong>Review the deployed contracts</strong><p>Obtain an independent audit or reproduce a structured manual review against the exact Robinhood Chain deployment.</p></div><em>Security · high priority</em></li>
              <li><span>03</span><div><strong>Reconcile the token economy</strong><p>Map utility, emissions, treasury wallets, admin controls and concentration to accountable parties.</p></div><em>Economics · high priority</em></li>
            </ol>
            <button type="button" onClick={() => document.getElementById("method")?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" })}>Open governing sources <ArrowRightIcon size={17} aria-hidden /></button>
          </section>

          <section className="earn-v2-section earn-v2-sources" id="method">
            <div className="earn-v2-section-heading">
              <div><p className="earn-v2-kicker">12 · Sources, coverage & method</p><h2>What this report knows, and what it does not</h2></div>
              <p>All values are frozen to the saved scan window. Current conditions may differ.</p>
            </div>
            <div className="earn-v2-source-grid">
              <article><GlobeIcon size={20} aria-hidden /><div><strong>Official project surface</strong><p>earnonhood.com and linked public project claims</p><SourceTag>First party · partial access</SourceTag></div></article>
              <article><XLogoIcon size={20} aria-hidden /><div><strong>Public conversation</strong><p>@earnonhood, $EARN and matched notable accounts</p><SourceTag>X search · time-bounded</SourceTag></div></article>
              <article><ChartLineUpIcon size={20} aria-hidden /><div><strong>Market snapshot</strong><p>Price, liquidity, volume and saved DEX valuation</p><SourceTag>DexScreener · captured</SourceTag></div></article>
              <article><ShieldCheckIcon size={20} aria-hidden /><div><strong>Token safety providers</strong><p>Contract flags, route simulation, holder sample and sanctions</p><SourceTag>Provider set · saved results</SourceTag></div></article>
            </div>
            <div className="earn-v2-capture-window">
              <div><p className="earn-v2-kicker">Capture window</p><strong>26 Aug 2026 · 01:50–01:52 UTC</strong><span>Evidence after this window is not included.</span></div>
              <dl>
                <div><dt>Artifacts</dt><dd>45</dd></div>
                <div><dt>Source references</dt><dd>51</dd></div>
                <div><dt>Source groups</dt><dd>18</dd></div>
                <div><dt>Saved facts</dt><dd>49</dd></div>
                <div><dt>Findings</dt><dd>5</dd></div>
                <div><dt>Open questions</dt><dd>25</dd></div>
              </dl>
            </div>
            <div className="earn-v2-method-coverage">
              <div className="earn-v2-method-coverage__head"><div><p className="earn-v2-kicker">Coverage ledger</p><h3>Every topic ARGUS checked</h3></div><p>A related number never answers a different question. Missing evidence stays visible.</p></div>
              <div className="earn-v2-method-grid">
                {methodologyCoverage.map(([topic, facts, open]) => <article key={topic}><strong>{topic}</strong><span>{facts} saved fact{facts === 1 ? "" : "s"}</span><em>{open ? `${open} open` : "complete"}</em></article>)}
              </div>
            </div>
            <div className="earn-v2-source-ledger">
              <div className="earn-v2-source-ledger__head"><div><p className="earn-v2-kicker">Governing source ledger</p><h3>Open the evidence behind the conclusions</h3></div><span>6 recorded source families · 51 references</span></div>
              <details open><summary><GlobeIcon size={18} aria-hidden /><span>earnonhood.com · official project surface</span><strong>product, identity, links</strong><CaretDownIcon size={15} aria-hidden /></summary><div><p>Official project claims, canonical links and product descriptions. First-party material establishes what the project says, not whether each claim is independently verified.</p><a href="https://earnonhood.com/" target="_blank" rel="noreferrer">Open source <ArrowRightIcon size={13} aria-hidden /></a></div></details>
              <details><summary><XLogoIcon size={18} aria-hidden /><span>x.com/@earnonhood · official account</span><strong>identity, creator, token</strong><CaretDownIcon size={15} aria-hidden /></summary><div><p>Saved bio, account chronology, canonical contract and public role link to @0xTharmas.</p><a href="https://x.com/earnonhood" target="_blank" rel="noreferrer">Open source <ArrowRightIcon size={13} aria-hidden /></a></div></details>
              <details><summary><ChartLineUpIcon size={18} aria-hidden /><span>DexScreener · saved market record</span><strong>price, liquidity, volume</strong><CaretDownIcon size={15} aria-hidden /></summary><div><p>Saved primary-pool valuation and historical observations. The report places that value in a broad market-cap percentile instead of showing an unsupported exact rank.</p><a href="https://dexscreener.com/search?q=0xA3b6AEe90017b72c0812dC1e013De70eB2917ba3" target="_blank" rel="noreferrer">Open source <ArrowRightIcon size={13} aria-hidden /></a></div></details>
              <details><summary><ShieldCheckIcon size={18} aria-hidden /><span>Token providers · saved safety checks</span><strong>contract, holders, tradeability</strong><CaretDownIcon size={15} aria-hidden /></summary><div><p>Automated provider results, contract-code observations, holder samples and sanctions screening. Provider absence is not converted into a verified clean result.</p></div></details>
            </div>
            <div className="earn-v2-method-note"><InfoIcon size={18} aria-hidden /><p><strong>Research boundary.</strong> ARGUS scores the evidence it can bind, not the confidence of market participants. Missing evidence is shown as missing; it is not silently converted into a negative fact. This report is research, not financial advice.</p></div>
            <div className="earn-v2-challenge" id="challenge">
              <div><p className="earn-v2-kicker">Challenge this report</p><h3>What looks wrong, overstated or missing?</h3><p>A challenge does not rewrite the saved report. It creates a review item against the immutable evidence window.</p></div>
              <form onSubmit={(event) => { event.preventDefault(); if (challengeText.trim()) setChallengeSaved(true); }}>
                <label htmlFor="earn-v2-challenge">Your challenge</label>
                <textarea id="earn-v2-challenge" value={challengeText} onChange={(event) => { setChallengeText(event.target.value); setChallengeSaved(false); }} placeholder="For example: the team link looks weak, the website claim is overstated, or key contract evidence is missing." />
                <button type="submit" disabled={!challengeText.trim()}>{challengeSaved ? "Challenge saved" : "Save challenge"}<ArrowRightIcon size={15} aria-hidden /></button>
                {challengeSaved ? <p role="status">Saved to this staged report for analyst review.</p> : null}
              </form>
            </div>
          </section>

          <footer className="earn-v2-footer">
            <img src="/brand/argus-eye-badge.svg" alt="" />
            <span><strong>ARGUS decision intelligence</strong><small>Full diligence preview · 12 sections · 51 source references</small></span>
            <a href="#report-top">Back to decision <ArrowRightIcon size={14} aria-hidden /></a>
          </footer>
        </div>
      </main>
    </div>
  );
}
