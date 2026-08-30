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
5. **AI Work Session opened** — create a record in the `AI Work Sessions` database with `Status = Running`, `Task` set to this Task, `Agent`/`Model`/`Role` set to the acting AI, `Stage` set to the current lifecycle stage, `Started At` in JST, and a one-line `Input Summary`. See "AI Work Session recording" below for the full field mapping. Skip only when `AI Work Sessions` itself is unreachable (see that section's degradation rule) — never skip merely because this feels like overhead.
6. **Authority checked** — confirm the acting AI has authority for the intended action. Human-only/account/physical/irreversible actions must be transferred instead of performed by an unauthorized AI.

If any required check fails, do not start the substantive work. Repair the tracking/state problem first or record a Blocker and stop that task.

A chat instruction, branch, commit, draft artifact, or external action performed before this gate does not count as compliant merely because Notion is corrected afterward.

## AI-to-AI stop gate pre-flight

Trigger: immediately before an AI performs any action that would cause another AI or an autonomous workflow to stop, wait, lose previously granted execution authority, or require a new approval. This gate applies to ChatGPT/Chris, Claude, and any other acting AI equally.

The trigger includes, at minimum:

- setting a task or workflow to `Blocked` because another AI must wait;
- adding a new Human/Chris/AI approval or re-review requirement that was not already an authoritative gate;
- instructing another AI to stop at a PR, review, task, or handoff boundary;
- changing merge responsibility, including adding or removing self-merge permission;
- withholding an otherwise-Ready downstream handoff because of a newly inferred governance condition.

Before issuing the stop/wait condition, the acting AI MUST complete all of the following:

1. **Name the proposed stop** — state exactly what actor or workflow would stop, what action would be withheld, and which authority supposedly requires the stop. A vague sense that “review is safer” or “approval is probably needed” is not authority.
2. **Check authority and source-of-truth evidence** — inspect every relevant source that is accessible before changing execution authority:
   - the Owner's latest explicit instruction for the exact issue, repository, workflow, or responsibility;
   - the target repository's local governance (`CLAUDE.md`, `AGENTS.md`, repository-specific operating notes or equivalent);
   - ADP durable governance (`docs/operating-guide.md`, this file, and other applicable governance artifacts);
   - the latest applicable accepted Brain Decision/organizational memory;
   - the current Notion Task's `Approach Decision`, `Refinement Decision`, Acceptance Criteria, and Blocker.
   If a relevant source is temporarily unavailable, record that fact. Missing evidence prevents inventing, expanding, or revoking authority, but it does **not** suspend an already-authoritative applicable gate established by an accessible higher/equal-priority source.
3. **Apply precedence without inventing authority** — the latest explicit Owner instruction for the matter takes precedence over older AI-authored artifacts. A repository-specific rule takes precedence over a conflicting generic rule for that repository unless the Owner has explicitly changed it. A Task or Decision written by an AI does not, by itself, create new authority to remove another agent's existing execution permission.
4. **Treat conflict as a governance defect, not as an automatic stop condition** — if sources conflict, do not make the workflow safer by silently adding a stricter approval gate. If the Owner's current instruction resolves the conflict, follow it and correct the stale source. If the conflict remains unresolved, continue reversible work whose authority is clear and pause only the specific irreversible/high-impact action whose authority cannot be established. Record the conflict for correction; do not freeze the whole chain by default. An inaccessible source is not itself a conflicting source and does not invalidate an existing authoritative gate.
5. **Preserve existing authorised flow and existing authoritative gates until a change is evidenced** — an AI may not revoke self-merge, downstream handoff, autonomous execution, or another granted responsibility merely because it interprets a generic rule differently. Equally, an AI may not remove an existing required review, validation, merge-responsibility, or safety gate merely because another relevant source cannot be retrieved. Authority changes require explicit evidence from the sources above.
6. **Record the pre-check when a stop is actually created** — write the checked sources, any unavailable source, the controlling rule, and the reason the stop is unavoidable into `Result`, `Approach Decision`, the PR discussion, or another durable execution record. A newly invented stop with no cited authority is invalid; an already-authoritative applicable gate remains valid even when a supplemental source is unavailable.

### Representative regression case: `experimental` PR #89

Given the 2026-08-26 OEK-DEMO-RUN case, the pre-flight must resolve the governance as follows:

- current explicit Owner instruction: `cloud42-labo/experimental` is an experimental/PoC exception where the working agent may self-merge;
- repository-local policy: `experimental/CLAUDE.md` permits self-merge only after all applicable required gates pass, including required fixes, Codex review where required, CI, mergeability, and real-device validation where required;
- result: ChatGPT/Chris MUST NOT add “Chris re-review/re-judgment required before merge” as a new gate, and MUST NOT tell Claude to stop solely for that approval;
- existing repository-required review/validation gates MUST remain in force; the self-merge exception changes merge responsibility, not those prerequisites;
- if a stale Brain/Notion/common rule says otherwise, correct that stale record without blocking reversible OEK work.

If a false AI-to-AI stop gate is later discovered to have stalled execution, execute `governance/postmortem-improvement-loop.md` and add/maintain the representative regression test before closing the preventive task.

## Human gate pre-flight

Trigger: immediately before creating a Stories & Tasks record with `Type = Human Request`, and immediately before setting any task to `Blocked` for a reason that is Human action or Human confirmation. The gate must pass before that write, not after it. Policy detail and classification guidance are in Operating Guide section 11.

1. **Evidence searched** — Notion (existing Tasks, `Result` values, Decisions, daily reports, feedback records), GitHub (PRs, reviews, commits, merge commits), CI/test results, and already-collected user feedback have been searched for the specific evidence each criterion needs. One connector or search returning nothing is **not** evidence that a Human is required; try another tool path, another agent's connector, or the underlying API before concluding otherwise.
2. **Criteria classified individually** — every Acceptance Criterion is classified as `AI-verifiable`, `Human evidence already exists`, or `Human-only`. The task as a whole is not classified.
3. **AI-verifiable work completed first** — every `AI-verifiable` criterion is actually verified and its evidence recorded before any Human is asked for anything.
4. **No Human-only criterion remains** — if every criterion is `AI-verifiable` or `Human evidence already exists`, do not create the Human Request and do not transition to `Blocked`. Record the evidence and complete the task through the completion post-flight.
5. **Request minimised** — where `Human-only` criteria remain, the Human Request covers only that remainder, stated as a concrete action with explicit completion evidence. A Blocker must name the specific outstanding criterion and the request carrying it, not the whole task.
6. **Classification recorded** — the classification and the sources searched are written to `Result` or `Approach Decision`, so the next agent can re-evaluate the gate instead of repeating the search or inheriting a dead end.

## Human Queue WIP constraint

The Actionable Human Queue is every task with `Assigned Agent = Human` and `Status` in `Ready`, `In Progress`, or `Review` (Notion Stories & Tasks view `Human Queue｜Actionable`). Initial WIP limit: **5**, `P0` exempt. Policy detail is in Operating Guide section 11.7.

Before creating a new Human Request or moving a non-urgent Human item into the Actionable Queue, check the current Actionable count:

1. **Under the limit** — proceed normally through the Human gate pre-flight above.
2. **At or over the limit and the new item is not P0** — do not add it to the Actionable Queue. First: re-run the Human gate pre-flight over existing queued items (evidence may have arrived since they were gated), split out any AI-doable preparation from bundled Human-only items and complete that preparation now, and consolidate/close duplicates. Only after that, place the new item in `Backlog` with a Blocker naming the WIP limit.
3. **At or over the limit and the new item is P0** — it still enters the Actionable Queue; the exemption does not require the same triage, but still record the resulting queue size.

During each daily/hourly autonomous execution, prefer AI work that shrinks the Actionable Queue (substitution, consolidation, pre-processing of existing Human tasks) over starting new work that would add to it, whenever the queue is at or over its limit.

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
5. **AI Work Session closed** — update this Task's `Running` `AI Work Sessions` record (opened in the execution pre-flight) with `Completed At` in JST, `Status` set to `Success` / `Failed` / `Needs Human` as applicable, an `Output Summary`, and `Pull Request` / `Git Commit` where applicable. If work is routed to a Human or another agent instead of completing, also set `Next Agent` and `Human Help Reason`. See "AI Work Session recording" below.
6. **Status transition last** — set `Status = Done` only after the evidence and time records needed to support Done are present.
7. **Residual work routed** — if Human/another agent action remains necessary to satisfy the task's own acceptance criteria, do not mark the task Done; create/route the explicit follow-up and use the correct waiting/blocked state. Before routing anything to a Human or moving to `Blocked` for a Human reason, execute the Human gate pre-flight above and route only the genuinely Human-only remainder.

### AI Work Session recording

`AI Work Sessions` (separate from `Time Events`) is the per-execution audit/outcome log: who ran, on what Task, with what result — as opposed to `Time Events`, which is pure elapsed-time measurement. Opening one is step 5 of the execution pre-flight above; closing it is step 5 of the completion post-flight above. Concretely:

- **At start**: create a row with `Session` (a short human-readable label, e.g. `<Task title>｜<JST timestamp>`), `Task` (relation to the Stories & Tasks record), `Agent` (`Claude` / `ChatGPT` / `ChatGPT Codex` / `Gemini` / `Gemini CLI` / `Google AI Studio`), `Model` (`Opus` / `Sonnet` / `Haiku` / `Gemini` / `Codex` / `N/A`), `Role` (the closest of `Ideation` / `UI Validation` / `PM` / `Organizer` / `Design` / `Research` / `Coding` / `Quality` / `Final Review` / `PR Review` / `Merge`), `Stage` (`Plan` / `Design` / `Build` / `Test` / `Review` / `Merge`), `Status = Running`, `Started At` (JST), `Product` (relation), and a one-line `Input Summary`.
- **At end**: set `Completed At` (JST) and `Status` to `Success` (task advanced or completed as intended), `Failed` (the attempt did not produce the intended result and was not routed onward), or `Needs Human` (routed to a Human as this task's residual). Fill `Output Summary`, and `Pull Request` / `Git Commit` when the session produced one. When routing onward, also set `Next Agent` and `Human Help Reason`.
- **Multiple tasks in one autonomous run** (the normal case for Claude/Chris daily execution): open and close a separate `AI Work Sessions` row per Task, in the same start/end place as that Task's own `Status`/`Started At`/`Completed At` — do not batch multiple Tasks under one Session row, and do not open a Session for the run as a whole.
- **Degradation**: if the `AI Work Sessions` database itself is unreachable (not merely a single failed call — retry once), proceed with the Task's own Time Event/Status/Result recording as normal and note the `AI Work Sessions` gap in that Task's `Result`. Do not block substantive work on this database alone, and do not build a replacement recording mechanism.
- Views `⚠ Session Missing Started At` and `⚠ Success Missing Completed At` on the `AI Work Sessions` database exist to catch a session opened or closed out of compliance with this section; an agent that finds itself listed there has skipped a step above and should correct the record.

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

Any AI workflow or Skill that creates a Stories & Tasks record MUST execute the placement pre-flight check first. Any AI workflow that performs managed work MUST execute the managed-work execution pre-flight and completion post-flight. Any AI workflow that would stop, block, de-authorize, add approval/re-review waiting, alter merge responsibility, or withhold an otherwise-Ready handoff from another AI MUST execute the AI-to-AI stop gate pre-flight first.

A prompt such as “this looks like ADP/AOD/etc.” is not placement evidence. Only explicit Owner placement or explicit derivation from an already placed Task/Story is sufficient.

If placement evidence is ambiguous, default to MISC / Backlog. Weekly Backlog Refinement is responsible for formal placement.

## Related mandatory constraints

- Respect Product/Epic dependency order unless an explicit dependency reason or Owner decision permits otherwise.
- Respect Human/AI authority boundaries; create a Human Request only when human authority or physical/account action is genuinely required, and only after the Human gate pre-flight above has passed.
- Do not create a new AI-to-AI stop/wait gate from memory, generic caution, or a conflicting AI-authored artifact; execute the AI-to-AI stop gate pre-flight and preserve clearly authorised reversible work while conflicts are corrected. Missing supplemental evidence does not cancel an already-authoritative applicable gate.
- For external retrieval, communication, secrets, or metered services, also execute `governance/research-security-policy.md`.
