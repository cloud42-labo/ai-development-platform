# BUG-ADP-STATUS-02 — Status authority hotfix

## Live evidence

On 2026-09-10 JST, `Cloud42 Time Events PoC` / `Sync Log` showed `notion_poll` repeatedly changing objectively completed `Status=Done` pages back to `Review` with outcomes including:

- `done_gate_rejected:missing_task_started_at:rollback=Review`
- `done_gate_rejected:missing_applicable_time_event:rollback=Review`
- `done_gate_rejected:stale_task_started_at:rollback=Review`
- `done_gate_rejected:stale_completed_at:rollback=Review`

The following poll then records `stale_completion_evidence_unresolved:*`, producing the observed Done/Review oscillation.

## Authority contract

`Stories & Tasks.Status` and explicit completion fields are the business-state source of truth. `Task Time Events` is execution telemetry and must not overwrite a completed business state merely because legacy execution telemetry is incomplete.

For an explicit current `Status=Done`, preserve Done when all authoritative closure evidence exists:

- `Closure Reason=Done`
- non-empty `Result`
- `Completed At` exists
- `Closed At` exists
- no open Task Time Event

If the only remaining `evaluateDoneEvidence_` failures are legacy execution/telemetry compatibility failures (`missing_task_started_at`, `stale_task_started_at`, `missing_applicable_time_event`, or `stale_completed_at`), return an observable `done_gate_warning:telemetry_gap:<failures>` outcome and do not mutate Status.

Hard completion failures remain hard failures, including at least `missing_result`, `missing_completed_at`, `open_time_event`, and `stale_result`.

Do not loosen `reconcileStaleCompletionEvidence_` for non-Done pages. This prevents intentional reopen operations from being silently auto-closed by old completion evidence.

## Minimal implementation

Change only the explicit-Done enforcement path (`enforceDoneGate_`) by adding a narrow authoritative-closure predicate and telemetry-only failure classification. Reuse existing helpers (`propertyText_`, `propertyDate_`) and keep the existing strict evaluator intact for non-Done promotion.

Regression tests are in `test/status-authority.test.mjs`.
