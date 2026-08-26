import { evaluateReportLaneOwnership } from "./report-lane-ownership-policy.mjs";

const token = process.env.GITHUB_TOKEN ?? "";
const repository = process.env.GITHUB_REPOSITORY ?? "";
const pullNumber = process.env.REPORT_LANE_PR_NUMBER ?? "";
const actor = process.env.REPORT_LANE_ACTOR ?? process.env.GITHUB_ACTOR ?? "";
const baseRef = process.env.REPORT_LANE_BASE_REF ?? process.env.GITHUB_BASE_REF ?? "";

async function githubJson(path) {
  if (!token || !repository || !pullNumber) {
    throw new Error("GITHUB_TOKEN, GITHUB_REPOSITORY, and REPORT_LANE_PR_NUMBER are required");
  }
  const response = await fetch(`https://api.github.com/repos/${repository}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) throw new Error(`GitHub API ${response.status} for ${path}`);
  return response.json();
}

async function pullFiles() {
  const files = [];
  for (let page = 1; ; page += 1) {
    const batch = await githubJson(`/pulls/${pullNumber}/files?per_page=100&page=${page}`);
    files.push(...batch.map((item) => item.filename));
    if (batch.length < 100) return files;
  }
}

async function approvingReviewers() {
  const reviews = [];
  for (let page = 1; ; page += 1) {
    const batch = await githubJson(`/pulls/${pullNumber}/reviews?per_page=100&page=${page}`);
    reviews.push(...batch);
    if (batch.length < 100) break;
  }
  const latestState = new Map();
  for (const review of reviews) {
    const login = review.user?.login;
    if (login) latestState.set(login, review.state);
  }
  return [...latestState.entries()]
    .filter(([, state]) => state === "APPROVED")
    .map(([login]) => login);
}

const files = await pullFiles();
const approvals = await approvingReviewers();
const result = evaluateReportLaneOwnership({ actor, baseRef, files, approvals });

console.log(JSON.stringify(result.summary, null, 2));
if (!result.ok) {
  for (const error of result.errors) console.error(`::error::${error}`);
  process.exitCode = 1;
} else {
  console.log("Report lane ownership passed");
}
