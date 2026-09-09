# Daily Operating Schedule

This schedule is part of the Vibe Product Development operating model. All times are JST.

| Time | Routine | Executable Skill / purpose | Success condition |
|---|---|---|---|
| 23:00 daily | Daily Close | `daily-close` (`cloud42-labo/skills`) — close/refine execution Tasks and audit all `cloud42-labo` Open PRs | Excluding `Type=Story`, execution-unit `Status=In Progress` = 0; `Unclassified Open PR` = 0; `Merge-ready but idle PR` = 0 |
| Following morning | Daily Report | Aggregate the previous calendar day's outcomes and Task Time Events after Daily Close normalizes lifecycle and PR state | Report uses normalized closed-day state; unresolved quality warnings and explicitly blocked PRs are visible |

## Daily Close policy

The 23:00 Daily Close is **not a carry-over process** for either execution Tasks or pull requests.

### Execution Tasks

An unfinished execution Task must not remain `In Progress` for the next day. It must be either:

1. objectively completed and closed; or
2. re-refined into independent execution units that can each finish within one AI operating day, with the original Task closed as `Superseded / Replaced by refined work`; or
3. explicitly blocked with a concrete restart condition when Human/external dependency is genuine.

Human or external dependencies are separated from AI execution work rather than preserving a multi-day `In Progress` Task. Existing Human Requests and dependency Tasks are reused rather than duplicated.

`Type=Story` is excluded from this execution-unit close gate and from TTE execution measurement.

### Pull requests

Daily Close must query **all Open PRs in the `cloud42-labo` organization**, not only PRs mentioned in that day's report, Task list, or notifications.

Every Open PR must be classified using current-head evidence into one of:

- `Merge now`: required review/checks are satisfied, mergeable, and no evidence-backed blocker remains. Merge during the close when authority permits.
- `Review / Fix`: material review feedback, failed checks, conflicts, stale review, or other AI-actionable work remains. Progress it under `pr-review-convergence`; do not leave it as generic "review waiting".
- `Supersede / Close`: duplicated or replaced PR with no remaining unique value. Record evidence and close it.
- `Explicit Blocked`: Human approval, external environment, usage limit, permission, or other non-AI-actionable dependency. Record the blocker and restart condition.

Open PR count itself does not have to be zero. The invariant is that **unclassified or idle merge-ready PRs do not survive the close**.

## Daily Close success gate

The Daily Close must reconcile Task lifecycle state and PR disposition. Success requires zero:

- execution-unit `Status=In Progress` (excluding Story), except an explicitly documented same-close exception that cannot be normalized safely;
- `Closed At` + `In Progress` inconsistencies;
- `Completed At` + `In Progress` inconsistencies;
- terminal Status + Open TTE inconsistencies;
- execution Tasks exceeding one AI operating day without refinement;
- `Unclassified Open PR`;
- `Merge-ready but idle PR`.

Any remaining Open PR must have a current same-day disposition and explainable next condition.

## Routine contract

Scheduler/Routine configuration contains **When**, while the Skill contains **How**. The 23:00 Routine should contain only:

- firing time: 23:00 JST daily;
- scope: Vibe Product Development / Stories & Tasks plus all Open PRs in `cloud42-labo`;
- invocation: `daily-close`;
- failure rule: record `Needs Human` or `Failed` with the unresolved anomaly; never silently carry an execution Task or unclassified PR forward.
