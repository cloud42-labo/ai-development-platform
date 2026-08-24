# Postmortem Improvement Loop

This document defines the durable control loop for AI operating-rule violations. Notion Postmortems is the operational system of record; this file defines the reusable process and closure gates.

## When to create a Postmortem

Create or update a Postmortem when a managed AI workflow materially violates an already-active operating rule, authority boundary, execution gate, source-of-truth rule, or required evidence/time-control rule.

Do not classify a legitimate exception or required Human escalation as a violation. If the rule did not exist at the time of the event, record the learning elsewhere rather than retroactively declaring non-compliance.

A recurrence of the same rule failure MUST be linked to the earlier case and marked as recurrence instead of being treated as an unrelated incident.

## Required loop

A rule violation is not closed by documenting it. Follow this loop:

1. **Record** — capture expected behavior, actual behavior, impact, detection path, and the rule that existed at event time.
2. **Analyze** — identify the direct and structural cause. Prefer causes that explain why the gate failed, not labels about the actor.
3. **Correct** — repair current task/evidence/state without erasing the fact that the violation occurred.
4. **Create preventive work** — create an explicit preventive Task. New affiliation follows the normal placement pre-flight; if placement is not evidenced, use MISC / Backlog.
5. **Make the control executable** — update the appropriate Operating Guide, `AGENTS.md`, Skill, workflow, automated check, or pre/post-flight gate. Documentation-only action is insufficient when the cause was a missed execution-time check.
6. **Retest** — run a representative managed-work scenario after the preventive control is implemented and preserve evidence that the new gate was applied before the risky action.
7. **Close** — close the Postmortem only after preventive work is Done and the retest passes.

## Control destination by cause

- **Rule not read / precondition skipped** → execution pre-flight, AGENTS/Skill entry point, or automated gate.
- **Ambiguous rule** → Operating Guide/policy wording plus testable acceptance criteria.
- **Authority error** → Human/AI authority gate and explicit transfer path.
- **False Human gate** (work stalled on a Human Request or Human-reason `Blocked` whose criteria were already satisfiable from existing evidence) → Human gate pre-flight and its standing re-evaluation.
- **Source-of-truth / traceability gap** → required Notion/GitHub relation/evidence before transition.
- **Time/evidence recording gap** → managed-work completion post-flight.
- **External data / secret / billing risk** → `governance/research-security-policy.md`.
- **Repeated failure after documentation** → raise control strength from reference text to forced pre-flight/automation and mark recurrence.

## High-risk period

From incident detection until the preventive Task is implemented and retested, treat the failed control as high risk. The acting AI MUST perform an explicit manual check of that rule at each relevant execution point. A future automated gate may replace the manual check only after the automated behavior is verified.

## Closure criteria

A Postmortem can be closed only when all are true:

- root cause and existing rule are recorded;
- preventive Task is linked and Done;
- the durable control destination is updated;
- a representative retest passed;
- evidence of the retest is recorded;
- recurrence status is correct;
- no unresolved corrective action remains.

If the same rule fails again before these criteria are met, the earlier Postmortem remains an active risk and the new event is a recurrence signal, not evidence that the process has completed.

## Metrics

Portfolio-level governance should periodically review at least:

- violation count;
- recurrence rate by rule family;
- time from detection to preventive-action Done;
- Human vs AI-self vs other-AI vs automated detection path;
- proportion of preventive actions implemented as executable gates rather than reference documentation only.

The objective is not to hide or minimize incident counts. It is to reduce recurrence and move detection/prevention earlier in the execution flow.

## Related controls

- `governance/ai-execution-constraints.md` — task placement and managed-work pre/post-flight gates.
- `governance/research-security-policy.md` — external data, secrets, billing, and communication gates.
