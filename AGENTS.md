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

## Design canon (product-owner decisions; do not override)

`DESIGN.md` is the binding visual contract. Three decisions are settled by the
product owner (Enigma) and must not be reversed by any agent without a new,
explicit instruction in the task at hand:

1. The Auric File structure is the canonical report reading layer on every
   scan surface: warm paper, serif judgment headlines, the composition strip,
   dimension chapters, the case grid, and receipt popovers.
2. In Style 1 the composition section (`#composition`: the score strips and
   the dimension chapters) stays ALWAYS visible in the reading flow. Never
   collapse it into a `<details>`/appendix, remove its expanding rows, or
   strip its "Read the evidence" and "Challenge this" links.
3. Style 2 preserves the report experience shipped on 2026-08-25, verbatim:
   the dossier story (`DossierReport`) opening the person report with the
   full flow kept below it, and the collapsed evidence-ledger appendix on
   investigations. It is the reader's explicit choice via the style buttons
   or `?reportStyle=2` — never the default. Style 1 (the Auric File) remains
   the default everywhere. Do not restyle Style 2 without owner sign-off.

A redesign that conflicts with these stops before shipping and opens an issue
labeled `needs-routing` instead.
