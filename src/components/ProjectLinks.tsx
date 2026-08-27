// The project's identity rail for the TOP of a report. Shared across token and
// investigation reports so the official site, community/research destinations,
// and contract always have the same hierarchy. Classifies each URL to a clean
// platform label, dedupes (one X, one Telegram, one per website host), and
// orders website-first.
//
// The contract address is the one item a reader routinely needs to carry
// somewhere else (an explorer, a wallet, a group chat), so it copies in one
// click rather than forcing a manual selection of a 42-character string.
import { useState } from "react";
import {
  ArrowSquareOut, BookOpen, ChartLineUp, Check, Copy, Cube, DiscordLogo, GithubLogo,
  GlobeSimple, LinkSimple, RedditLogo, TelegramLogo, XLogo, YoutubeLogo,
} from "@phosphor-icons/react";

type RawLink = { label?: string; url: string };
type IconType = typeof GlobeSimple;

const DEXSCREENER_LOGO_URL = "https://dexscreener.com/favicon.png";

const RULES: [RegExp, string, number, IconType][] = [
  [/(?:x\.com|twitter\.com)\//i, "X", 1, XLogo],
  [/t\.me|telegram/i, "Telegram", 2, TelegramLogo],
  [/(?:docs\.|gitbook|readthedocs)/i, "Docs", 3, BookOpen],
  [/discord(?:\.gg|app\.com|\.com)/i, "Discord", 4, DiscordLogo],
  [/github\.com/i, "GitHub", 5, GithubLogo],
  [/dexscreener\.com/i, "Dexscreener", 6, ChartLineUp],
  [/medium\.com|mirror\.xyz|substack\.com/i, "Blog", 7, BookOpen],
  [/youtube\.com|youtu\.be/i, "YouTube", 8, YoutubeLogo],
  [/reddit\.com/i, "Reddit", 9, RedditLogo],
  [/linkedin\.com/i, "LinkedIn", 10, LinkSimple],
  [/warpcast\.com|farcaster/i, "Farcaster", 11, LinkSimple],
];

const LABEL_RULES: [RegExp, string, number, IconType][] = [
  [/^(?:x|twitter)$/i, "X", 1, XLogo],
  [/telegram/i, "Telegram", 2, TelegramLogo],
  [/docs?|documentation|gitbook|whitepaper/i, "Docs", 3, BookOpen],
  [/discord/i, "Discord", 4, DiscordLogo],
  [/github/i, "GitHub", 5, GithubLogo],
  [/dexscreener/i, "Dexscreener", 6, ChartLineUp],
];

function classify(url: string, explicitLabel?: string): { label: string; pri: number; Icon: IconType } {
  const hint = explicitLabel?.trim() ?? "";
  for (const [re, name, pri, Icon] of LABEL_RULES) if (re.test(hint)) return { label: name, pri, Icon };
  for (const [re, name, pri, Icon] of RULES) if (re.test(url)) return { label: name, pri, Icon };
  try {
    return { label: new URL(url).hostname.replace(/^www\./, ""), pri: 0, Icon: GlobeSimple };
  } catch {
    return { label: "Link", pri: 11, Icon: LinkSimple };
  }
}

const shortAddress = (value: string): string =>
  value.length > 14 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;

const CHAIN_LABELS: Readonly<Record<string, string>> = Object.freeze({
  arbitrum: "Arbitrum",
  base: "Base",
  bsc: "BNB Chain",
  ethereum: "Ethereum",
  polygon: "Polygon",
  robinhood: "Robinhood Chain",
  solana: "Solana",
});

function CopyAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(address).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        }).catch(() => {});
      }}
      title={`Copy contract address ${address}`}
      aria-label={`Copy contract address ${address}`}
      className={`project-identity-contract-button ${copied ? "is-copied" : ""}`}
    >
      {copied
        ? <Check size={16} weight="bold" aria-hidden />
        : <Copy size={16} weight="duotone" aria-hidden />}
      {copied ? "Copied" : shortAddress(address)}
    </button>
  );
}

