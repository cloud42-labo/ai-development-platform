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
- **the current PR body is byte-identical to the body captured when the review being relied on was requested** — see "Binding review freshness to the contract revision" below;
- there are no unresolved P0/P1 findings;
- any required device/permission/security acceptance is complete.

A pending latest-head review is not equivalent to a clean review. Neither is a review that answered an older body revision: the head SHA alone does not identify what was reviewed, because the Review Contract itself lives in the PR body, not in a commit.

### Binding review freshness to the contract revision

The head SHA identifies which *code* was reviewed. It does not identify which *Review Contract* was reviewed, because editing the PR body — the Review Contract's only home — does not create a new commit and does not change the head SHA. A reviewer (Codex or a human) can review head `H` against contract revision `B1`; the author can then materially edit the body to `B2` without pushing anything; the existing review remains "the latest completed review for head `H`" under a SHA-only freshness check, even though it never saw `B2`.

**Bind freshness to the body's own content, not to `pr.updated_at`.** An earlier version of this rule compared the triggering request's `created_at` against `pr.updated_at`, reasoning that GitHub's `updated_at` answers "when did this PR (including its body) last change?" natively, with no new service, secret, or stored digest. That reasoning has a flaw: `pr.updated_at` advances on *any* PR activity — a comment, a review submission, a label — not just a body edit. Re-checking `request.created_at >= pr.updated_at` at merge time, after the review's own completion comment (and any reply after it) has already bumped `pr.updated_at` past the request, makes even a genuinely fresh, correctly serialized review register as stale by construction — every completed review immediately invalidates itself, and posting another request just repeats the cycle. `pr.updated_at` answers "when did anything about this PR last change," never specifically "when was the body last edited," so it cannot be the freshness signal.

The PR body's own text has no such contamination: only an actual body edit changes it. So the merge gate compares body **content**, not a timestamp:

- **When posting a review request** (`@codex review`, or relying on the PR's own open/ready-for-review event), the merge actor records the exact current PR body being requested against — quoting its head SHA and, where useful, a short content fingerprint (e.g. a SHA-256 of the body text) directly in the request comment. This still requires no new external service, secret, or stored digest: the body text is already read from the same GitHub API surface the SHA-based check uses: the fingerprint is a value derived from it, not a new source of truth.
- **A completed review is fresh for the current contract only if the current PR body (read fresh, immediately before merge) is byte-identical to the body captured for the request it answers.** Any body edit at all — including one that only touches `## Summary`/`## References` prose — invalidates freshness under this check, same as before; a false negative here (an unnecessary re-review request) is preferred over a false positive (merging on a review that never saw a material contract edit) — this repository's connector does not expose a way to distinguish material from cosmetic body edits without adding an external service, which is out of scope (see Known Limitations in PR #11's Review Contract).
- **Never post a new review request while a previously posted one is still outstanding (requested, not yet completed).** This is an operational rule on how requests are issued, not a detection heuristic applied after the fact — and it is what makes the pairing below sound. Before commenting `@codex review` (or otherwise re-requesting), confirm the most recent prior request already has a completed review. If it does not yet, wait for it (or, if it will never come — the request was superseded some other way — say so explicitly rather than layering a second request on top of an unanswered first one).
- **Given that serialization, identify which request a given completed review answers as the single request that was outstanding when it landed.** With no more than one request ever outstanding at a time, this pairing is unambiguous by construction: only one request can be awaiting a response at any point a review lands, so there is no other candidate request it could be answering instead. Reviewer identity (Codex is invoked exactly once per triggering event) reinforces this but is not what makes it safe — the serialization discipline above is.
- **This pairing is unsafe, and must not be relied on, the moment two requests are found outstanding at once** — e.g. a re-request posted before confirming the prior one had completed, discovered after the fact. Recover by treating every review from the overlapping window as unreliable and posting one single fresh request only after confirming nothing else is outstanding, then waiting for that request's own response before merging.
- If the PR body was edited after the request that produced the review being relied on, that review is stale for the contract regardless of when it happened to finish — post a fresh `@codex review` (or equivalent human re-request) after the edit, not before it, capture the new body's content, and rely on the review answering *that* request.
- This rule requires no new external service, secret, or stored digest — the PR body text and the request comment's `created_at` are both already read from the same GitHub API surface the "exact latest head SHA" check already uses; the content fingerprint is a value derived from the body, not a new source of truth.
