# E2E Task Ownership Standard

Source: R02 / R05 / R06. Task: ADP-073-T04, Issue #111.

## Responsibility and completion

The implementation Task owner retains end-to-end accountability until merge, Acceptance Criteria evidence and Notion/TTE closure. The owner need not perform independent review or merge: R02 assigns those actions to a different authorized actor. PR creation, review request and implementation handoff do not satisfy Done.

## State and evidence

| State | Responsible actor | Required evidence |
| --- | --- | --- |
| Ready → In Progress | Implementation actor | Existing GitHub Issue, task-start and active TTE |
| In Progress → Review | Author | PR URL, head SHA, test evidence, named reviewer and merger |
| Review → Ready | PR Flow Gate on actionable current-head finding | Same original implementation Task, finding evidence, owner |
| Review Fix → Review | Implementation actor | Disposition Coverage=100%, fix head, commit-update review handoff |
| Review → merge | R02-authorized final integrator | Current-head review, required CI, no P0/P1, mergeability |
| Merged → Done | E2E owner/completion control | Merge SHA, Acceptance Evidence, closed TTE, Notion closure, dependency release |

Do not create passive Codex wait Tasks or leave ownerless Review states. If Notion requeue fails, keep the original Task in known review_fix_requeue_pending inventory. Reuse existing pr-flow-gate, pr-review-convergence, scheduled-skill-dispatcher and task-state-reconcile; do not invent new scheduler or approval gates.

## PR #23 regression replay

Given Claude opens PR #23 and Codex reports a current-head P1, when PR Flow Gate classifies REVIEW_FIX, the original implementation Task must return to Ready with Claude as fix owner. Fix push must trigger current-head re-review; after clean review Chris merges. The Task remains open until merge and AC/TTE evidence. A new passive review Task must not be created.

Negative fixtures: PR submitted but not reviewed is not Done; obsolete-head finding needs applicability check; failed CI blocks merge; Chris-authored ordinary code PR merges through Claude; Claude-authored ordinary code PR through Chris; skills/brain/experimental preserve R02 self-merge; AOD article-specific route overrides generic Codex route when authoritative (ADP-054-T24); merged without AC or closed TTE remains incomplete; per-Task failure does not stop other Tasks or recurring scheduler.