export function ProjectLinks({
  links,
  website,
  websites,
  xHandle,
  contractAddress,
  chain,
  className,
}: {
  links?: RawLink[];
  website?: string | null;
  /** Distinct official web surfaces whose roles must not be collapsed. */
  websites?: Array<{ label: string; url: string }>;
  xHandle?: string | null;
  /** Token contract, rendered as a one-click copy chip. */
  contractAddress?: string | null;
  /** Network label shown alongside the copyable contract. */
  chain?: string | null;
  className?: string;
}) {
  const urls: Array<{ url: string; explicitLabel?: string }> = [];
  const push = (u?: string | null, explicitLabel?: string) => {
    if (!u) return;
    const full = /^https?:\/\//i.test(u) ? u : `https://${u}`;
    if (/^https?:\/\/\S+$/.test(full)) urls.push({ url: full, explicitLabel });
  };
  push(website);
  for (const item of websites ?? []) push(item.url, item.label);
  if (xHandle) push(`https://x.com/${xHandle.replace(/^@/, "")}`);
  for (const l of links ?? []) push(l.url, l.label);
  const address = contractAddress?.trim();
  if (address) push(`https://dexscreener.com/search?q=${encodeURIComponent(address)}`, "Dexscreener");

  // Dedupe by label: one chip per platform (and one per distinct website host).
  const seen = new Set<string>();
  const items = urls
    .map(({ url, explicitLabel }) => {
      const classified = classify(url, explicitLabel);
      return {
        url,
        ...classified,
        label: classified.pri === 0 ? explicitLabel?.trim() || classified.label : classified.label,
      };
    })
    .filter((it) => {
      // Social products dedupe by platform. Websites dedupe by hostname so a
      // token landing page and the protocol/company site can coexist.
      const k = it.pri === 0
        ? `site:${new URL(it.url).hostname.replace(/^www\./, "").toLowerCase()}`
        : `platform:${it.pri}:${it.label.toLowerCase()}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => a.pri - b.pri);

  const primary = items.find((item) => item.pri === 0);
  const resources = primary ? items.filter((item) => item !== primary) : items;
  const primaryHost = primary ? new URL(primary.url).hostname.replace(/^www\./, "") : null;
  if (!items.length && !address) return null;
  const groupCount = Number(Boolean(primary)) + Number(resources.length > 0) + Number(Boolean(address));
  const layout = groupCount === 3
    ? "lg:grid-cols-[minmax(220px,1.1fr)_minmax(280px,2fr)_minmax(220px,auto)]"
    : groupCount === 2
      ? "sm:grid-cols-2"
      : "grid-cols-1";
  const chainKey = chain?.trim().toLowerCase() ?? "";
  const chainLabel = chainKey
    ? CHAIN_LABELS[chainKey] ?? chainKey.replace(/\b\w/g, (letter) => letter.toUpperCase())
    : "Contract";

  return (
    <section
      aria-label="Official project links"
      className={`project-identity-rail grid ${layout} ${className ?? ""}`}
    >
      {primary && (
        <div className="project-identity-group">
          <div className="project-identity-label">Web &amp; product</div>
          <a
            href={primary.url}
            target="_blank"
            rel="noreferrer"
            title={primary.url}
            className="project-identity-primary"
          >
            <span className="project-identity-favicon" aria-hidden="true">
              <img src={`https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(primaryHost ?? primary.url)}`} alt="" referrerPolicy="no-referrer" />
            </span>
            <span className="project-identity-primary-copy min-w-0 flex-1">
              <strong className="truncate">{primary.label}</strong>
              <small>Open the official first-party surface</small>
            </span>
            <ArrowSquareOut size={16} weight="bold" aria-hidden />
          </a>
        </div>
      )}

      {resources.length > 0 && (
        <div className="project-identity-group min-w-0">
          <div className="project-identity-label">Resources &amp; community</div>
          <div className="project-identity-resources">
            {resources.map((link) => (
              <a
                key={link.url}
                href={link.url}
                target="_blank"
                rel="noreferrer"
                title={link.url}
                className="project-identity-resource"
              >
                {link.label === "Dexscreener"
                  ? <img
                      className="project-identity-resource-logo"
                      src={DEXSCREENER_LOGO_URL}
                      alt=""
                      width={21}
                      height={21}
                      loading="eager"
                      referrerPolicy="no-referrer"
                      aria-hidden="true"
                    />
                  : <link.Icon size={21} weight="duotone" aria-hidden />}
                <span>{link.label}</span>
              </a>
            ))}
          </div>
        </div>
      )}

      {address && (
        <div className="project-identity-group">
          <div className="project-identity-label">Contract</div>
          <div className="project-identity-contract">
            <Cube size={18} weight="duotone" aria-hidden />
            <span className="project-identity-chain">{chainLabel}</span>
            <span className="project-identity-divider" aria-hidden />
            <CopyAddress address={address} />
          </div>
        </div>
      )}
    </section>
  );
}
