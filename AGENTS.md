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
4. If the task is already `Blocked` for a Human reason, or already carries an open Human Request, re-run the Human gate pre-flight in `governance/ai-execution-constraints.md` before accepting that the gate still holds. A gate written earlier is not evidence about the present.
5. Verify current primary documentation when the work depends on an external SDK, library, service, standard, or API.
6. Before external retrieval, communication, or use of a metered service, execute the pre-flight gate in `governance/research-security-policy.md`. If data classification, secret handling, extraction budget, billing, or write authority is unclear, stop before the external action.

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

## PR Review Contract

Every PR author must publish a **Review Contract in the PR body before requesting review**. This is the reviewer's model-level contract, not optional prose. Follow `governance/pr-review-contract.md` and the repository PR template.

Required sections:

1. **Purpose / Contract** — what must become true because of this PR.
2. **Invariants** — conditions that must remain true across all relevant inputs and state transitions.
3. **Adversarial Scenarios** — boundary cases, failure sequences, retries, concurrency, legacy state, or other counterexamples that could violate the invariants.
4. **Validation** — tests or evidence mapped to the invariants/scenarios.
5. **Known Limitations / Non-goals** — intentionally deferred behavior or scope boundaries.

The depth scales with the change, but the sections do not disappear. A trivial PR may use one concise invariant and one adversarial scenario; a stateful or safety-sensitive PR should make the state model and execution boundaries explicit.

The reviewer evaluates in this order: **contract/model → invariants → adversarial counterexamples → implementation details**. Do not begin with line-by-line bug finding when the model itself is unclear. If implementation changes the model, update the PR Review Contract before asking for another review.

The `Review Contract` CI check must pass before merge. Immediately before merge, verify the **exact latest head SHA and the exact latest PR body**: required CI is green, the latest Codex review for that exact SHA has completed with no unresolved P0/P1, and the request that triggered that review (the `@codex review` comment, PR open, or ready-for-review event — not the review's own completion time) has a `created_at` at or after the PR's `updated_at`. A review's completion timestamp is not a safe freshness proxy: a review can start against an older body and still finish (and submit) after a later edit landed, so bind to when it was *requested*, not when it *finished*. A review still pending, or one whose triggering request predates the current PR body, is not a clean review; do not merge on either. **Never post a re-request while a prior one is still outstanding** — confirm the previous request's review already completed before posting the next `@codex review`. Two requests outstanding at once breaks the pairing this rule depends on (an older, slower review can complete after the newer request and be mistaken for its answer); if that happens, treat every review from the overlapping window as unreliable and post one fresh request only after confirming nothing else is outstanding. See `governance/pr-review-contract.md` for the full freshness rule.

## Completion

Immediately before marking a Notion task Done, **re-read** and execute the completion post-flight in `governance/ai-execution-constraints.md`:

- directly verify acceptance criteria and intended artifact/result;
- record material evidence and commit/PR URLs in `Result` or the relevant reference property;
- verify the applicable Task Time Event exists and close it with `Ended At` (JST);
- record `Completed At` (JST);
- execute the Human gate pre-flight before creating a Human Request or moving to `Blocked` for a Human reason, and route only the genuinely Human-only remainder instead of falsely marking the task Done;
- transition `Status = Done` only after the supporting evidence/time records exist.

If the Time Event is absent or still open, stop: the Task is not Done.
