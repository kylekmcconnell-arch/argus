// Link-hub dereference: a profile whose website is linktr.ee (or a peer link
// aggregator) has no usable official site, which silently kills PROJECT
// routing, official-site verification, and token binding. This resolver walks
// the hub deterministically and fails closed:
//
//   1. fetch the hub page (the stated path, or /<handle> when the profile
//      stored only the hub root) and require it to link the exact audited
//      X handle, so a namesake's hub can never speak for the subject;
//   2. collect outbound links, drop socials/utilities/other hubs, and accept
//      either the unique external site or the unique brand-stem match;
//   3. fetch that site and require it to link the exact handle back.
//
// Anything ambiguous resolves to null and the pipeline behaves exactly as it
// does today (no official website). Both fetches are free page reads.
import { fetchPublicText } from "../publicWeb";

export const LINK_HUB_HOSTS: ReadonlySet<string> = new Set([
  "linktr.ee", "linkin.bio", "lnk.bio", "beacons.ai", "bio.link", "taplink.cc",
  "solo.to", "hoo.be", "komi.io", "linkfly.to", "lynk.id", "campsite.bio",
]);

const NON_WEBSITE_HOSTS: readonly string[] = [
  "x.com", "twitter.com", "instagram.com", "tiktok.com", "youtube.com", "youtu.be",
  "facebook.com", "linkedin.com", "discord.gg", "discord.com", "t.me", "telegram.me",
  "medium.com", "substack.com", "mirror.xyz", "github.com", "opensea.io",
  "dexscreener.com", "dextools.io", "coingecko.com", "coinmarketcap.com",
  "etherscan.io", "basescan.org", "bscscan.com", "solscan.io", "birdeye.so",
  "pump.fun", "raydium.io", "uniswap.org", "jup.ag", "apps.apple.com",
  "play.google.com", "docs.google.com", "forms.gle", "mailto",
];

const hostOf = (raw: string): string | null => {
  try {
    return new URL(raw).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return null;
  }
};

const escapeRe = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const handleBacklinkPattern = (account: string): RegExp =>
  new RegExp(`(?:https?:)?//(?:www\\.)?(?:x|twitter)\\.com/${escapeRe(account)}(?:[/?#"'\\s<]|$)`, "i");

export function isLinkHubUrl(value: unknown): boolean {
  if (typeof value !== "string" || !value.trim()) return false;
  const host = hostOf(value);
  return Boolean(host && LINK_HUB_HOSTS.has(host));
}

export interface LinkHubResolution {
  /** Origin of the verified official site, with a trailing slash. */
  website: string;
  /** The hub page the site was extracted from. */
  hubUrl: string;
}

type HubFetch = (url: string) => Promise<{ status: string; text?: string }>;

export async function resolveLinkHubWebsite(
  rawHubUrl: string,
  handle: string,
  fetchDoc: HubFetch = fetchPublicText,
): Promise<LinkHubResolution | null> {
  const account = handle.replace(/^@/, "");
  let hub: URL;
  try {
    hub = new URL(rawHubUrl);
  } catch {
    return null;
  }
  const hubHost = hostOf(hub.toString());
  if (!hubHost || !LINK_HUB_HOSTS.has(hubHost)) return null;

  // A bare hub root (seen in the wild when URL expansion loses the path) is
  // probed at the conventional /<handle> page; a stated path is used as-is.
  const hubPages = hub.pathname && hub.pathname !== "/"
    ? [hub.toString()]
    : [...new Set([`${hub.origin}/${account}`, `${hub.origin}/${account.toLowerCase()}`])];
  const backlink = handleBacklinkPattern(account);

  for (const hubUrl of hubPages) {
    const page = await fetchDoc(hubUrl);
    if (page.status !== "ok" || !page.text) continue;
    const text = page.text.replace(/\\\//g, "/");
    if (!backlink.test(text)) continue;

    const external = new Map<string, string>();
    for (const raw of text.match(/https?:\/\/[^\s"'<>()]+/gi) ?? []) {
      const cleaned = raw.replace(/[.,;:!?]+$/, "");
      const host = hostOf(cleaned);
      if (!host || LINK_HUB_HOSTS.has(host)) continue;
      if (NON_WEBSITE_HOSTS.some((listed) => host === listed || host.endsWith(`.${listed}`))) continue;
      const registrable = host.split(".").slice(-2).join(".");
      if (!external.has(registrable)) external.set(registrable, cleaned);
    }

    const handleKey = account.toLowerCase().replace(/[^a-z0-9]/g, "");
    const stemMatches = [...external.entries()].filter(([registrable]) => {
      const brand = registrable.split(".")[0].replace(/[^a-z0-9]/g, "");
      return brand.length >= 3 && handleKey.startsWith(brand);
    });
    const chosen = stemMatches.length === 1
      ? stemMatches[0][1]
      : stemMatches.length === 0 && external.size === 1
        ? [...external.values()][0]
        : null;
    if (!chosen) continue;

    let site: URL;
    try {
      site = new URL(chosen);
    } catch {
      continue;
    }
    const homepage = `${site.origin}/`;
    const siteDoc = await fetchDoc(homepage);
    if (siteDoc.status !== "ok" || !siteDoc.text) continue;
    if (!backlink.test(siteDoc.text.replace(/\\\//g, "/"))) continue;
    return { website: homepage, hubUrl };
  }
  return null;
}
