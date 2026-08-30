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

Immediately before merge, the merge actor must verify the exact latest head SHA:

- required CI for that SHA is green;
- the latest Codex review for that exact SHA has completed;
- there are no unresolved P0/P1 findings;
- any required device/permission/security acceptance is complete.

A pending latest-head review is not equivalent to a clean review.
