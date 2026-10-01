# Monthly Risk Management Review

This review is the monthly portfolio-level governance loop for AI operating risk across Cloud42-labo / Vibe Product Development. It complements event-driven Postmortems: Postmortems investigate individual violations, while this review identifies patterns, aging risk, recurrence, and controls that need stronger treatment.

## Purpose

Once per month, decide which AI operating risks require stronger controls, Owner decisions, preventive work, or closure. The review MUST result in explicit decisions and tracked actions rather than a narrative-only report.

## Cadence and cutoff

- **25th JST — MTD Risk Management Review:** review the current month through the latest evidence on the 25th. Identify recurrence, weak controls, Postmortem RCA-quality problems, KMI deterioration, and corrective work that should still be acted on within the month. Open material risks from earlier periods remain in scope until closed.
- **1st JST — Previous-month Final Review:** finalize the complete previous calendar month (cutoff 23:59 JST on its final day), including KPI/KMI and risk results, and connect findings through Management Point → KPI → KMI → structural problem → countermeasure → Backlog/Sprint/source-of-truth update.
- The 1st Final Review consumes the 25th Risk Review decisions plus evidence from the remaining days; it does not repeat the investigation from scratch.
- No exact clock time is defined here. The active scheduler/Automation is the timing source of truth; Notion Job Schedule is its synchronized human-readable view.
- Material incidents remain eligible for immediate event-driven escalation and Postmortem handling; neither checkpoint delays action until the calendar date.

## Roles

- **Owner / Human** — owns business-risk acceptance, paid/irreversible authority decisions, and final escalation where AI cannot resolve competing priorities.
- **Chris (ChatGPT)** — prepares the portfolio risk view, identifies patterns/recurrence, proposes prioritization, records decisions, and creates/routs follow-up tasks within authority.
- **Claude** — supplies implementation/technical evidence and status of controls owned by Claude tasks; does not self-approve a control whose independence requirement calls for another reviewer/Human.
- **Other AI / Codex / Gemini** — provide evidence or specialist review where a task already assigns that responsibility; they are not mandatory attendees by default.

## Required inputs

Read the operational systems of record, not copied snapshots:

1. Notion Postmortems: all `Open` / `Actioning`, plus anything closed during the review period.
2. Preventive Tasks linked from Postmortems, including status, age, blockers, and retest evidence.
3. Rule-compliance baseline/measurements (for example compliance rate, recurrence rate, detection path, Human intervention rate, Unknown rate when available).
4. Postmortem analysis-quality fields/evidence: RCA Quality, Root Cause Confidence, Failure Layer, Preventive Action Effectiveness, Reanalysis Changed Conclusion, and Regression Replay evidence when available.
5. Stories & Tasks with material Blockers, repeated reopening, overdue Human Requests, or governance/security-related risk.
6. Relevant Decisions and Operating Guide / governance-control changes made in the month.
7. GitHub evidence for automated gates, PR controls, CI failures, security/governance changes, and unresolved review findings where material.

## Review sequence

### 1. Open-risk inventory

For every Open/Actioning Postmortem and material preventive task, answer:
- What rule/control failed?
- Is the root cause known?
- Is the preventive control implemented?
- Has a representative retest passed?
- Has the same or similar failure recurred?
- Who is currently detecting the failure: Human, AI self, another AI, or automation?

### 2. Postmortem analysis-quality review

Before using a Postmortem's Root Cause or Preventive Action as portfolio evidence, evaluate the Postmortem itself as a control artifact.

For each Postmortem opened, actioned, reanalyzed, or closed during the period, check:
- `RCA Quality`: Pass / Revise / Not Evaluated;
- `Root Cause Confidence`: High / Medium / Low;
- Failure Layer is concrete enough to explain the mechanism rather than only a generic category;
- alternative hypotheses were considered;
- every preventive action names the causal node it targets;
- counterfactual result is not `No effect`;
- Regression Replay exercises the original failure mode, or replay impossibility and substitute evidence are approved;
- independent review changed the cause or action (`Reanalysis Changed Conclusion`);
- Preventive Action Effectiveness: Effective / Partial / Ineffective / Not Tested.

Treat the following as material control-quality signals:
- Low-confidence analysis already moved to Actioning;
- RCA Quality=Revise aging without Investigate work;
- repeated reviewer changes to the stated root cause or preventive action;
- an action classified Effective followed by recurrence at the same causal node;
- recurrence after documentation-only remediation;
- a Postmortem whose coarse Root Cause Category hides distinct failure mechanisms needed for portfolio learning.

If the analysis itself is not reliable, do not aggregate its conclusion as if it were established fact. Return it to `Open` / reanalysis using the `postmortem-rca` Skill.

