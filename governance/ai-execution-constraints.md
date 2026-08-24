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

## Human gate pre-flight

Trigger: immediately before creating a Stories & Tasks record with `Type = Human Request`, and immediately before setting any task to `Blocked` for a reason that is Human action or Human confirmation. The gate must pass before that write, not after it. Policy detail and classification guidance are in Operating Guide section 11.

1. **Evidence searched** — Notion (existing Tasks, `Result` values, Decisions, daily reports, feedback records), GitHub (PRs, reviews, commits, merge commits), CI/test results, and already-collected user feedback have been searched for the specific evidence each criterion needs. One connector or search returning nothing is **not** evidence that a Human is required; try another tool path, another agent's connector, or the underlying API before concluding otherwise.
2. **Criteria classified individually** — every Acceptance Criterion is classified as `AI-verifiable`, `Human evidence already exists`, or `Human-only`. The task as a whole is not classified.
3. **AI-verifiable work completed first** — every `AI-verifiable` criterion is actually verified and its evidence recorded before any Human is asked for anything.
4. **No Human-only criterion remains** — if every criterion is `AI-verifiable` or `Human evidence already exists`, do not create the Human Request and do not transition to `Blocked`. Record the evidence and complete the task through the completion post-flight.
5. **Request minimised** — where `Human-only` criteria remain, the Human Request covers only that remainder, stated as a concrete action with explicit completion evidence. A Blocker must name the specific outstanding criterion and the request carrying it, not the whole task.
6. **Classification recorded** — the classification and the sources searched are written to `Result` or `Approach Decision`, so the next agent can re-evaluate the gate instead of repeating the search or inheriting a dead end.

## Standing re-evaluation of Human gates

During each daily autonomous execution, re-run the Human gate pre-flight over every open `Type = Human Request` and every task whose `Status = Blocked` for a Human reason.

- Correct any gate whose evidence has since arrived: verify the satisfied criteria, write the correcting reason and evidence links into `Result`, and move the task out of the gate.
- Clear stale Blockers on parent Stories/Tasks whose blocking child has already completed. Write Blockers that name the specific task or request they wait on, so this check costs one lookup.
- Where the Human portion is satisfied but AI work remains, return the task to `Ready` with the residual named. Do not mark it `Done`, and do not leave it `Blocked`.
- Correct only what located evidence supports. Where evidence cannot be found, leave the state unchanged and record why the gate remains open.
- Do not build a new service, scheduled job, or classification engine for this. The acting agent runs the check with the connections it already has.
- Where a Human gate stalled work whose criteria were already satisfied, execute `governance/postmortem-improvement-loop.md`.

## Managed-work completion post-flight

Before setting a managed task to `Done`, the acting AI MUST verify **all** of the following, in this order:

1. **Acceptance criteria verified** — directly check the required artifact/result, not only the implementer's completion claim.
2. **Evidence recorded** — update `Result` with the material outcome, decisions, relevant URLs/commit/PR identifiers, and any remaining limitations.
3. **Time interval closed** — verify that a Task Time Event exists for the actor/current active interval and set its `Ended At` in JST. Active Time is derived from the event; do not invent an `Actual Time` value independently when the rollup is authoritative. **A task with no applicable Time Event, or with an open Time Event, MUST NOT be marked Done.**
4. **Completion timestamp recorded** — set `Completed At` in JST after the time record is complete.
5. **Status transition last** — set `Status = Done` only after the evidence and time records needed to support Done are present.
6. **Residual work routed** — if Human/another agent action remains necessary to satisfy the task's own acceptance criteria, do not mark the task Done; create/route the explicit follow-up and use the correct waiting/blocked state. Before routing anything to a Human or moving to `Blocked` for a Human reason, execute the Human gate pre-flight above and route only the genuinely Human-only remainder.

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
- Respect Human/AI authority boundaries; create a Human Request only when human authority or physical/account action is genuinely required, and only after the Human gate pre-flight above has passed.
- For external retrieval, communication, secrets, or metered services, also execute `governance/research-security-policy.md`.
