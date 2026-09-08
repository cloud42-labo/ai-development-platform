# Daily Operating Schedule

This schedule is part of the Vibe Product Development Operating Guide. All times are JST.

| Time | Routine | Executable Skill / purpose | Success condition |
|---|---|---|---|
| 23:00 daily | Daily Close | `daily-close` (`cloud42-labo/skills`) — close completed execution units, refine unfinished execution units into work that can finish within one AI operating day, repair Status / Completed At / Closed At / TTE consistency | Excluding `Type=Story`, execution-unit `Status=In Progress` = 0 |
| Following morning | Daily Report | Aggregate the previous calendar day's outcomes and Task Time Events after Daily Close normalizes lifecycle state | Report uses normalized closed-day state; unresolved quality warnings are explicit |

## Daily Close policy

The 23:00 Daily Close is **not a carry-over process**.

An unfinished execution Task must not remain `In Progress` for the next day. It must be either:

1. objectively completed and closed; or
2. re-refined into independent execution units that can each finish within one AI operating day, with the original Task closed as `Superseded / Replaced by refined work`.

Human or external dependencies are separated from AI execution work rather than preserving a multi-day `In Progress` Task. Existing Human Requests and dependency Tasks are reused rather than duplicated.

`Type=Story` is excluded from this execution-unit close gate and from TTE execution measurement.

The Daily Close must reconcile `Status`, `Completed At`, `Closed At`, and Task Time Events. Success requires zero:

- execution-unit `Status=In Progress` (excluding Story);
- `Closed At` + `In Progress` inconsistencies;
- `Completed At` + `In Progress` inconsistencies;
- terminal Status + Open TTE inconsistencies;
- execution Tasks exceeding one AI operating day without refinement.

## Routine contract

Scheduler/Routine configuration contains **When**, while the Skill contains **How**. The 23:00 Routine should contain only:

- firing time: 23:00 JST daily;
- scope: Vibe Product Development / Stories & Tasks;
- invocation: `daily-close`;
- failure rule: record `Needs Human` or `Failed` with the unresolved anomaly; never silently carry an execution Task forward.
