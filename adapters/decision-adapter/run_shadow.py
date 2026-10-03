"""Run one shadow Decision Adapter call via `decide()`.

`decide()` (in `decision_adapter.py`) is the single public execution path
and always writes its own evidence record -- this module is now a thin
CLI/library convenience over it, not a second place that logs evidence.

Usage as a library (preferred -- this is how the live fixtures for
`evidence/adp-065-t05/` were produced):

    from run_shadow import run_shadow_call
    from decision_points import DP4_POLICY_CATEGORY
    from providers.jev_provider import JevProvider

    result = run_shadow_call(
        spec=DP4_POLICY_CATEGORY,
        state={...},
        provider=JevProvider(),
        evidence_path="evidence/adp-065-t05/shadow_evidence.jsonl",
        decision_point_label="DP-4 smoke test",
        ground_truth="read-connected-resources",
    )

Usage as a CLI (one static decision point, state from a JSON file):

    python3 run_shadow.py --decision-point dp4_policy_category \\
        --state-file state.json --evidence-path out.jsonl \\
        --label "DP-4 smoke test" --ground-truth read-connected-resources
"""
from __future__ import annotations

import argparse
import json
from typing import Optional

from decision_adapter import DecisionResult, DecisionProvider, decide
from decision_points import DecisionPointSpec, STATIC_DECISION_POINTS


def run_shadow_call(
    spec: DecisionPointSpec,
    state: dict,
    provider: DecisionProvider,
    evidence_path: str,
    decision_point_label: str,
    ground_truth: Optional[str] = None,
    objective: Optional[bool] = None,
) -> DecisionResult:
    return decide(
        decision_point_id=spec.decision_point_id,
        decision_point_version=spec.version,
        state=state,
        question=spec.question,
        confidence_threshold=spec.confidence_threshold,
        threshold_version=spec.threshold_version,
        provider=provider,
        fallback_route=spec.fallback_route,
        decision_point_label=decision_point_label,
        evidence_path=evidence_path,
        ground_truth=ground_truth,
        objective=objective,
    )


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--decision-point", required=True, choices=sorted(STATIC_DECISION_POINTS))
    parser.add_argument("--state-file", required=True)
    parser.add_argument("--evidence-path", required=True)
    parser.add_argument("--label", required=True)
    parser.add_argument("--ground-truth", default=None)
    parser.add_argument("--objective", action="store_true")
    args = parser.parse_args(argv)

    from providers.jev_provider import JevProvider

    spec = STATIC_DECISION_POINTS[args.decision_point]
    with open(args.state_file, encoding="utf-8") as f:
        state = json.load(f)

    result = run_shadow_call(
        spec=spec,
        state=state,
        provider=JevProvider(),
        evidence_path=args.evidence_path,
        decision_point_label=args.label,
        ground_truth=args.ground_truth,
        objective=args.objective,
    )
    print(json.dumps(result.to_evidence_dict(), ensure_ascii=False, indent=2))
    return 0 if result.route != "fallback" else 1


if __name__ == "__main__":
    raise SystemExit(main())
