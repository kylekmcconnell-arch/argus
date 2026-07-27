// A compact row of the project's official links (website, socials, and the
// contract address) for the TOP of a report. Shared across the token,
// investigation, and site reports so the same links show in the same place
// everywhere. Classifies each URL to a clean platform label, dedupes (one X,
// one Telegram, one per website host), and orders website-first.
//
// The contract address is the one item a reader routinely needs to carry
// somewhere else (an explorer, a wallet, a group chat), so it copies in one
// click rather than forcing a manual selection of a 42-character string.
import { useState } from "react";
import {
  BookOpen, Check, Copy, DiscordLogo, GithubLogo, GlobeSimple, LinkSimple,
  RedditLogo, TelegramLogo, XLogo, YoutubeLogo,
} from "@phosphor-icons/react";

type RawLink = { label?: string; url: string };
type IconType = typeof GlobeSimple;

const RULES: [RegExp, string, number, IconType][] = [
  [/(?:x\.com|twitter\.com)\//i, "X", 1, XLogo],
  [/t\.me|telegram/i, "Telegram", 2, TelegramLogo],
  [/discord(?:\.gg|app\.com|\.com)/i, "Discord", 3, DiscordLogo],
  [/github\.com/i, "GitHub", 4, GithubLogo],
  [/(?:docs\.|gitbook|readthedocs)/i, "Docs", 5, BookOpen],
  [/medium\.com|mirror\.xyz|substack\.com/i, "Blog", 6, BookOpen],
  [/youtube\.com|youtu\.be/i, "YouTube", 7, YoutubeLogo],
  [/reddit\.com/i, "Reddit", 8, RedditLogo],
  [/linkedin\.com/i, "LinkedIn", 9, LinkSimple],
  [/warpcast\.com|farcaster/i, "Farcaster", 10, LinkSimple],
];

function classify(url: string): { label: string; pri: number; Icon: IconType } {
  for (const [re, name, pri, Icon] of RULES) if (re.test(url)) return { label: name, pri, Icon };
  try {
    return { label: new URL(url).hostname.replace(/^www\./, ""), pri: 0, Icon: GlobeSimple };
  } catch {
    return { label: "Link", pri: 11, Icon: LinkSimple };
  }
}

const shortAddress = (value: string): string =>
  value.length > 14 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;

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
      className="chip mono normal-case tracking-normal transition hover:text-ink"
    >
      {copied
        ? <Check size={12} weight="bold" aria-hidden />
        : <Copy size={12} weight="duotone" aria-hidden />}
      {copied ? "Copied" : shortAddress(address)}
    </button>
  );
}

export function ProjectLinks({
  links,
  website,
  xHandle,
  contractAddress,
  className,
}: {
  links?: RawLink[];
  website?: string | null;
  xHandle?: string | null;
  /** Token contract, rendered as a one-click copy chip. */
  contractAddress?: string | null;
  className?: string;
}) {
  const urls: string[] = [];
  const push = (u?: string | null) => { if (u) { const full = /^https?:\/\//i.test(u) ? u : `https://${u}`; if (/^https?:\/\/\S+$/.test(full)) urls.push(full); } };
  push(website);
  if (xHandle) push(`https://x.com/${xHandle.replace(/^@/, "")}`);
  for (const l of links ?? []) push(l.url);

  // Dedupe by label: one chip per platform (and one per distinct website host).
  const seen = new Set<string>();
  const items = urls
    .map((url) => ({ url, ...classify(url) }))
    .filter((it) => { const k = it.label.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => a.pri - b.pri);

  const address = contractAddress?.trim();
  if (!items.length && !address) return null;
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className ?? ""}`}>
      {items.map((l) => (
        <a
          key={l.url}
          href={l.url}
          target="_blank"
          rel="noreferrer"
          title={l.url}
          className="chip normal-case tracking-normal transition hover:text-ink"
        >
          <l.Icon size={12} weight="duotone" aria-hidden />
          {l.label}
        </a>
      ))}
      {address && <CopyAddress address={address} />}
    </div>
  );
}
