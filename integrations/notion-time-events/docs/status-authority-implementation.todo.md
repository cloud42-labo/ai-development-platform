# Implementation handoff

The regression tests in `test/status-authority.test.mjs` intentionally fail against current `main` until `enforceDoneGate_` is changed.

Required source change in `Code.gs`:

1. Add a narrow predicate for an explicit authoritative Done closure: `Closure Reason=Done`, non-empty `Result`, `Completed At`, `Closed At`, and no open Time Event.
2. Treat only `missing_task_started_at`, `stale_task_started_at`, `missing_applicable_time_event`, and `stale_completed_at` as telemetry compatibility failures on that explicit-Done path.
3. When all failures are from that set and authoritative closure exists, return `done_gate_warning:telemetry_gap:<failures>` and DO NOT call `updateTaskStatus_`.
4. Preserve current hard rollback behavior for `missing_result`, `missing_completed_at`, `open_time_event`, `stale_result`, and other non-telemetry failures.
5. Do not change `reconcileStaleCompletionEvidence_`; non-Done auto-promotion must stay strict to protect intentional reopen.

After implementation, remove this handoff file before merge if desired.
