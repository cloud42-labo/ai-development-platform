# ADP-065-T05 — Decision Adapter v1 shadow evidence

**Status**: initial live validation of the generalized adapter
(`adapters/decision-adapter/`) against the real Jev API, covering 6 of the
7 registered Decision Points. This is a smoke-test / small-sample
validation that the adapter + each classifier's schema works end-to-end
live, **not** a full calibration campaign — see "Known gaps" below for
what still needs dedicated fixture-collection work before any of these
thresholds could be trusted the way `docs/jev-decision-point-
inventory.md` section 9.4's DP-4 campaign (24 live calls, reproducibility
checked 4x per fixture) was.

Execution environment: Claude Code (same session as this Task).
`api.typesafe.ai` is reached through this session's own egress proxy,
which injects the request credential transparently — this session never
set an explicit `Authorization` header and never read/output an API key
value (same "never reference the key" posture `docs/
jev-decision-point-inventory.md` section 9.6 recorded for `ADP-065-T03`,
achieved here by a different mechanism: proxy-level injection rather than
an env-var Bearer header — see `providers/jev_provider.py`'s module
docstring for why the provider supports both).

## What was run

`shadow_evidence.jsonl` — 7 live calls, one per fixture below, each
through `run_shadow_call()` (`adapters/decision-adapter/run_shadow.py`),
each logged with its own `input_hash` (not the raw state) plus typed
output, confidence, threshold, latency, and cost.

| # | Decision Point | Fixture | Jev output | Confidence | Threshold | Route | Ground truth | Agrees |
|---|---|---|---|---|---|---|---|---|
| 1 | `dp4_policy_category` | Smoke test reproducing `ADP-065-T03`'s DP4-01 through the new generalized adapter | `read-connected-resources` | 1.00 | 0.70 | jev_shadow | `read-connected-resources` | ✅ |
| 2 | `dp1_ac_triage` | BMG-02-S01-T01's real Acceptance Criterion (Owner device confirmation) | `human_only` | 0.99 | 0.85 | jev_shadow | `human_only` | ✅ |
| 3 | `dp1_ac_triage` | This Task's own Acceptance Criterion 5 (merge authority stays with existing governance) | `ai_verifiable` | 0.54 | 0.85 | **fallback** (below threshold) | `ai_verifiable` | ✅ (value correct, but confidence too low to auto-trust) |
| 4 | `dp3_backlog_placement` | BUS-04-S03-T03b's real Epic placement (candidates: BUS-04 / ADP-065 / AOD-01 / none_fit) | `none_fit` | 0.86 | 0.85 | jev_shadow | `BUS-04` | ❌ **real miss** — see below |
| 5 | `pr_flow_classification` | `store-survival-simulator` PR #1 (real, open PR; mergeable=clean, 0 unresolved threads, no CI configured, explicitly waiting on an Owner go/no-go to publish) | `BLOCKED_EXTERNAL` | 0.99 | 0.85 | jev_shadow | ambiguous — see below | n/a (ambiguous boundary) |
| 6 | `pr_review_necessity` | Same PR #1 | `HUMAN_REVIEW` | 0.51 | 0.85 | **fallback** (below threshold) | `HUMAN_REVIEW` | ✅ (value correct, confidence too low to auto-trust) |
| 7 | `task_value_type` | This Task (`ADP-065-T05`) self-classified | `Platform Capability` | 1.00 | 0.80 | jev_shadow | `Platform Capability` | ✅ |

