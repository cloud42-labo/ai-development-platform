# Live oscillation evidence — 2026-09-10 JST

Source: `Cloud42 Time Events PoC` → hidden `Sync Log`.

At 19:03–19:10 JST the running `notion_poll` repeatedly observed pages set to `Done`, rejected them for legacy execution telemetry gaps, and wrote `Review`. Immediately after, the same pages were logged as `stale_completion_evidence_unresolved:*` in Review.

Representative outcomes:

- Human Request: `missing_task_started_at` → rollback Review
- Human Request: `missing_applicable_time_event` → rollback Review
- Technical Task: `stale_task_started_at` → rollback Review
- Technical Task: `missing_applicable_time_event` → rollback Review
- Completed task: `stale_completed_at` / `missing_applicable_time_event` → rollback Review

This proves the oscillation is produced by the current Done Gate, not by a user-interface display issue. The remediation must stop telemetry-only gaps from mutating an otherwise authoritative completed business state while retaining telemetry warnings and true completion blockers.
