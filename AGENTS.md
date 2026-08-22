# AGENTS.md

## Repository purpose

This repository is the system of record for durable ADP artifacts and intellectual assets. Notion remains the system of record for operational work state. `cloud42-labo/brain` remains the organizational-memory store.

## Mandatory lifecycle gate

For every managed task, **do not rely on conversational memory**. At task start and again immediately before completion, read and execute `governance/ai-execution-constraints.md`. This is mandatory for Chris/ChatGPT and Claude alike.

A managed Task may not be considered complete merely because an artifact is produced or a PR is merged. `Status = Done` is permitted only after acceptance criteria, Result evidence, the applicable Task Time Event, and `Completed At` are complete. If a Human Time Event lacks an exact observable timestamp, ask rather than estimate it.

## Before starting work

1. Read the relevant Notion Product / Epic / Story / Task.
2. Confirm acceptance criteria and the authoritative artifact path in this repository.
3. Execute the managed-work pre-flight in `governance/ai-execution-constraints.md`: exact Task exists, executable state/Blocker is valid, `Status = In Progress` + `Started At` (JST) are recorded, Task Time Event is opened, and actor authority is valid. Do not perform the substantive write/work until this gate passes.
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

Immediately before marking a Notion task Done, **re-read** and execute the completion post-flight in `governance/ai-execution-constraints.md`:

- directly verify acceptance criteria and intended artifact/result;
- record material evidence and commit/PR URLs in `Result` or the relevant reference property;
- verify the applicable Task Time Event exists and close it with `Ended At` (JST);
- record `Completed At` (JST);
- route residual Human/other-agent work instead of falsely marking the task Done;
- transition `Status = Done` only after the supporting evidence/time records exist.

If the Time Event is absent or still open, stop: the Task is not Done.