**Accuracy over objective fixtures (#1, #2, #3, #6, #7 — #4 counted as a
miss, #5 excluded as ambiguous)**: 5/6 = 83.3%. `jev_cost_usd_total` for
all 7 calls: **$0.000229**. `latency_ms` p50 ≈ 296ms, p95 ≈ 644ms (n=7,
too small for a real percentile — reported for completeness only, not as
a calibrated SLA number).

Run `python3 evidence_tools/summarize_kpi.py evidence/adp-065-t05/shadow_evidence.jsonl`
(from `adapters/decision-adapter/`) to regenerate this summary.

## The one real miss: fixture #4 (DP-3, BUS-04 placement)

Jev chose `none_fit` with confidence 0.86 — **above** the 0.85 threshold,
so this specific call would have been (wrongly) auto-trusted had the
threshold been the only gate. Ground truth is `BUS-04`: the real Epic
`BUS-04｜R&D収益ポートフォリオを立ち上げる`'s own child Story
(`BUS-04-S03`) already covers exactly this item (`BUS-04-S03-T03b` is a
real child Task of it today). The three candidate Epic descriptions given
to Jev were short Objective-sentence summaries; none of them mentioned
"facilitator script" or "training PoC" literally, and `BUS-04`'s own
summary ("research output monetization, apps, education/diagnostic,
sponsored research, IP licensing") requires inferring that a PoC
facilitation guide for a game-based corporate training product falls
under its "apps" / "education" sub-scope rather than being named
directly. This is a genuine, observed limitation of this fixture's prompt
design, not a fabricated result — recorded honestly per this
organization's established norm (`docs/jev-decision-point-inventory.md`
section 9.4's DP4-08 disagreement is the precedent for recording a real
miss rather than omitting it). **Takeaway for anyone calibrating
`dp3_backlog_placement` before any promotion Gate**: candidate Epic
descriptions likely need to carry more than a one-line Objective summary
(e.g. recent child Story/Task titles) before this Decision Point's
threshold can be trusted at `n=1`; this is exactly the kind of threshold
tuning Acceptance Criterion 11's independent-holdout Gate exists to catch
before any promotion, not evidence that the Gate can be skipped.

## Fixture #5's ambiguity (PR Flow classifier)

`store-survival-simulator` PR #1 is real and was, at call time, mergeable
(`mergeable_state=clean`), with 0 unresolved review threads and no CI
configured on that repository at all — but its own PR body explicitly
says it is being left open pending the Owner's decision whether to
publish the application publicly via GitHub Pages, and separately flags a
GitHub Pages repository-setting toggle this agent cannot perform. Both
`WAITING_REVIEW` (waiting on a human decision) and `BLOCKED_EXTERNAL`
(blocked by something outside the PR's own diff content) are defensible
readings of the same real state. This is recorded as an ambiguous
boundary case (`objective: false` in the evidence record), the same
category `docs/jev-decision-point-inventory.md` section 9.4 used for
DP4-07/08, not counted toward the accuracy figure above in either
direction.

## Known gaps (carried forward, not fabricated)

- **`dp6_postmortem_triage` has zero live evidence.** No concrete,
  real Postmortem record with known-correct Accept/Strengthen/
  Escalate/Close ground truth was available to this session at execution
  time. Inventing one would be fabricating a fixture, which this
  organization's own established practice (section 9.3's honest DP-9/
  DP-10 gap reporting under `ADP-065-T03`) explicitly avoids. Whoever next
  works a Postmortem under `governance/monthly-risk-management-review.md`
  is the natural source for a first real `dp6_postmortem_triage` fixture.
- **Every fixture here is `n=1`** (no reproducibility re-runs, unlike
  DP-4's original 4x-per-fixture campaign in `ADP-065-T03`). This is
  sufficient to prove the adapter and each classifier's schema work
  end-to-end against the live API, and to surface the DP-3 miss above —
  it is **not** sufficient to set or trust a production confidence
  threshold for `pr_flow_classification`, `pr_review_necessity`, or
  `task_value_type`. Acceptance Criterion 11's independent-holdout
  promotion Gate is exactly the mechanism that should require more before
  any of this moves past shadow mode.
- **No fixture here comes from inside Chris's own control-plane
  execution.** `pr_flow_classification` and `pr_review_necessity` are
  designed as Chris-side shadow adapters (GitHub issue #94 Phase 1 items
  3–4); the one live fixture above was run from this Claude session using
  real, observable PR state, not from inside an actual `pr-flow-gate`
  Skill invocation. Wiring either classifier into that Skill's own
  procedure is separate follow-up work this Task does not claim to have
  done.
