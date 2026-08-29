# Postmortem Improvement Loop

This document defines the durable control loop for AI operating-rule violations. Notion Postmortems is the operational system of record; this file defines the reusable process and closure gates.

## When to create a Postmortem

Create or update a Postmortem when a managed AI workflow materially violates an already-active operating rule, authority boundary, execution gate, source-of-truth rule, or required evidence/time-control rule.

Do not classify a legitimate exception or required Human escalation as a violation. If the rule did not exist at the time of the event, record the learning elsewhere rather than retroactively declaring non-compliance.

A recurrence of the same rule failure MUST be linked to the earlier case and marked as recurrence instead of being treated as an unrelated incident.

## Independent review (author ≠ reviewer)

A Postmortem's first analysis is written by the AI closest to the incident, which is also the AI most exposed to the incident's own framing and self-justification. Treat that first analysis as a draft, not as ground truth, until a different AI has independently re-checked it.

- **Author ≠ reviewer is mandatory.** The AI (or Human) who wrote the first analysis of a Postmortem MUST NOT also be its reviewer.
- **An AI-caused Postmortem MUST NOT move to `Closed` before a different AI has completed its review.** This applies in addition to, not instead of, the other closure criteria below.
- **Basic review pairing:**
  - Chris/ChatGPT-caused incident → Claude reviews.
  - Claude-caused incident → Chris/ChatGPT reviews.
  - A technical code/PR incident MAY add a Codex review as a third-party technical check, on top of the AI pairing above.
- **Human review is scoped to Human-only judgment.** Route a Postmortem to a Human reviewer only when the review question is itself Human-only (legal exposure, cost/billing decisions, authority the AI does not hold) — not as a general substitute for the AI pairing above.
- **Minimum review criteria.** The reviewer MUST check, at minimum:
  1. **Facts** — do the described event and evidence match what actually happened (commits, PRs, Task/Time records, logs)?
  2. **Cause-and-effect** — does the causal chain from trigger to impact actually hold, or does it skip steps / assume a link that isn't shown?
  3. **Root Cause classification** — is the Root Cause Category correct, or does the author's framing (e.g. blaming an actor instead of a missing gate) misclassify it?
  4. **Preventive Action fit** — does the Preventive Action actually address the recorded root cause, or does it treat a symptom / a different cause?
  5. **No new false gate** — does the Preventive Action introduce a new Human/Stop Gate that isn't actually required, echoing the false-gate failure mode this loop exists to reduce?
- **Record the review**, not just its outcome: which criteria were checked, what (if anything) the reviewer changed, and the reviewer's identity. This is tracked on the Postmortem record (`Reviewer`, `Review Status`, `Review Notes`) alongside the existing fields.

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
- no unresolved corrective action remains;
- **an AI-caused Postmortem has completed independent review by a different AI** (see "Independent review" above), with `Reviewer` ≠ `Owner` and `Review Status = Approved`.

A `Review Status` of `Revise Requested` blocks `Closed` until the author addresses the reviewer's findings and the reviewer re-approves. The reviewer re-approving is not optional busywork: if the reviewer finds the causal chain, Root Cause classification, or Preventive Action fit does not hold up, that finding overrides the author's own closure request.

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
