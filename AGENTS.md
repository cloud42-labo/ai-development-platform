# AGENTS.md

## Repository purpose

This repository is the system of record for durable ADP artifacts and intellectual assets. Notion remains the system of record for operational work state. `cloud42-labo/brain` remains the organizational-memory store.

## Before starting work

1. Read the relevant Notion Product / Epic / Story / Task.
2. Confirm acceptance criteria and the authoritative artifact path in this repository.
3. Record `Status = In Progress` and `Started At` (JST) in Notion immediately before execution.
4. Verify current primary documentation when the work depends on an external SDK, library, service, standard, or API.
5. Before external retrieval, communication, or use of a metered service, execute the pre-flight gate in `governance/research-security-policy.md`. If data classification, secret handling, extraction budget, billing, or write authority is unclear, stop before the external action.

## Source-of-truth rules

- Do not copy live task status, sprint state, timestamps, or execution logs into this repository as an alternative system of record.
- Put durable policies, standards, operating models, architecture, diagrams, capability maps, templates, and reusable design artifacts here.
- Put decisions and execution state in Notion; preserve only durable design decisions here when they are part of the artifact itself.
- Put learned context and organizational memory in `cloud42-labo/brain` rather than using this repository as a conversational memory dump.

## Change rules

- Keep changes scoped to the assigned Notion ticket.
- Prefer Markdown and Mermaid for durable, diffable documents.
- Never commit secrets, credentials, tokens, private personal data, company-confidential information, or material that is not intended to be public.
- Never transmit secrets or non-public material to an external service unless the governing task explicitly authorizes the data transfer; follow `governance/research-security-policy.md`.
- Do not silently switch to a metered external AI API or other pay-as-you-go path when a subscription/bundled path is unavailable. Prior Human approval is required for a paid path.
- If a change alters an operating policy, governance rule, control, or architecture, update the related Notion Decision or task result as well.
- If the repository artifact is the authoritative original, Notion should link to it instead of duplicating the full text unless an operational view is intentionally maintained there.

## Completion

Before marking a Notion task Done:

- verify the artifact exists at its intended repository path;
- record the commit or pull request URL in `Result` or the relevant reference property;
- confirm the acceptance criteria;
- set `Completed At` (JST) and `Status = Done`.
