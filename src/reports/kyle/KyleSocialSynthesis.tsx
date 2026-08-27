import { ArrowRight, ChatCenteredDots, Gauge, Megaphone, UsersThree } from "@phosphor-icons/react";
import { observedSocialActivityLevel, type SocialActivityMention, type SocialActivitySnapshot } from "../../data/socialActivity";

type Theme = { label: string; pattern: RegExp };

const THEMES: Theme[] = [
  { label: "Wallet & custody", pattern: /\b(wallet|custod(?:y|ial)|self[- ]?custody|bitcoin|btc)\b/i },
  { label: "Privacy & security", pattern: /\b(privacy|private|security|secure|encrypted|encryption)\b/i },
  { label: "Community & chat", pattern: /\b(community|communities|chat|group|federation|federated)\b/i },
  { label: "Product & development", pattern: /\b(app|product|release|launch|update|github|developer|build|feature|code)\b/i },
  { label: "Adoption & infrastructure", pattern: /\b(adoption|user|users|usage|merchant|infrastructure|node|network|integration)\b/i },
  { label: "Events & marketing", pattern: /\b(event|conference|summit|campaign|giveaway|awareness|marketing)\b/i },
  { label: "Price & trading", pattern: /(?:\$[A-Z]{2,10}\b|\b(price|pump|trading|trade|buy|sell|moon|airdrop)\b)/i },
];

const STRATEGIC = /\b(wallet|custod(?:y|ial)|privacy|security|encrypted|app|product|release|update|github|developer|feature|adoption|user|usage|merchant|infrastructure|node|network|integration|partnership)\b/i;
const SPECULATIVE = /(?:\$[A-Z]{2,10}\b|\b(price|pump|trading|trade|buy|sell|moon|airdrop|giveaway|100x)\b)/i;

function concentrationReading(value: number | null): { label: string; detail: string } {
  if (value == null) return { label: "Not measured", detail: "The saved scan did not capture enough author distribution data." };
  if (value >= 65) return { label: "Highly concentrated", detail: `${value}% of observed posts came from the ten most active accounts.` };
  if (value >= 40) return { label: "Concentrated", detail: `${value}% of observed posts came from the ten most active accounts.` };
  return { label: "Broadly distributed", detail: `The ten most active accounts produced ${value}% of observed posts.` };
}

function selectNoteworthy(mentions: SocialActivityMention[]): SocialActivityMention | null {
  return [...mentions]
    .filter((mention) => STRATEGIC.test(mention.text) && !SPECULATIVE.test(mention.text))
    .sort((left, right) => (right.followers ?? 0) - (left.followers ?? 0))[0] ?? null;
}

export function KyleSocialSynthesis({ snapshot }: { snapshot: SocialActivitySnapshot }) {
  const mentions = snapshot.mentioners ?? [];
  const level = observedSocialActivityLevel(snapshot);
  const concentration = concentrationReading(snapshot.top10AccountSharePct);
  const strategicCount = mentions.filter((mention) => STRATEGIC.test(mention.text)).length;
  const speculativeCount = mentions.filter((mention) => SPECULATIVE.test(mention.text)).length;
  const themes = THEMES
    .map((theme) => ({ label: theme.label, count: mentions.filter((mention) => theme.pattern.test(mention.text)).length }))
    .filter((theme) => theme.count > 0)
    .sort((left, right) => right.count - left.count)
    .slice(0, 4);
  const noteworthy = selectNoteworthy(mentions);
  const accounts24h = snapshot.windows.last24Hours.uniqueAccounts;
  const prior24h = snapshot.windows.previous24Hours.uniqueAccounts;
  const change = accounts24h != null && prior24h != null
    ? Math.round(((accounts24h - prior24h) / Math.max(1, prior24h)) * 100)
    : null;
  const activitySentence = accounts24h == null
    ? "The saved scan could not establish a complete 24-hour audience count."
    : `${snapshot.windows.last24Hours.authorCoverageComplete ? "" : "At least "}${accounts24h} unique accounts discussed the subject in 24 hours${change == null ? "" : `, ${Math.abs(change)}% ${change >= 0 ? "higher" : "lower"} than the prior day`}.`;
  const relevanceLabel = mentions.length === 0
    ? "Not enough sampled posts"
    : strategicCount / mentions.length >= 0.6
      ? "High in the notable sample"
      : strategicCount > 0
        ? "Mixed in the notable sample"
        : "Low in the notable sample";
  const speculationLabel = mentions.length === 0
    ? "Not enough sampled posts"
    : speculativeCount === 0
      ? "No price-led posts in the notable sample"
      : `${speculativeCount} of ${mentions.length} notable posts`;

  return (
    <section className="kyle-social-synthesis" aria-labelledby="kyle-social-synthesis-title">
      <div className="kyle-social-synthesis-heading">
        <p className="kyle-overline mono">ARGUS SOCIAL READ</p>
        <h3 id="kyle-social-synthesis-title">What the conversation actually says.</h3>
        <p>{activitySentence} {concentration.detail}</p>
      </div>

      <div className="kyle-social-dimensions">
        <article>
          <Gauge size={18} weight="duotone" aria-hidden="true" />
          <span className="mono">ACTIVITY</span>
          <strong>{level ? level.label : "Unknown"}</strong>
          <small>Volume only—not quality or safety.</small>
        </article>
        <article>
          <UsersThree size={18} weight="duotone" aria-hidden="true" />
          <span className="mono">CONCENTRATION</span>
          <strong>{concentration.label}</strong>
          <small>Distribution across observed authors.</small>
        </article>
        <article>
          <ChatCenteredDots size={18} weight="duotone" aria-hidden="true" />
          <span className="mono">STRATEGIC RELEVANCE</span>
          <strong>{relevanceLabel}</strong>
          <small>{mentions.length ? `${strategicCount} of ${mentions.length} displayed posts discuss product or operating signals.` : "No post sample was saved."}</small>
        </article>
        <article>
          <Megaphone size={18} weight="duotone" aria-hidden="true" />
          <span className="mono">SPECULATION</span>
          <strong>{speculationLabel}</strong>
          <small>Keyword read of the displayed sample—not a sentiment score.</small>
        </article>
      </div>

      <div className="kyle-social-signal-row">
        <div>
          <span className="mono">THEMES IN THE NOTABLE SAMPLE</span>
          {themes.length ? (
            <ul>{themes.map((theme) => <li key={theme.label}><strong>{theme.label}</strong><small>{theme.count} {theme.count === 1 ? "signal" : "signals"}</small></li>)}</ul>
          ) : <p>No recurring product or market theme was identifiable from the saved notable posts.</p>}
        </div>
        <div>
          <span className="mono">MOST INTERESTING SIGNAL</span>
          {noteworthy ? (
            <blockquote>
              <p>“{noteworthy.text}”</p>
              <footer><strong>{noteworthy.handle}</strong>{noteworthy.followers != null ? ` · ${noteworthy.followers.toLocaleString("en-US")} followers` : ""}</footer>
              <a href={noteworthy.tweetUrl} target="_blank" rel="noreferrer">Open source post <ArrowRight size={13} weight="bold" /></a>
            </blockquote>
          ) : <p>No displayed post contained a clear non-promotional product or operating signal.</p>}
        </div>
      </div>
      <p className="kyle-social-method-note"><strong>Sentiment is not scored here.</strong> The saved X snapshot contains activity and author-distribution evidence, but no source-grounded sentiment register. ARGUS leaves it unmeasured instead of guessing.</p>
    </section>
  );
}
