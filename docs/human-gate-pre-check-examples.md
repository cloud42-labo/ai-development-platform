# Human Gate Pre-check — worked examples

> **Artifact status:** durable reference for applying the Human Gate Pre-check defined in [`operating-guide.md`](operating-guide.md) section 11 and [`../governance/ai-execution-constraints.md`](../governance/ai-execution-constraints.md).
>
> These examples are **anonymized patterns**, not a snapshot of any task's current status. Notion is the system of record for what state a given task is actually in today; this file exists so the reasoning pattern survives after the concrete tasks it was drawn from are archived or their state has moved on. For the dated, linkable evidence behind each pattern (the actual task IDs, PR numbers, run IDs, and timestamps), see the `Result` field of `ADP-043-H` in Notion Stories & Tasks — that is where operational history belongs, not here.

The pre-check exists because a Human gate is a claim about the present ("no record exists yet that satisfies this criterion") written in the past. The three patterns below are the three outcomes the classification can produce.

## Pattern 1 — False Human gate

**Shape:** a parent Story is `Blocked` because a child task is recorded as incomplete, but the child was actually completed some time ago and the parent's Blocker text was never revisited.

**How it's found:** the Blocker names a specific child task or request. Checking whether that child is still incomplete is a single lookup — this is what makes the daily sweep affordable. A Blocker written as an open-ended "Human confirmation needed" without naming what would satisfy it is the kind that rots silently, because there is nothing concrete to re-check.

**Classification approach:** walk each Acceptance Criterion of the child separately.
- Design/behavior criteria already implemented and verified (a merged PR, a passing headless run, a rendered screen) → `AI-verifiable`, already satisfied.
- Criteria requiring a person's judgement (readability, usefulness, "did this make sense to a real user") → check whether an actual user session, survey, or feedback record already exists with a date. If it does and it covers the criterion, classify as `Human evidence already exists` rather than re-requesting it.

**Outcome:** once every criterion is covered by one of the two "already satisfied" classes, no `Human-only` criterion remains — clear the Blocker and complete the task, with the evidence links recorded in `Result`.

### Pattern 1b — the same failure produced by a tool limitation, not a Human gap

**Shape:** an agent tries to verify something (typically a CI result) through one connector, that connector's API surface doesn't expose the record it needs (e.g. it only lists runs triggered by a specific event type), and the agent concludes a Human must check it instead of trying a different path to the same evidence.

**Rule this produces:** *one tool failing is not evidence that a Human is required.* Before classifying a criterion `Human-only` because a lookup failed, try another tool, another agent's connector, or the underlying API directly — and record which paths were tried and which one worked, so the next agent neither repeats the dead end nor inherits a wrong conclusion.

## Pattern 2 — Genuine Human gate, correctly maintained

