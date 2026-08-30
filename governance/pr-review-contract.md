# PR Review Contract

## Purpose

Every pull request must present the model the reviewer is expected to challenge before the reviewer inspects implementation details. The goal is to prevent a review loop in which individually correct local fixes expose one boundary condition at a time.

The PR author owns this contract and keeps it current as the implementation changes.

## Required PR body sections

### Purpose / Contract

State what the PR must make true. Prefer observable system behavior over implementation detail.

### Invariants

List the conditions that must not be violated by any relevant input or state transition. Use stable identifiers such as `I1`, `I2`, and so on when there is more than one.

Examples:

- an execution cannot reuse evidence from a prior execution;
- a retry does not create duplicate authoritative records;
- an authorization failure never produces a successful mutation.

### Adversarial Scenarios

Describe the smallest counterexamples that could violate the invariants. Include the classes that matter to the change, such as boundary timestamps, retries, concurrency, reassignment, reopen, partial failure, pagination, legacy data, malformed input, or permission changes.

For simple changes, one concise scenario is enough. For stateful changes, provide state-transition sequences.

### Validation

Map tests or evidence to the invariants and adversarial scenarios. A test list without stating what invariant it protects is weaker than a mapped validation plan.

### Known Limitations / Non-goals

State what is intentionally not solved by the PR. This prevents a reviewer from silently expanding scope and makes deferred risk explicit.

## Review order

Reviewers use this order:

1. **Purpose / Contract** — is the intended behavior coherent and scoped?
2. **Invariants** — are the necessary safety/correctness conditions complete?
3. **Adversarial Review** — can a counterexample or state-transition sequence violate an invariant?
4. **Code Review** — does the implementation faithfully realize the accepted model?

The first three steps are model review. They happen for every PR; only the depth varies with complexity.

## Author responsibilities

- Fill all required sections before requesting review.
- Keep the contract synchronized with the implementation after material fixes.
- Add or revise tests when a reviewer finds a missing adversarial scenario.
- Do not answer a model-level finding with only a local patch if the patch changes the model; update the contract first.

## Reviewer responsibilities

- Challenge invariants and attempt to construct counterexamples before line-level review.
- Prefer a minimal reproducible state/input sequence when reporting a model-level defect.
- Distinguish a missing invariant/model defect from an implementation defect.
- Re-review the contract when the model changes.

## Merge gate

The PR body is machine-checked by the `Review Contract` GitHub Actions workflow. All required sections must contain substantive content.

Immediately before merge, the merge actor must verify the exact latest head SHA **and** the exact latest PR body:

- required CI for that SHA is green;
- the latest Codex review for that exact SHA has completed;
- **the review being relied on was requested at or after the PR's own `updated_at`** — see "Binding review freshness to the contract revision" below;
- there are no unresolved P0/P1 findings;
- any required device/permission/security acceptance is complete.

A pending latest-head review is not equivalent to a clean review. Neither is a review whose `submitted_at` predates the PR's `updated_at`: the head SHA alone does not identify what was reviewed, because the Review Contract itself lives in the PR body, not in a commit.

### Binding review freshness to the contract revision

The head SHA identifies which *code* was reviewed. It does not identify which *Review Contract* was reviewed, because editing the PR body — the Review Contract's only home — does not create a new commit and does not change the head SHA. A reviewer (Codex or a human) can review head `H` against contract revision `B1`; the author can then materially edit the body to `B2` without pushing anything; the existing review remains "the latest completed review for head `H`" under a SHA-only freshness check, even though it never saw `B2`.

GitHub's PR `updated_at` timestamp already answers "when did this PR (including its body) last change?", natively and with no new service, secret, or stored digest: any edit to the PR — a body edit included — advances it. So the merge gate binds freshness to the *contract revision*, not just the code revision.

**Bind to when the review was requested, not when it completed.** A review's own completion timestamp (`review.submitted_at`) is not a safe proxy for "this review saw the current body": Codex (or a human reviewer) can begin a review against body `B1`, the author can edit the body to `B2` *while that review is still running*, and the review can then complete and submit *after* `B2` landed — its `submitted_at` would be later than `pr.updated_at`, wrongly reading as fresh, even though the review only ever evaluated `B1`. The completion timestamp reflects when the reviewer finished reading, not when it started, and a body edit can land at any point during that window.

What every review DOES have a reliable timestamp for is what triggered it — Codex's own trigger rules are exactly: opening the PR, marking a draft ready, or an explicit `@codex review` comment. Bind freshness to that request instead:

- **A completed review is fresh for the current contract only if the request that triggered it — the `@codex review` comment, or the PR's own `created_at`/`ready_for_review` event — has a `created_at` at or after `pr.updated_at`.** The request event necessarily happens before the reviewer starts reading, so a request timestamped at or after the last body edit guarantees the reviewer fetched the current body, regardless of how long the review then took to complete.
- **Never post a new review request while a previously posted one is still outstanding (requested, not yet completed).** This is an operational rule on how requests are issued, not a detection heuristic applied after the fact — and it is what makes the pairing below sound. Before commenting `@codex review` (or otherwise re-requesting), confirm the most recent prior request already has a completed review whose `submitted_at` is at or after that prior request's own `created_at`. If it does not yet, wait for it (or, if it will never come — the request was superseded some other way — say so explicitly rather than layering a second request on top of an unanswered first one).
- **Given that serialization, identify which request a given completed review answers as the request whose `created_at` most closely precedes that review's `submitted_at`.** With no more than one request ever outstanding at a time, this pairing is unambiguous by construction: only one request can be awaiting a response at any point a review lands, so there is no other candidate request it could be answering instead. Reviewer identity (Codex is invoked exactly once per triggering event) reinforces this but is not what makes it safe — the serialization discipline above is.
- **This pairing is unsafe, and must not be relied on, the moment two requests are found outstanding at once** — e.g. a re-request posted before confirming the prior one had completed, discovered after the fact. In that case a review's `submitted_at` postdating `pr.updated_at` no longer proves it saw the current body: an older, slower-to-complete review from the earlier request can complete after the newer request was posted and be misattributed to it, passing off a review of a stale contract as fresh (this is exactly how the "latest completed review" framing this section replaced could be fooled). Recover by treating every review from the overlapping window as unreliable and posting one single fresh request only after confirming nothing else is outstanding, then waiting for that request's own response before merging.
- If the PR body was edited after the request that produced the review being relied on (`pr.updated_at > request.created_at`), that review is stale for the contract regardless of when it happened to finish — post a fresh `@codex review` (or equivalent human re-request) after the edit, not before it, and rely on the review answering *that* request.
- A body edit that only touches `## Summary`/`## References` prose still advances `updated_at` and is treated the same as a Review Contract edit by this check; a false negative here (an unnecessary re-review request) is preferred over a false positive (merging on a review that never saw a material contract edit) — this repository's connector does not expose a way to distinguish material from cosmetic body edits without adding an external service, which is out of scope (see Known Limitations in PR #11's Review Contract).
- This rule requires no new external service, secret, or stored digest — `pr.updated_at`, the request comment's `created_at`, and the review's `submitted_at` are all already read from the same GitHub API surface the "exact latest head SHA" check already uses.
