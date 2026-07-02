// Joint changelog. GET /api/changelog
//
// Live commit history from GitHub so Kyle + Enigma can see what each other
// shipped, labeled by author. Uses GITHUB_TOKEN (the repo is private). Groups
// nothing server-side — the page categorizes + labels by author.
import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = { maxDuration: 15 };

const REPO = "kylekmcconnell-arch/argus";

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader("cache-control", "no-store");
  const token = process.env.GITHUB_TOKEN;
  if (!token) { res.status(200).json({ available: false, commits: [], note: "Changelog needs GITHUB_TOKEN." }); return; }

  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/commits?per_page=100`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "user-agent": "argus" },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) { res.status(200).json({ available: true, commits: [], error: `github ${r.status}` }); return; }
    const rows = (await r.json()) as any[];
    const commits = (Array.isArray(rows) ? rows : []).map((c) => {
      const msg = String(c?.commit?.message ?? "");
      const subject = msg.split("\n")[0];
      // category = the "<area>:" prefix if present, else a coarse bucket
      const m = subject.match(/^([A-Za-z][\w -]{1,24}):/);
      return {
        sha: String(c?.sha ?? "").slice(0, 7),
        subject: subject.slice(0, 160),
        category: m ? m[1].trim() : "",
        author: c?.commit?.author?.name ?? c?.author?.login ?? "unknown",
        email: c?.commit?.author?.email ?? "",
        login: c?.author?.login ?? undefined,
        date: c?.commit?.author?.date ?? null,
      };
    });
    res.status(200).json({ available: true, repo: REPO, commits });
  } catch (e) {
    res.status(200).json({ available: true, commits: [], error: String(e) });
  }
}