**Shape:** every criterion genuinely requires a person and no adequate record exists — account creation with identity verification and payment, filling in a third-party console form with no API path (even when the *content* was already AI-drafted — data entry into someone else's UI is still a Human action), or a decision that is inside the Owner's authority (positioning, category, irreversible commitments).

**What distinguishes this from Pattern 1:** in Pattern 1 the Human act had already happened and had a dated record somewhere. Here it demonstrably has not — for instance, a sibling gate in the same Story is already `Done`, which confirms the Owner is actively working the Story and makes the continued absence of any record for this gate meaningful rather than merely unsearched.

**Action:** leave the Human Request as-is. The pre-check is not a bias toward closing gates — it is a requirement to look before opening or keeping one, in both directions.

## Pattern 3 — Partial Human gate

**Shape:** a Blocked task bundles several checkpoints or questions under one Human confirmation requirement, but when split apart, some checkpoints are already AI-verifiable or already covered by existing Human evidence, and only a genuine remainder needs a person.

**Classification approach:** decompose the gate into its individual checkpoints/questions rather than treating it as one all-or-nothing Human confirmation. Score each one independently against the three classes.

**Action:** the task can stay `Blocked`, but the Blocker text is rewritten to name only the residual — the specific checkpoints still needing a person — with the satisfied portions and their evidence recorded in `Result`. An unscoped gate ("verify this is understandable") has no defined completion and drifts; a narrowed one ("confirm these two specific points at the next session that's happening anyway") fits into work already scheduled. Narrowing converts a stalled dependency into a scheduled one, even when the gate itself survives.

## Pattern 4 — Downstream Human work mistaken for the current gate

**Shape:** a criterion is correctly classified `Human-only` (Patterns 1–3 apply the three classes correctly), but it belongs to a *later, independent* transition in the same End-to-End flow — deployment, publication, or real-device/environment Acceptance that happens *after* the transition actually being evaluated (typically PR review → merge). The task/PR is reported as Human-waiting on that basis, even though nothing about the current transition's own gates (review, CI, mergeability) actually depends on it.

**How it differs from Patterns 1–3:** those patterns are about whether the classification itself is correct (already satisfied, genuinely needed, or partially needed). Pattern 4's classification can be entirely correct — the criterion really is `Human-only` — and the gate is still wrong, because it was applied to the wrong transition.

**Classification approach:** name the transition currently being evaluated precisely (e.g. "PR review → merge", not "ship the feature"). For each `Human-only` criterion, ask whether it is a mandatory prerequisite of *that* transition specifically, or of a transition that comes after it. See Operating Guide section 11.8.

**Action:** if the criterion gates a downstream transition **and no accountable reviewer has already explicitly tied it to the current transition**, do not block the current one on it — let the current transition proceed on its own actual gates, and route the Human-only work as its own request scoped to the transition it actually gates. The downstream gate itself is not removed, only prevented from propagating backward to a transition it does not govern. If an accountable reviewer HAS already explicitly gated the current transition on this criterion (e.g. a standing "will not merge until X"), that stays in force until the same standard of evidence — a dated comment/review from an equally accountable authority — revises it; this pattern narrows an AI-invented over-block, it never authorizes overriding a still-current human decision on the AI's own reasoning.

Two worked regression cases — a criterion that turned out not to be a merge precondition at all, and a genuine downstream gate (real-environment deployment Acceptance) that stayed a real merge precondition until its own author later revised it in a dated comment — are in [`../governance/state-transition-pre-check-regression-cases.md`](../governance/state-transition-pre-check-regression-cases.md), drawn from Postmortem PM-8.

## What the first inventory pass found

The pre-check was first applied across every open `Type = Human Request` and every task `Blocked` for a Human reason in one pass (28 records). A small minority were false gates (Pattern 1/1b); the large majority were correct and left alone (Pattern 2, or legitimate pending dependencies). See `ADP-043-H`'s `Result` in Notion for the exact count and the specific tasks corrected on that pass.

Every false gate found in that pass had the same shape: **a Human act had completed, and the record pointing at it was never updated.** None were caused by a Human failing to act. Two consequences follow, and both are now rules (see [`operating-guide.md`](operating-guide.md) section 11.6):

- **Check the named dependency first.** A Blocker that names a task or request is verified with one lookup. This is what makes clearing stale gates cheap enough to do daily.
- **A satisfied Human gate does not mean the task is Done.** Where the Human portion is complete but AI work remains, the correct move is to return the task to `Ready` with the residual AI work named — not to close it, and not to leave it `Blocked`. `Blocked` and `Done` are both wrong answers for "the person finished; the machine has not started".

## Reading Patterns 1–3 together

Patterns 1–3 share one axis — whether the classification of a criterion (already satisfied / genuinely needed / partially needed) is correct:

| | Pattern 1 | Pattern 2 | Pattern 3 |
|---|---|---|---|
| Human act already performed and recorded? | Yes | No | Partly |
| AI-verifiable portion completed before asking? | N/A — nothing left | Often, e.g. content pre-drafted | Often, ahead of time |
| Outcome | Gate removed, task completed | Gate kept unchanged | Gate kept, scope narrowed to the residual |

Pattern 4 is a different axis and can co-occur with any of the three above: even a correctly classified `Human-only` criterion can be misapplied to a transition it does not actually gate.

The pre-check does not decide in advance that Humans are unnecessary. It decides that a Human gate must be justified by the current absence of evidence, and that the absence must be established by searching rather than assumed by inheritance from an earlier, possibly stale, gate.
