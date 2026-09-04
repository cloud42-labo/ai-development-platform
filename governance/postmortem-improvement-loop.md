# Postmortem Improvement Loop

This document defines the durable control loop for AI operating-rule violations. Notion Postmortems is the operational system of record; this file defines the reusable process and closure gates.

The analysis structure below is adapted from Google SRE's blameless postmortem practice and template. Cloud42 adds AI-native governance fields and review gates on top of that structure rather than replacing it.

References:
- https://sre.google/workbook/postmortem-culture/
- https://sre.google/sre-book/postmortem-culture/

## When to create a Postmortem

Create or update a Postmortem when a managed AI workflow materially violates an already-active operating rule, authority boundary, execution gate, source-of-truth rule, or required evidence/time-control rule.

Do not classify a legitimate exception or required Human escalation as a violation. If the rule did not exist at the time of the event, record the learning elsewhere rather than retroactively declaring non-compliance.

A recurrence of the same rule failure MUST be linked to the earlier case and marked as recurrence instead of being treated as an unrelated incident.

## Standard Postmortem format

Use the following section order for every new Postmortem. The goal is a factual, blameless, auditable analysis that can be understood by someone who was not involved in the incident.

### 1. Executive Summary

State, in a short paragraph:
- what happened;
- the affected workflow, product, or control;
- the material impact;
- the current resolution state.

Do not lead with blame, personal judgment, or an action item. Describe the incident first.

### 2. Impact

Describe the observable consequence of the incident. Quantify it where evidence exists.

Examples include:
- unnecessary waiting or blocked time;
- incorrect merge/publication/deployment state;
- owner intervention required;
- rework or review-loop cost;
- production/user impact;
- security, billing, or authority exposure.

Separate actual impact from hypothetical risk.

### 3. Timeline

Record the smallest useful sequence of timestamped events from trigger through detection, mitigation, and recovery.

Each entry should identify:
- time or ordered sequence;
- observed event or decision;
- evidence source when relevant (PR, commit, Task, log, review, or message).

The timeline is evidence, not interpretation. Root-cause reasoning belongs later.

### 4. Detection

Record:
- how the incident was detected;
- who or what detected it (Human, AI-self, other AI, automated control);
- why the existing control did not detect or prevent it earlier;
- whether an earlier detection point is realistically available.

### 5. Root Cause and Trigger

Distinguish the **trigger** from the **root cause**.

- **Trigger**: the event that exposed or activated the failure mode.
- **Root Cause**: the structural condition that allowed the failure to occur or recur.
- **Contributing Factors**: conditions that increased likelihood, duration, or impact without being sufficient causes by themselves.

Prefer system/control explanations over actor labels. For example, use "the state-transition pre-check did not distinguish merge acceptance from downstream deployment acceptance" rather than "the reviewer was careless."

The Notion `Root Cause Category` property remains the normalized category used for trend analysis.

### 6. Lessons Learned

#### What went well

Record controls, behaviors, evidence, or recovery mechanisms that reduced impact or accelerated diagnosis.

#### What went poorly

Record system and process weaknesses that permitted the incident or made recovery harder. Keep this blameless and evidence-based.

#### Where we got lucky

Record favorable conditions that limited impact but should not be relied upon as controls. If there was no meaningful luck factor, explicitly say so rather than inventing one.

### 7. Corrective Actions

Record immediate corrections already taken to restore the current workflow to a valid state. Corrective actions repair the present incident; they are distinct from preventive work.

Do not erase or rewrite evidence of the original incident while correcting state.

### 8. Action Items / Preventive Work

Every material Postmortem must produce at least one concrete preventive action unless the independent reviewer explicitly documents why no preventive action is warranted.

For each action item record:
- objective;
- type: Prevent / Mitigate / Detect / Investigate;
- owner or assigned agent;
- linked Notion Task;
- verifiable completion condition;
- durable control destination (`Operating Guide`, `AGENTS.md`, Skill, workflow, automated check, etc.).

Action items should improve the system, not instruct an individual to "be more careful."

When the root cause is a missed execution-time control, documentation-only action is insufficient unless the review explains why an executable control is impossible or disproportionate.

### 9. AI-native Gate Boundary Review

For managed AI workflows, explicitly answer all of the following:

1. **Expected state transition** — what transition was being evaluated (for example PR review → merge, merge → deploy, draft → publish)?
2. **Actual stop condition** — what condition actually stopped or altered that transition?
3. **Human work exists?** — is there any Human-only work somewhere in the end-to-end workflow?
4. **Current-gate relevance** — if Human work exists, is that Human judgment/evidence a mandatory prerequisite for the **current** state transition, or is it a downstream acceptance/deployment/publication activity?
5. **False-gate check** — did the workflow convert a downstream Human activity, optional validation, or already-satisfied evidence check into a new Human/Stop Gate?
6. **Recurrence check** — is this failure materially the same control failure as an earlier Postmortem?

A Human-only task elsewhere in the workflow MUST NOT be treated as a blocker for the current transition unless a governing rule or risk boundary makes it a prerequisite for that exact transition.

### 10. Evidence

Link the primary evidence used by the analysis: PRs, commits, CI runs, Notion Tasks, logs, decisions, or other durable records.

Evidence should make the factual chain independently reproducible. Do not use the Postmortem's own conclusion as evidence for itself.

### 11. Independent Review

Record the independent review result and any changes to the first analysis. The review requirements below remain mandatory and are part of the Postmortem, not a separate optional exercise.

## Writing principles

