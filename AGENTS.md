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

## Independent review availability fallback

Codex remains the default independent PR reviewer where the repository workflow requires Codex review. A documented reviewer availability failure — including usage-limit exhaustion, platform outage, or connector/service failure — must not by itself stop the execution chain when another independent reviewer is available.

When the preferred reviewer is unavailable:

1. **Preserve reviewer independence.** The fallback reviewer must be a different agent from the PR implementation author. Prefer Chris/ChatGPT for Claude-authored PRs and Claude Opus for Chris/ChatGPT-authored PRs, but if that preferred fallback is also unavailable, another available independent reviewer may be used. If independence cannot be maintained, the PR must not merge; non-dependent work should continue rather than treating reviewer unavailability as a stop for the whole execution chain.
2. **Review the exact current revision.** Record the current head SHA and review the PR Review Contract, acceptance criteria, invariants, adversarial scenarios, changed files, and the delta since the last completed independent review when one exists.
3. **Keep the normal quality gate.** Before merge, verify CI is green for the exact reviewed head, all applicable review threads are resolved, no unresolved P0/P1 finding remains, the PR is mergeable, and every Human/device/environment gate that actually applies to merge is satisfied.
4. **Recheck head identity immediately before merge.** The PR head SHA at merge time must equal the recorded independently reviewed SHA. If the head moved, the intervening delta must receive independent review before merge.
5. **Record evidence.** Add a PR comment/review identifying the reviewer availability failure, fallback reviewer, reviewed head SHA, checks performed, findings by severity, and merge/no-merge decision. Record the same material result in the governing Notion Task.
6. **Do not buy capacity implicitly.** A reviewer usage limit does not authorize automatic credit purchase, plan upgrade, or other metered fallback. Paid capacity changes require prior Owner approval.
7. **Scope the exception narrowly.** This substitutes only the unavailable reviewer. It does not relax acceptance criteria, CI, P0/P1 policy, Human/device gates, author/reviewer separation, or Definition of Done.

## Review-loop cost guardrail

Repeated review must not become an unbounded design-discovery loop.

1. **Round 3 — refinement trigger.** If three substantive review rounds produce new findings in the same subsystem, state transition, invariant, migration, retry/failure mode, or provenance model, stop patch-by-patch fixing and return to Approach Refinement before requesting another automated review. Update the design/approach, enumerate the affected state-transition and failure matrix, and add the corresponding tests before resuming review.
2. **Round 5 — hard cap.** Five substantive review rounds on one PR is the default maximum. Do not request a sixth automated review unless the Owner explicitly approves an exception. Instead, return the work to Refinement, split the PR if needed, or redesign the change so that the next review evaluates a materially consolidated revision.
3. **Count meaningful rounds, not transport retries.** A round counts when an independent reviewer evaluates a revision and returns findings or a clean verdict. Failed invocations that produce no review result do not count.
4. **Do not reset the count by pushing trivial commits.** The round counter follows the PR/change objective. A new commit, reviewer substitution, or fallback does not reset it. A deliberately split replacement PR may start a new count only after the governing Notion Task records the refinement/split decision.
5. **Treat the cap as a process signal, not a quality waiver.** Hitting the cap never permits merging with unresolved P0/P1 findings. It requires redesign/refinement instead of consuming more review rounds.

## Completion

Immediately before marking a Notion task Done, **re-read** and execute the completion post-flight in `governance/ai-execution-constraints.md`:

- directly verify acceptance criteria and intended artifact/result;
- record material evidence and commit/PR URLs in `Result` or the relevant reference property;
- verify the applicable Task Time Event exists and close it with `Ended At` (JST);
- record `Completed At` (JST);
- execute the Human gate pre-flight before creating a Human Request or moving to `Blocked` for a Human reason, and route only the genuinely Human-only remainder instead of falsely marking the task Done;
- transition `Status = Done` only after the supporting evidence/time records exist.

If the Time Event is absent or still open, stop: the Task is not Done.
