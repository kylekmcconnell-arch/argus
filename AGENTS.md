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

Keep secrets, customer/private data, provider transcripts, and credentials out
of GitHub. Publishing, deployments, messages, purchases, permissions, and
financial actions require explicit authorization and the existing guarded
workflow. Never bypass protected branches or required checks.

Repository-specific instructions below remain mandatory within this routing and
authority contract.