- **Blameless** — explain how the system allowed the outcome, not who deserves blame.
- **Factual** — prefer verifiable observations, timestamps, and numbers over dramatic or subjective language.
- **Context-complete** — write for readers outside the immediate incident context; explain local terminology where necessary.
- **Separate fact from interpretation** — Timeline and Impact state what happened; Root Cause explains why.
- **Separate corrective from preventive work** — restoring today's state is not the same as preventing recurrence.
- **Measurable actions** — every preventive action needs a verifiable end state.
- **No invented completeness** — if evidence is unavailable, say so explicitly.

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
  6. **Format completeness** — are Impact, Timeline, Detection, Root Cause/Trigger, Lessons Learned, Gate Boundary Review, Evidence, and Action Items complete enough to support the conclusion?
- **Record the review**, not just its outcome: which criteria were checked, what (if anything) the reviewer changed, and the reviewer's identity. This is tracked on the Postmortem record (`Author`, `Reviewer`, `Review Status`, `Review Notes`) alongside the existing fields. `Author` is who wrote the first analysis — set it explicitly rather than assuming it equals `Owner` (`Owner` is who is accountable for the incident/Postmortem, which is not always the same actor who drafted the analysis; comparing `Reviewer` against `Owner` instead of `Author` would let the actual drafter review their own text merely because someone else was recorded as `Owner`).

## Required loop

A rule violation is not closed by documenting it. Follow this loop:

1. **Record** — write the standard Postmortem sections and preserve primary evidence.
2. **Analyze** — identify trigger, direct cause, structural root cause, contributing factors, and the exact failed state-transition/gate boundary. Prefer causes that explain why the control failed, not labels about the actor.
3. **Correct** — repair current task/evidence/state without erasing the fact that the violation occurred.
4. **Create preventive work** — create an explicit preventive Task. New affiliation follows the normal placement pre-flight; if placement is not evidenced, use MISC / Backlog.
5. **Make the control executable** — update the appropriate Operating Guide, `AGENTS.md`, Skill, workflow, automated check, or pre/post-flight gate. Documentation-only action is insufficient when the cause was a missed execution-time check.
6. **Retest** — run a representative managed-work scenario after the preventive control is implemented and preserve evidence that the new gate was applied before the risky action.
7. **Independent review** — a different AI reviews the facts, causal model, preventive-action fit, format completeness, and false-gate risk.
8. **Close** — close the Postmortem only after preventive work is Done, the retest passes, and independent review is Approved.

## Control destination by cause

- **Rule not read / precondition skipped** → execution pre-flight, AGENTS/Skill entry point, or automated gate.
- **Ambiguous rule** → Operating Guide/policy wording plus testable acceptance criteria.
- **Authority error** → Human/AI authority gate and explicit transfer path.
- **False Human gate: evidence already satisfiable** → Human gate pre-flight and its standing re-evaluation.
- **False Human gate: downstream work promoted to current blocker** → state-transition/gate-boundary pre-flight. Human-only downstream deployment, acceptance, publication, or environment setup does not block an earlier transition unless the governing rule explicitly couples them.
- **Source-of-truth / traceability gap** → required Notion/GitHub relation/evidence before transition.
- **Time/evidence recording gap** → managed-work completion post-flight.
- **External data / secret / billing risk** → `governance/research-security-policy.md`.
- **Repeated failure after documentation** → raise control strength from reference text to forced pre-flight/automation and mark recurrence.

## High-risk period

From incident detection until the preventive Task is implemented and retested, treat the failed control as high risk. The acting AI MUST perform an explicit manual check of that rule at each relevant execution point. A future automated gate may replace the manual check only after the automated behavior is verified.

## Closure criteria

A Postmortem can be closed only when all are true:

- the standard Postmortem sections are complete enough to reproduce the factual and causal chain;
- root cause, trigger, and existing rule are recorded;
- Impact, Timeline, Detection, Lessons Learned, Gate Boundary Review, and Evidence are recorded;
- preventive Task is linked and Done;
- each preventive action has a verifiable completion condition;
- the durable control destination is updated;
- a representative retest passed;
- evidence of the retest is recorded;
- recurrence status is correct;
- no unresolved corrective action remains;
- **an AI-caused Postmortem has completed independent review by a different AI** (see "Independent review" above), with `Reviewer` ≠ `Author` (the actor who wrote the first analysis — not necessarily `Owner`) and `Review Status = Approved`.

A `Review Status` of `Revise Requested` blocks `Closed` until the author addresses the reviewer's findings and the reviewer re-approves. The reviewer re-approving is not optional busywork: if the reviewer finds the causal chain, Root Cause classification, Preventive Action fit, Gate Boundary analysis, or factual completeness does not hold up, that finding overrides the author's own closure request.

If the same rule fails again before these criteria are met, the earlier Postmortem remains an active risk and the new event is a recurrence signal, not evidence that the process has completed.

## Metrics

Portfolio-level governance should periodically review at least:

- violation count;
- recurrence rate by rule family;
- time from trigger to detection where timestamps exist;
- time from detection to preventive-action Done;
- Human vs AI-self vs other-AI vs automated detection path;
- false-gate count by failure mode (already-satisfied evidence vs downstream-work promotion);
- proportion of preventive actions implemented as executable gates rather than reference documentation only.

The objective is not to hide or minimize incident counts. It is to reduce recurrence and move detection/prevention earlier in the execution flow.

## Related controls

- `governance/ai-execution-constraints.md` — task placement and managed-work pre/post-flight gates.
- `governance/research-security-policy.md` — external data, secrets, billing, and communication gates.