### 3. Recurrence and common-mode review

Group incidents by **rule family / control failure**, not only by ticket title. Treat the following as escalation signals:
- same rule family fails again after documentation or preventive action;
- multiple products fail at the same authority, traceability, state-transition, secret/billing, or time/evidence gate;
- controls exist only as reference text and continue to be skipped;
- Human detection remains the only effective detection path for a material risk.

### 4. Severity and priority review

Reassess priority when any of the following changes:
- impact becomes external, financial, security/privacy-related, irreversible, or reputation-sensitive;
- recurrence shows the original mitigation is weak;
- preventive work is aging or blocked;
- the failed control is common to several products/agents;
- automation can materially reduce Human monitoring load.

Use the existing task/Postmortem severity model where available; do not create a competing scoring system merely for this review.

### 5. Decision per risk

Every material risk must end in one of these decisions:
- **Accept / monitor** — current residual risk is acceptable; define the next observation signal.
- **Strengthen control** — create or reprioritize preventive work, moving from documentation to executable gate/automation where appropriate.
- **Escalate to Owner/Human** — business-risk acceptance, authority, cost, legal/privacy/security, or irreversible decision is required.
- **Close** — only when the Postmortem closure criteria are satisfied, including preventive task completion and representative retest.

## Mandatory escalation to Owner/Human

Escalate rather than autonomously accepting when the risk includes any of the following:

- potential secret/credential exposure or material privacy/confidential-data transfer;
- unapproved or uncertain metered spending, payment, contract, or financial commitment;
- external publication/reputation risk requiring final Human authority;
- irreversible/destructive production or infrastructure change outside delegated authority;
- contradictory business requirements with no authoritative resolution;
- repeated material violation after an executable control has already been implemented and tested;
- a decision to accept a material residual risk rather than remediate it.

## Outputs

The review produces:

1. **Monthly Risk Review record in Notion** — period, participants/actors, inputs checked, key metrics, material risks, decisions, and next-review focus.
2. **Updated Postmortems** — status/recurrence/closure evidence corrected where necessary.
3. **Preventive Tasks** — new or reprioritized work, following normal placement pre-flight. New affiliation without evidence goes to MISC / Backlog.
4. **Control changes** — Operating Guide, AGENTS, Skill, automated gate, or governance artifact updates when a decision requires them.
5. **Owner/Human Requests** — only for decisions/actions that genuinely cross the Human authority boundary.

## Monthly metrics

At minimum record:
- Open/Actioning Postmortem count at cutoff and after review;
- violations during the period;
- recurrence count/rate by rule family and Failure Layer;
- RCA Quality Gate: Pass / Revise / Not Evaluated;
- Root Cause Confidence: High / Medium / Low;
- Preventive Action Effectiveness: Effective / Partial / Ineffective / Not Tested;
- Reanalysis Changed Conclusion count;
- Regression Replay missing / failed count;
- preventive tasks Open / Done / Blocked;
- median/typical age of unresolved preventive work when measurable;
- detection-path distribution: Human / AI self / other AI / automated;
- documentation-only remediation count and subsequent recurrence;
- material risks escalated to Owner/Human;
- controls upgraded from documentation-only to executable gate/automation.

Metrics are diagnostic. Do not optimize them by suppressing incident reporting or closing items without evidence.

## Initial review procedure

For the first review:

1. Use PM-1 (new Task assigned directly instead of MISC/Backlog), the later recurrence PM-3, and the managed-work/task-time violation as seed cases.
2. Verify their preventive tasks and implemented controls: placement pre-flight, managed-work Pre/Post-flight, and Postmortem Improvement Loop.
3. Re-analyze at least PM-8, PM-11, and PM-12 with the current `postmortem-rca` procedure as calibration cases; record whether the Root Cause, Failure Layer, or Preventive Action changes.
4. Recheck whether Regression Replay / approved alternative tests have passed and whether the Postmortem closure criteria are actually satisfied.
5. Include the AOD rule-compliance baseline as the initial control-effectiveness signal.
6. Record gaps in detection-path automation as a portfolio risk if Human remains the dominant detector.
7. Create only evidence-backed follow-up work; do not invent remediation to make the review appear complete.

## Operating Guide integration

The Operating Guide should point to this durable policy for the detailed monthly procedure and state the mandatory cadence, inputs, decision outcomes, Human escalation boundary, and Notion record requirement. Operational dates/status remain in Notion; this GitHub document is the durable process definition.

## Related controls

- `governance/postmortem-improvement-loop.md`
- `cloud42-labo/skills/.claude/skills/postmortem-rca/SKILL.md`
- `governance/ai-execution-constraints.md`
- `governance/research-security-policy.md`
