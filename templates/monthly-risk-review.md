# Monthly Risk Management Review — YYYY-MM

- **Checkpoint:** 25th MTD Risk Review / 1st Previous-month Final Review
- **Review period (JST):** for 25th = current month-to-date; for 1st = complete previous calendar month
- **Review date/time (JST):**
- **Actors:** Owner / Chris / Claude / others as applicable

## Inputs checked

- [ ] Open / Actioning Postmortems
- [ ] Postmortems closed during period
- [ ] Linked preventive tasks and blockers
- [ ] Rule-compliance / recurrence / detection-path metrics
- [ ] Postmortem RCA Quality / Root Cause Confidence / Failure Layer / Effectiveness / Regression Replay evidence
- [ ] Material governance/security/authority Blockers and Human Requests
- [ ] Relevant Decisions / Operating Guide / governance changes
- [ ] Scheduler continuity evidence (expected windows / run events / enabled state / retries / stop authority / carryover)
- [ ] Material GitHub control evidence

## Portfolio metrics

- Open/Actioning Postmortems at cutoff:
- Open/Actioning Postmortems after review:
- Violations in period:
- Recurrence by rule family / Failure Layer:
- RCA Quality — Pass / Revise / Not Evaluated:
- Root Cause Confidence — High / Medium / Low:
- Preventive Action Effectiveness — Effective / Partial / Ineffective / Not Tested / N/A - Approved No Action:
- Reanalysis Changed Conclusion:
- Regression Replay — Missing / Failed:
- Preventive Tasks — Open / Done / Blocked:
- Unresolved preventive-work age:
- Detection path — Human / AI self / other AI / automated:
- Documentation-only remediation / subsequent recurrence:
- Owner/Human escalations:
- Controls upgraded to executable gates/automation:
- Scheduler Expected Runs / Started / Completed / Failed-Blocked / Missed:
- Transient Retry Recoveries / Recovery Rate:
- Retry Required but Missing:
- Unauthorized Scheduler Stops:
- Owner-authorized Scheduler Stops:
- Open Scheduler Carryovers:

## Material risks and decisions

| Risk / rule family | Evidence | Current control | Decision | Owner / Task | Due / next signal |
|---|---|---|---|---|---|
| | | | Accept / Strengthen / Escalate / Close | | |

## Postmortem analysis-quality findings

| Postmortem | RCA Quality | Confidence | Failure Layer | Action effectiveness | Reanalysis changed? | Regression replay | Decision |
|---|---|---|---|---|---|---|---|
| | Pass / Revise / Not Evaluated | High / Medium / Low | | Effective / Partial / Ineffective / Not Tested / N/A - Approved No Action | Yes / No | Pass / Fail / Missing / N/A | Keep / Reanalyze / Strengthen |

Flag any case where:
- Low confidence has already moved to Actioning;
- the independent reviewer changed Root Cause or Preventive Action;
- an Effective action was followed by recurrence at the same causal node;
- documentation-only remediation was followed by recurrence;
- the replay did not exercise the original failure mode.

## Scheduler continuity findings

| Job | Expected | Started | Completed | Failed/Blocked | Missed | Retry recovery | Unauthorized stop | Open carryover | Decision |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| | | | | | | | | | Healthy / Strengthen / Escalate |

Flag any case where:
- an expected window has no Started evidence;
- a transient failure did not receive the required retry attempts;
- a recurring scheduler was disabled without explicit Owner authorization;
- a failed run caused future scheduled windows to disappear;
- an unfinished run was not reconsidered at the next applicable window.

## Recurrence / common-mode findings

- 

## Owner / Human decisions required

- None / list explicit decision and why AI authority is insufficient.

## Postmortem closure candidates

For each candidate, confirm: RCA Quality=Pass; confidence Medium/High; causal model and alternative hypotheses recorded; preventive Task Done or approved no-action decision; action-to-cause counterfactual valid; durable control updated where required; original failure mode Regression Replay passed (or approved substitute evidence exists); effectiveness is `Effective` or `N/A - Approved No Action`, or a `Partial` / `Ineffective` / `Not Tested` result has an explicitly authorized residual-risk acceptance plus independent approval; recurrence correct; no residual corrective action.

- 

## New / reprioritized preventive work

- 

## Control updates

- Operating Guide:
- AGENTS / Skill:
- Automated gate / CI:
- Other governance artifact:

## Next review focus

- 
