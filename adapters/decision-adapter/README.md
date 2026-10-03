# Decision Adapter v1 (ADP-065-T05)

> **Artifact status:** durable design + reference implementation for the
> `Adapters` asset class (`adapters_version` in `adp-package.yaml`).
> Produced for `ADP-065-T05`, implementing the shape `docs/
> jev-decision-point-inventory.md` section 5 sketched (and explicitly did
> not build) under `ADP-065-T02`, using the real Jev API schema confirmed
> live under `ADP-065-T03` (that document's section 9.2).

## Purpose

ADP already runs a large number of recurring, bounded judgment calls inside
Claude's and Chris's own execution flow — PR review-necessity triage, PR
Flow Gate classification, Acceptance-Criterion Human-only triage,
Backlog→Epic/Story placement, Postmortem severity triage, Task Value Type
classification. Per the `2026-09 KPI/KMI Final` baseline cited by this
Task's Approach Decision (PR作成317/月, Task作成560/月, Human依存19.6%,
Value Type設定率6.0%), these calls consume real Claude/Chris attention at
volume. This package is **not** an adoption of Jev as a decision authority —
it is a vendor-neutral front door (`decide()`) that today's only existing
"provider" (an LLM reasoning about the input directly) can keep using
unchanged, and that a calibrated external classifier (Jev, or anything
else later) can plug into **without any call site depending on
`api.typesafe.ai` directly**.

## Why vendor-neutral

A Decision Point's call site (a Skill, a gate procedure, a Notion
pre-flight) calls `decide(decision_point_id, state, question,
confidence_threshold, ..., provider, fallback_route, decision_point_label,
evidence_path=...)`. It never imports
`providers/jev_provider.py` itself, and it never hardcodes a TypeSafe API
URL. Swapping Jev for a different provider later — or temporarily routing
one Decision Point to a different backend — means changing which
`DecisionProvider` instance is constructed at the call's integration
point, not rewriting the call site, `governance/agent-policy.yaml`, or
`governance/ai-execution-constraints.md`. This mirrors the Execution
Adapter precedent in `docs/claude-projects-evaluation.md` section 5.

## Phase 1 scope (this package, as of this Task)

1. **Vendor-neutral Decision Adapter interface** — `decision_adapter.py`
   (`decide()`, `DecisionProvider` protocol, `DecisionResult`).
