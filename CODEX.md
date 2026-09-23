<!-- oenbot-provider-bootstrap:v1 -->

# Codex bootstrap

Read `AGENTS.md` and `config/agent-context.json`, then run
`node scripts/validate-agent-context.mjs` before editing. GitHub is the durable
handoff; a Codex task's own transcript is supporting context, not source
authority. Continue the issue, branch and pull request that already exist
rather than starting a parallel one.

New to this repository: read `docs/ONBOARDING.md` first. It carries the
verification battery every pull request must pass, the `TZ=UTC` pin the test
run needs, and the gotchas that have cost real time. For review tasks, pair it
with `docs/CODEX-REVIEW-BRIEF.md`, which ranks the failure modes that matter
here and records what is already known, fixed, or disproven.

No personal approval gates: automated checks are the only gate. Never hold work,
a pull request, or a document waiting for a named collaborator to approve it
(see "No personal approval gates" in `AGENTS.md`).
