<!-- oenbot-agent-contract:v1 -->

# Shared GitHub agent contract

This is the provider-neutral starting point for Codex, Claude, Grok, Cursor,
Copilot, and any other coding agent working in this repository.

## Start every task

1. Run `node scripts/validate-agent-context.mjs`.
2. Read `config/agent-context.json`.
3. Inspect `git status --short --branch`, the linked GitHub issue, current
   branch, open pull request, diff, and CI before editing.
4. Continue durable GitHub state. Do not recreate another provider's work from
   chat memory.

This repository is the canonical product source for ARGUS. Normal changes to crypto due-diligence product belong here.

GitHub issues, short-lived branches, draft pull requests, review, CI, and the
protected default branch are the engineering handoff. OENBOT provides runtime
views, bounded evidence, routing, approvals, and operational controls; it is not
a second source-code store. Any OENBOT page, card, navigation, shared dashboard,
wallet, or trading UI change belongs in
`kylekmcconnell-arch/oenbot-dashboard-source`.

If ownership is not explicit, stop before editing and create or update an issue
labeled `needs-routing`. Never invent a repository mapping.

## No personal approval gates

Automated checks are the only gate. The four required checks plus review of the
diff decide whether work merges; no collaborator's personal sign-off is a
precondition for anything, in either direction.

- Do not hold work, a branch, a pull request, a design change, or a scoring
  weight open waiting for a named person (Kyle, Enigma, or anyone else) to
  approve it. Ship it behind the required checks.
- Do not write "awaiting <person>'s approval", "for <person>'s sign-off",
  "please confirm or overrule", or an "Asks" list that blocks a merge. State the
  decision you took and the evidence for it, and name what would reverse it.
- A handoff, audit, or design document is a record of a decision already taken,
  not a request for permission. Write it in the past tense and merge it.
- Disagreement is resolved by a follow-up pull request that changes the thing,
  not by a queue of pending approvals. Revert is always available.
- This does not relax the guarded workflow below: publishing, deployments,
  messages, purchases, permissions, financial actions, and anything that spends
  money or leaves the repository still need explicit authorization, and the
  protected branch and its required checks are never bypassed.

This rule was decided by the owner on 2026-09-09
(`docs/audits/2026-09-09/system-review.md`) and is machine-checked:
`config/agent-context.json` carries `authority.personalApprovalGates: "none"`
and `scripts/validate-agent-context.mjs` fails the `agent-context` check if it
drifts.

Keep secrets, customer/private data, provider transcripts, and credentials out
of GitHub. Publishing, deployments, messages, purchases, permissions, and
financial actions require explicit authorization and the existing guarded
workflow. Never bypass protected branches or required checks.

Repository-specific instructions below remain mandatory within this routing and
authority contract.

## New to this repository

Read `docs/ONBOARDING.md` first: what ARGUS is, the doctrines that govern what a
report is allowed to say, the architecture and scan pipeline, the subsystems, the
verification battery, and how to read the current state of the work. For review
tasks, pair it with `docs/CODEX-REVIEW-BRIEF.md`, which ranks the failure modes
that matter and records what is already known, fixed, or disproven.
