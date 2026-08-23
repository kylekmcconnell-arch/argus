// Joint changelog. GET /api/changelog
//
// Live commit history from GitHub so Kyle + Enigma can see what each other
// shipped, labeled by author. Uses GITHUB_TOKEN (the repo is private). Groups
// nothing server-side — the page categorizes + labels by author.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireArgusAuth } from "./_auth.js";

export const config = { maxDuration: 15 };

const REPO = "kylekmcconnell-arch/argus";

interface GithubCommitRow {
  sha?: unknown;
  author?: { login?: unknown } | null;
  commit?: {
    message?: unknown;
    author?: { name?: unknown; email?: unknown; date?: unknown } | null;
  };
}

const textValue = (value: unknown): string => typeof value === "string" ? value : "";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("cache-control", "no-store");
  if (req.method && req.method !== "GET") {
    res.status(405).json({ error: "method_not_allowed", message: "Use GET for the changelog." });
    return;
  }
  const auth = await requireArgusAuth(req, res, "owner");
  if (!auth) return;
  const token = process.env.GITHUB_TOKEN;
  if (!token) { res.status(200).json({ available: false, commits: [], note: "Changelog needs GITHUB_TOKEN." }); return; }

  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/commits?per_page=100`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "user-agent": "argus" },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) { res.status(200).json({ available: true, commits: [], error: `github ${r.status}` }); return; }
    const payload: unknown = await r.json();
    const rows = Array.isArray(payload) ? payload as GithubCommitRow[] : [];
    const commits = rows.map((c) => {
      const msg = textValue(c.commit?.message);
      const subject = msg.split("\n")[0];
      // category = the "<area>:" prefix if present, else a coarse bucket
      const m = subject.match(/^([A-Za-z][\w -]{1,24}):/);
      return {
        sha: textValue(c.sha).slice(0, 7),
        subject: subject.slice(0, 160),
        category: m ? m[1].trim() : "",
        author: textValue(c.commit?.author?.name) || textValue(c.author?.login) || "unknown",
        email: textValue(c.commit?.author?.email),
        login: textValue(c.author?.login) || undefined,
        date: textValue(c.commit?.author?.date) || null,
      };
    });
    res.status(200).json({ available: true, repo: REPO, commits });
  } catch {
    res.status(200).json({ available: true, commits: [], error: "github_unavailable" });
  }
}
