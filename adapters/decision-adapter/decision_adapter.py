"""Vendor-neutral Decision Adapter v1 (ADP-065-T05).

Implements the interface sketched by `docs/jev-decision-point-inventory.md`
section 5:

    decision = decide(decision_point_id, state, typed_question, confidence_threshold)
      -> { output_kind: Choice|Score|Noul, value, confidence, below_threshold: bool }

This module is the vendor-neutral half only. It never imports a specific
provider (e.g. Jev) directly -- callers pass a `DecisionProvider` instance in.
Today's only other implementation of this same contract is "the acting LLM
reasons about it directly" (i.e. not calling `decide()` at all); nothing
about that fallback path changes by this module existing.

Hard constraints this module enforces structurally, not just by convention
(see `README.md` "Hard constraints" and GitHub issue #94):

- `decide()` NEVER returns a result the caller is meant to auto-act on in
  Phase 1: every `DecisionResult` is produced with `mode="shadow"` and
  carries `auto_actionable=False` unconditionally. Flipping that requires a
  separate, later promotion decision per Decision Point
  (`docs/jev-decision-point-inventory.md` section 5 point 4, and this
  Task's own Acceptance Criterion 11) -- this module does not implement
  that promotion gate itself.
- Any provider failure, below-threshold confidence, or out-of-bounds output
  resolves to `route="fallback"` with the Decision Point's own configured
  `fallback_route` (`claude`, `chris`, or `human`) -- never to a default
  "allow"/"proceed" value. See `decision_points.py`'s `fallback_route` field
  per Decision Point.
- Every call is logged as one evidence record. `decide()` itself is the
  single public execution path that guarantees this: it requires at least
  one of `evidence_path` / `evidence_sink` and writes the record itself on
  every return path (success, below-threshold, provider error, and
  out-of-bounds alike) before returning -- a caller cannot obtain a
  `DecisionResult` without that record also existing. The record carries
  the fields `docs/jev-decision-point-inventory.md` section 5 and this
  Task's Acceptance Criterion 8 require: decision_type/version, input hash,
  typed output/confidence, model/version, threshold/version, route/fallback,
  latency, and cost. The record never includes the raw `state` payload
  verbatim (only its hash) so evidence files do not become a second copy of
  potentially sensitive Task/Postmortem text.
- A provider response is validated before it can ever route to
  `"jev_shadow"`: a Choice value not present in `question.criteria`, a
  Score outside the API's 2-10 scale, a Noul outside [0, 1], or a
  malformed/out-of-range confidence are all treated as `"out_of_bounds"`
  and forced to `route="fallback"` regardless of the reported confidence
  value -- a provider cannot talk its way past the threshold check with an
  invalid answer.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, asdict
from typing import Any, Callable, Optional, Protocol

from evidence import append_evidence_record, build_evidence_record


DECISION_ADAPTER_VERSION = "0.1.0"


class ProviderError(Exception):
    """Raised by a DecisionProvider on any non-success outcome.

    Deliberately a single exception type: `decide()` treats every provider
    failure identically (route to fallback), so there is no behavioral
    difference between e.g. a timeout and an API-shape error. `reason` is a
    short machine-stable tag used in evidence/telemetry;
    `str(ProviderError)` is the long-form, human-readable detail.
    """

    def __init__(self, reason: str, detail: str = ""):
        self.reason = reason
        super().__init__(detail or reason)


@dataclass(frozen=True)
class TypedQuestion:
    """One Jev-shaped typed question: Choice / Score / Noul.

    `criteria` follows the shape confirmed live in
    `docs/jev-decision-point-inventory.md` section 9.2:
    - choice: {option_name: description}
    - score:  [band description, ...] (ordered)
    - noul:   {"true": description, "false": description} (optional)
    """

    output_kind: str  # "choice" | "score" | "noul"
    instructions: str
    criteria: Any

    def __post_init__(self):
        if self.output_kind not in ("choice", "score", "noul"):
            raise ValueError(f"unknown output_kind: {self.output_kind!r}")


class DecisionProvider(Protocol):
    """What a concrete provider (e.g. Jev) must implement.

    A provider call is a pure function of (decision_point_id, state,
    question) -> ProviderResponse, or it raises ProviderError. It must not
    itself decide fallback routing, apply confidence_threshold, or write
    evidence -- all of that is `decide()`'s job, kept provider-agnostic so a
    second provider can be swapped in without touching any Decision Point
    call site (see README.md "Why vendor-neutral").
    """

    def call(self, decision_point_id: str, state: dict, question: TypedQuestion) -> "ProviderResponse":
        ...


@dataclass(frozen=True)
class ProviderResponse:
    model: str
    model_version: str
    output_kind: str
    value: Any
    confidence: Optional[float]  # None for Noul (the API has no separate confidence field for it)
    probabilities: Optional[dict]
    latency_ms: float
    input_tokens: int
    output_tokens: int
    cost_usd: float


@dataclass(frozen=True)
class DecisionResult:
    decision_point_id: str
    decision_point_version: str
    output_kind: str
    value: Any
    confidence: Optional[float]
    below_threshold: bool
    route: str  # "jev_shadow" | "fallback"
    fallback_route: Optional[str]  # "claude" | "chris" | "human" | None
    fallback_reason: Optional[str]  # None | "below_threshold" | "provider_error:<reason>" | "out_of_bounds"
    mode: str  # always "shadow" in v1
    auto_actionable: bool  # always False in v1 -- see module docstring
    provider_name: str
    model: Optional[str]
    model_version: Optional[str]
    threshold: float
    threshold_version: str
    input_hash: str
    latency_ms: Optional[float]
    cost_usd: Optional[float]
    timestamp_utc: str

    def to_evidence_dict(self) -> dict:
        return asdict(self)


def _hash_state(state: dict) -> str:
    """A stable hash of the input state, never the state itself.

    Evidence files must not become a second, less-governed copy of Task/
    Postmortem/PR text (`governance/research-security-policy.md` section 1).
    `sort_keys=True` makes the hash independent of dict insertion order.
    """
    blob = json.dumps(state, sort_keys=True, ensure_ascii=False, default=str)
    return "sha256:" + hashlib.sha256(blob.encode("utf-8")).hexdigest()


def decide(
    decision_point_id: str,
    decision_point_version: str,
    state: dict,
    question: TypedQuestion,
    confidence_threshold: float,
    threshold_version: str,
    provider: DecisionProvider,
    fallback_route: str,
    decision_point_label: str,
    *,
    evidence_path: "str | None" = None,
    evidence_sink: "Callable[[dict], None] | None" = None,
    ground_truth: Optional[str] = None,
    objective: Optional[bool] = None,
    provider_name: str = "jev",
) -> DecisionResult:
    """Run one shadow decision call. Never raises on provider failure.

    This is the single public execution path: it is the only function in
    this package that produces a `DecisionResult`, and it always writes
    exactly one evidence record before returning one -- a caller cannot
    get a result without that record also existing (see module docstring
    "Hard constraints"). Pass `evidence_path` (append a JSONL line via
    `evidence.append_evidence_record`) and/or `evidence_sink` (a callback
    receiving the record dict, e.g. for in-memory test collection); at
    least one is required, or this raises `ValueError` before calling the
    provider at all.

    `fallback_route` must be one of "claude" / "chris" / "human" -- the
    Decision Point's own documented fallback actor
    (`docs/jev-decision-point-inventory.md`'s per-DP "Fallback" field), not
    a free-text value. A below-threshold, provider-error, or out-of-bounds
    result always carries this same `fallback_route`; `decide()` never
    invents its own.
    """
    if fallback_route not in ("claude", "chris", "human"):
        raise ValueError(f"fallback_route must be claude/chris/human, got {fallback_route!r}")
    if evidence_path is None and evidence_sink is None:
        raise ValueError(
            "decide() requires evidence_path and/or evidence_sink -- every call must be "
            "logged (see module docstring 'Hard constraints')"
        )

    input_hash = _hash_state(state)
    timestamp = _utc_now_iso()

    try:
        resp = provider.call(decision_point_id, state, question)
    except ProviderError as exc:
        result = DecisionResult(
            decision_point_id=decision_point_id,
            decision_point_version=decision_point_version,
            output_kind=question.output_kind,
            value=None,
            confidence=None,
            below_threshold=True,
            route="fallback",
            fallback_route=fallback_route,
            fallback_reason=f"provider_error:{exc.reason}",
            mode="shadow",
            auto_actionable=False,
            provider_name=provider_name,
            model=None,
            model_version=None,
            threshold=confidence_threshold,
            threshold_version=threshold_version,
            input_hash=input_hash,
            latency_ms=None,
            cost_usd=None,
            timestamp_utc=timestamp,
        )
        _log_evidence(result, decision_point_label, evidence_path, evidence_sink, ground_truth, objective)
        return result

    invalid_reason = _validate_response(question, resp)
    if invalid_reason is not None:
        result = DecisionResult(
            decision_point_id=decision_point_id,
            decision_point_version=decision_point_version,
            output_kind=resp.output_kind,
            value=resp.value,
            confidence=resp.confidence,
            below_threshold=True,
            route="fallback",
            fallback_route=fallback_route,
            fallback_reason=f"out_of_bounds:{invalid_reason}",
            mode="shadow",
            auto_actionable=False,
            provider_name=provider_name,
            model=resp.model,
            model_version=resp.model_version,
            threshold=confidence_threshold,
            threshold_version=threshold_version,
            input_hash=input_hash,
            latency_ms=resp.latency_ms,
            cost_usd=resp.cost_usd,
            timestamp_utc=timestamp,
        )
        _log_evidence(result, decision_point_label, evidence_path, evidence_sink, ground_truth, objective)
        return result

    below_threshold = _is_below_threshold(resp, confidence_threshold)
    route = "fallback" if below_threshold else "jev_shadow"
    fallback_reason = "below_threshold" if below_threshold else None

    result = DecisionResult(
        decision_point_id=decision_point_id,
        decision_point_version=decision_point_version,
        output_kind=resp.output_kind,
        value=resp.value,
        confidence=resp.confidence,
        below_threshold=below_threshold,
        route=route,
        fallback_route=fallback_route if below_threshold else None,
        fallback_reason=fallback_reason,
        mode="shadow",
        auto_actionable=False,
        provider_name=provider_name,
        model=resp.model,
        model_version=resp.model_version,
        threshold=confidence_threshold,
        threshold_version=threshold_version,
        input_hash=input_hash,
        latency_ms=resp.latency_ms,
        cost_usd=resp.cost_usd,
        timestamp_utc=timestamp,
    )
    _log_evidence(result, decision_point_label, evidence_path, evidence_sink, ground_truth, objective)
    return result


def _log_evidence(
    result: DecisionResult,
    decision_point_label: str,
    evidence_path: "str | None",
    evidence_sink: "Callable[[dict], None] | None",
    ground_truth: Optional[str],
    objective: Optional[bool],
) -> None:
    agrees = None
    if ground_truth is not None and result.value is not None:
        agrees = result.value == ground_truth
    record = build_evidence_record(
        result.to_evidence_dict(),
        decision_point_label=decision_point_label,
        objective=objective,
        ground_truth=ground_truth,
        agrees_with_ground_truth=agrees,
    )
    if evidence_path is not None:
        append_evidence_record(evidence_path, record)
    if evidence_sink is not None:
        evidence_sink(record)


def _validate_response(question: TypedQuestion, resp: ProviderResponse) -> Optional[str]:
    """Return a short reason string if `resp` is invalid for `question`, else None.

    A provider returning HTTP 200 with a semantically invalid answer (an
    option Jev invented that isn't in `question.criteria`, a Score outside
    the API's declared 2-10 scale, a Noul outside [0, 1], or a
    non-numeric/out-of-range confidence) is not a `ProviderError` -- the
    call succeeded -- but it must never be allowed to pass the confidence
    threshold check and route to `"jev_shadow"` on the strength of a
    confidence value attached to an answer that cannot be trusted at all.
    """
    if resp.output_kind != question.output_kind:
        return f"output_kind mismatch: question={question.output_kind!r} response={resp.output_kind!r}"

    if question.output_kind == "choice":
        if not isinstance(question.criteria, dict) or resp.value not in question.criteria:
            return f"choice value {resp.value!r} is not a member of question.criteria"
        if not _is_valid_unit_confidence(resp.confidence):
            return f"invalid confidence for choice: {resp.confidence!r}"
    elif question.output_kind == "score":
        if not isinstance(resp.value, (int, float)) or isinstance(resp.value, bool) or not (2 <= resp.value <= 10):
            return f"score value {resp.value!r} is outside the API's 2-10 scale"
        if not _is_valid_unit_confidence(resp.confidence):
            return f"invalid confidence for score: {resp.confidence!r}"
    elif question.output_kind == "noul":
        if not isinstance(resp.value, (int, float)) or isinstance(resp.value, bool) or not (0 <= resp.value <= 1):
            return f"noul value {resp.value!r} is outside [0, 1]"
        # Noul has no confidence field at all (module docstring / section 9.2);
        # resp.confidence must stay None for it, never a stray value.
        if resp.confidence is not None:
            return f"noul response unexpectedly carried a confidence value: {resp.confidence!r}"

    return None


def _is_valid_unit_confidence(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and 0.0 <= value <= 1.0


def _is_below_threshold(resp: ProviderResponse, threshold: float) -> bool:
    # Noul has no confidence field in the live API (docs/jev-decision-point
    # -inventory.md section 9.2) -- its own probability IS the thing
    # compared to a threshold by the caller's Decision Point design (e.g.
    # DP-10), not a separate confidence score. decide() does not have a
    # per-DP opinion on which side of 0.5 "yes" is, so a Noul result is
    # never auto-marked below_threshold by this generic function; the
    # calling Decision Point's own logic must apply its own comparison
    # before treating a Noul route as "jev_shadow" for its purposes.
    if resp.output_kind == "noul":
        return False
    if resp.confidence is None:
        return True
    return resp.confidence < threshold


def _utc_now_iso() -> str:
    import datetime

    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