2. **Jev provider** — `providers/jev_provider.py`, built against the real
   `POST /v1/systemone` schema confirmed in `docs/
   jev-decision-point-inventory.md` section 9.2 (not the earlier,
   since-superseded assumptions in that document's section 8).
3. **Shadow-only classifiers** for the Decision Points this Task's
   Acceptance Criteria and GitHub issue #94 name for Phase 1 —
   `decision_points.py`:
   - `dp4_policy_category` (DP-4 — ambiguous action → policy-category
     classification; reuses the exact criteria validated live under
     `ADP-065-T03`, 100% accuracy on 4 objective fixtures).
   - `dp1_ac_triage` (DP-1 — Acceptance-Criterion Human-only triage).
   - `dp3_backlog_placement` (DP-3 — Backlog→Epic/Story placement;
     state-dependent, built per call via `build_dp3_placement_spec()`).
   - `dp6_postmortem_triage` (DP-6 — Postmortem severity/escalation
     triage; schema defined, **no live fixture evaluated yet** — see
     `evidence/adp-065-t05/README.md` "Known gaps").
   - `pr_review_necessity` (GitHub issue #94 Phase 1 item 3).
   - `pr_flow_classification` (GitHub issue #94 Phase 1 item 4; Notion
     Acceptance Criterion 3).
   - `task_value_type` (GitHub issue #94 Phase 1 item 7).
4. **Evidence/audit logging** (`evidence.py`) and a **KPI summarizer**
   (`evidence_tools/summarize_kpi.py`) implementing Acceptance Criteria 8
   and 9.
5. **Unit tests** (`tests/test_decision_adapter.py`, no network) proving
   the fallback/hard-constraint invariants below structurally, not just by
   convention.
6. **Live shadow evidence** for 6 of the 7 registered Decision Points (all
   but DP-6) — see `evidence/adp-065-t05/`.

## Explicitly NOT in this package (non-goals)

- **No auto-action.** Every `DecisionResult` carries `mode="shadow"` and
  `auto_actionable=False` unconditionally (`decision_adapter.py`
  enforces this in code, not just in this prose — see
  `tests/test_decision_adapter.py::test_high_confidence_routes_to_jev_shadow_and_is_never_auto_actionable`).
  Promoting any single Decision Point out of shadow mode requires its own
  independent-holdout promotion Gate, per Acceptance Criterion 11 and
  `docs/jev-decision-point-inventory.md` section 5 point 4 — this package
  does not implement that promotion Gate, only the shadow mode it gates.
- **No wiring into the live PR Flow Gate, Backlog Refinement, or Task
  intake procedures themselves.** Those are Skills hosted in
  `cloud42-labo/skills` (`pr-flow-gate`, `backlog-refinement`,
  `task-approach-review`, `hierarchical-refinement`) or Chris's own
  control-plane procedure; this Task delivers the adapter + classifier
  schemas those call sites *could* call, not a change to those Skills'
  own files. Actually wiring a call site to this adapter is separate
  follow-up work, tracked per Decision Point, not implied by this
  package existing.
- **DP-9 (Task sizing) and DP-10 (MISC duplicate detection) are absent
  from this registry entirely** — Acceptance Criterion 10 excludes both
  from Auto Decision, and `docs/jev-decision-point-inventory.md` section
  9.7 already records that neither has enough frozen fixture data for even
  a shadow evaluation. Nothing here changes that.
- **No sampling-parameter control.** The live API has no
  temperature/top_p/seed fields (`docs/jev-decision-point-inventory.md`
  section 9.2) — `providers/jev_provider.py` does not pretend otherwise.

## Hard constraints (structural, not just documented)

Per GitHub issue #94 "Hard constraints" and this Task's Acceptance
Criteria 4–6:

- **Deterministic hard gates are never evaluated or overridden by this
  package.** CI failure, an unresolved P0/P1 review thread,
  `mergeable=false`, an author=merger rule, and protected-branch merge
  authority are checked by the existing deterministic procedures
  (`governance/review-loop-control.md`, R02/R03) **before or regardless
  of** any `decide()` call — this package has no code path that reads or
  writes `governance/agent-policy.yaml`'s `decision: approve`/`deny` rows,
  and `pr_flow_classification`'s own criteria text says so explicitly so a
  future reader of a shadow result does not mistake it for a gate
  override.
- **Jev has no merge authority under any output.** No function in this
  package calls a GitHub merge API, and `DecisionResult.auto_actionable`
  is always `False` regardless of `route`/`confidence` — see the unit
  test referenced above.
- **Fail-open only toward the existing fallback, never toward
  auto-action.** `decide()` routes every below-threshold result, every
  provider error (timeout, non-200, malformed response), and every
  out-of-bounds case to the Decision Point's own configured
  `fallback_route` (`claude`/`chris`/`human` — never a bare default
  `"allow"`/`"proceed"` value). See
  `tests/test_decision_adapter.py::test_below_threshold_routes_to_configured_fallback`
  and `::test_provider_error_routes_to_fallback_and_never_raises`.
- **A successful-but-invalid provider response can never pass the
  threshold check.** `decide()` validates the response against
  `question` before it is allowed to route to `"jev_shadow"`: a Choice
  value absent from `question.criteria`, a Score outside the API's 2-10
  scale, a Noul outside `[0, 1]`, or a non-numeric/out-of-range
  confidence are all forced to `route="fallback"` with
  `fallback_reason="out_of_bounds:<detail>"`, regardless of how high the
  reported confidence is — see `tests/test_decision_adapter.py::
  test_choice_value_outside_criteria_is_out_of_bounds_not_jev_shadow` and
  the three sibling `test_*_is_out_of_bounds`/`test_malformed_confidence_
  is_out_of_bounds` tests.
- **Every call that produces a `DecisionResult` also produces exactly one
  evidence record, structurally.** `decide()` is the single public
  execution path in this package (`run_shadow_call()` in `run_shadow.py`
  is a thin convenience wrapper over it, not a second place that logs);
  it requires at least one of `evidence_path`/`evidence_sink` and raises
  `ValueError` before ever calling the provider if neither is given, so a
  caller cannot obtain a result that was never logged. See
  `tests/test_decision_adapter.py::
  test_missing_evidence_sink_and_path_rejected_before_calling_provider`
  and the evidence-sink assertions in the other `DecideTests` cases
  (success, below-threshold, provider-error, and out-of-bounds paths all
  log).
- **No data leakage beyond what the inventory already established as
  sendable.** `decide()` hashes `state` for evidence (`input_hash`) and
  never writes the raw `state` payload to the evidence file — see
  `tests/test_decision_adapter.py::test_state_is_hashed_not_logged_verbatim`.
  This does not by itself clear `governance/research-security-policy.md`'s
  section 1 public-information check for a *new* kind of state content —
  a call site sending genuinely new, more sensitive state than what
  `ADP-065-T03` already sent still needs its own check against that
  policy before the call, same as any other external communication.
- **Metered-service gate.** Every live call in `evidence/adp-065-t05/`
  was made under the same Owner approval and billing gate already
  established for `ADP-065-T01`–`T04` (see that Task's own Approach
  Decision/Refinement Decision in Notion) — this package does not grant
  itself new billing authority, and a future call site integrating this
  adapter still owns its own `governance/research-security-policy.md`
  section 6 pre-flight before its first call.

## Interface

```python
decide(
    decision_point_id: str,
    decision_point_version: str,
    state: dict,
    question: TypedQuestion,          # output_kind: choice | score | noul
    confidence_threshold: float,
    threshold_version: str,
    provider: DecisionProvider,       # e.g. JevProvider()
    fallback_route: str,              # "claude" | "chris" | "human"
    decision_point_label: str,        # descriptive tag for this call, for evidence/KPI
    *,
    evidence_path: str | None = None,     # at least one of these two is required --
    evidence_sink: Callable[[dict], None] | None = None,  # decide() raises ValueError otherwise
    ground_truth: str | None = None,  # optional, for accuracy bookkeeping only
    objective: bool | None = None,
) -> DecisionResult
```

`decide()` is the only function in this package that produces a
`DecisionResult`, and it always writes exactly one evidence record (via
`evidence_path` and/or `evidence_sink`) before returning one — see "Hard
constraints" above. `DecisionResult` always carries `mode="shadow"`,
`auto_actionable=False`, `route` (`"jev_shadow"` or `"fallback"`),
`fallback_route`/`fallback_reason` (populated only when
`route == "fallback"`; a `"fallback_reason"` of `"below_threshold"`,
`"provider_error:<reason>"`, or `"out_of_bounds:<detail>"`), the typed
`value`/`confidence`, and the audit fields Acceptance Criterion 8 requires
(`input_hash`, `model`/`model_version`, `threshold`/`threshold_version`,
`latency_ms`, `cost_usd`, `timestamp_utc`). See `decision_adapter.py`'s
docstrings for the full field list and the reasoning behind each
invariant.

## Versioning

This package is the first content in the `Adapters` asset class
`docs/versioning-policy.md` reserved a slot for but left unversioned
("Adapters still has none and still has no field; leave it that way until
one exists" — that condition no longer holds). See `adp-package.yaml`'s
new `adapters_version` field and `docs/versioning-policy.md`'s new
"Adapters" section for the SemVer judgment this package versions under
going forward. Per-Decision-Point `version`/`threshold_version` fields in
`decision_points.py` version independently of the package's own
`adapters_version`, for the same reason Rules/Schemas/Workflows/Templates
already version independently of each other and of `adp-package.yaml`'s
overall `version`.

## Running the tests

```bash
cd adapters/decision-adapter
python3 -m unittest discover -s tests -v
```

No network access is required or used by the unit tests (a `FakeProvider`
stands in for `JevProvider`). Live evidence collection (as run for this
Task) requires `api.typesafe.ai` reachability and prior Owner billing
approval — see `evidence/adp-065-t05/README.md`.
