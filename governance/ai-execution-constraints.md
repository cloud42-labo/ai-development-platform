# AI Execution Constraints

This file converts mandatory Vibe Product Development operating rules into pre-execution constraints for AI agents. The Operating Guide remains the policy source; these constraints are the executable guardrails.

## New Task placement pre-flight check

Before creating any new record in Notion Stories & Tasks, the acting AI MUST evaluate placement evidence **before** the create operation.

1. **Explicit Owner placement** — Did the Owner explicitly name the Product / Epic for this task?
2. **Explicit derivation** — If not, is this task an explicit child/derivative of an existing Task or Story whose placement makes the Product / Epic / Parent Story unambiguous?
3. **If either is true** — create the task only in that evidenced placement.
4. **If neither is true** — do not infer placement from topic similarity. Create it as `MISC｜<title>` with `Status = Backlog`, leaving Product / Epic / Parent Story unset until Backlog Refinement.

Creating first and correcting placement afterward does not satisfy this check. The placement decision is a precondition to the write operation.

## Managed-work execution pre-flight

Before performing any managed work that writes to Notion, GitHub, another connected system, or creates a durable project artifact, the acting AI MUST verify **all** of the following before the first work action:

1. **Task exists** — there is an active Stories & Tasks record for the exact unit of work. A completed task may not be silently reused for new scope; reopen it only when reopening is explicitly correct, otherwise create a new task using the placement pre-flight above.
2. **Executable state** — the task is `Ready` or an already-valid `In Progress` continuation, its Definition of Ready is satisfied, and no unresolved Blocker prohibits execution.
3. **Start state recorded** — immediately before execution, set `Status = In Progress` and record `Started At` in JST if this execution has not already started.
4. **Time event opened** — create/open a Task Time Event for the actor and current active interval before the substantive work begins.
5. **Authority checked** — confirm the acting AI has authority for the intended action. Human-only/account/physical/irreversible actions must be transferred instead of performed by an unauthorized AI.

If any required check fails, do not start the substantive work. Repair the tracking/state problem first or record a Blocker and stop that task.

A chat instruction, branch, commit, draft artifact, or external action performed before this gate does not count as compliant merely because Notion is corrected afterward.

## Managed-work completion post-flight

Before setting a managed task to `Done`, the acting AI MUST verify **all** of the following, in this order:

1. **Acceptance criteria verified** — directly check the required artifact/result, not only the implementer's completion claim.
2. **Evidence recorded** — update `Result` with the material outcome, decisions, relevant URLs/commit/PR identifiers, and any remaining limitations.
3. **Time interval closed** — verify that a Task Time Event exists for the actor/current active interval and set its `Ended At` in JST. Active Time is derived from the event; do not invent an `Actual Time` value independently when the rollup is authoritative. **A task with no applicable Time Event, or with an open Time Event, MUST NOT be marked Done.**
4. **Completion timestamp recorded** — set `Completed At` in JST after the time record is complete.
5. **Status transition last** — set `Status = Done` only after the evidence and time records needed to support Done are present.
6. **Residual work routed** — if Human/another agent action remains necessary to satisfy the task's own acceptance criteria, do not mark the task Done; create/route the explicit follow-up and use the correct waiting/blocked state.

### Human work and PR completion

- Human physical/account/validation work is also managed work when it is represented by a Notion Task. Record its Task Time Event using observable real start/end timestamps when those timestamps are available from the interaction or system record.
- If an exact Human start or end timestamp cannot be established, **do not fabricate or estimate it**. Ask the Human for the missing time before closing the Task.
- A merged PR is evidence of artifact completion, not evidence that the related Notion Task is administratively complete. Before treating a PR-related Task as complete, verify its Result, Task Time Event, Completed At, and residual Human work.
- Chris/ChatGPT and Claude are subject to the same pre-flight and post-flight gates. Agent identity does not waive the control.

## Postmortem connection

If managed work is discovered to have bypassed the execution pre-flight or completion post-flight:

- correct the current task/time/evidence records without hiding the original gap;
- execute `governance/postmortem-improvement-loop.md`;
- record or update the violation in Notion Postmortems;
- connect the preventive task/control to that Postmortem;
- treat the control as high-risk/manual-check-required until the preventive action is implemented and retested.

Documentation of the violation is not closure. Closure requires the preventive work and representative retest defined by the Postmortem Improvement Loop.

## Enforcement rule

Any AI workflow or Skill that creates a Stories & Tasks record MUST execute the placement pre-flight check first. Any AI workflow that performs managed work MUST execute the managed-work execution pre-flight and completion post-flight.

A prompt such as “this looks like ADP/AOD/etc.” is not placement evidence. Only explicit Owner placement or explicit derivation from an already placed Task/Story is sufficient.

If placement evidence is ambiguous, default to MISC / Backlog. Weekly Backlog Refinement is responsible for formal placement.

## Related mandatory constraints

- Respect Product/Epic dependency order unless an explicit dependency reason or Owner decision permits otherwise.
- Respect Human/AI authority boundaries; create a Human Request only when human authority or physical/account action is genuinely required.
- For external retrieval, communication, secrets, or metered services, also execute `governance/research-security-policy.md`.
