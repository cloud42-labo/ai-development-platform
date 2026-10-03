"""Summarize a shadow-evidence JSONL file into the KPI set named by this
Task's Acceptance Criterion 9 and GitHub issue #94 "Success metrics".

This is a reporting helper only -- it computes ratios from whatever
evidence exists; it does not decide sample-size sufficiency (see
`evidence/adp-065-t05/README.md` for this run's own honest small-N
caveats, mirroring `docs/jev-decision-point-inventory.md` section 9.4's
"Calibration" caveat for DP-4).

Usage:
    python3 evidence_tools/summarize_kpi.py path/to/shadow_evidence.jsonl
"""
from __future__ import annotations

import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from evidence import read_evidence  # noqa: E402


def summarize(records: list[dict]) -> dict:
    total = len(records)
    by_dp = Counter(r["decision_point_label"] for r in records)
    fallback = [r for r in records if r["route"] == "fallback"]
    jev_only = [r for r in records if r["route"] == "jev_shadow"]
    objective = [r for r in records if r.get("objective") is True]
    objective_with_truth = [r for r in objective if r.get("ground_truth") is not None]
    objective_agree = [r for r in objective_with_truth if r.get("agrees_with_ground_truth")]
    total_cost = sum(r.get("cost_usd") or 0.0 for r in records)
    latencies = [r["latency_ms"] for r in records if r.get("latency_ms") is not None]

    return {
        "total_calls": total,
        "calls_by_decision_point": dict(by_dp),
        # "Jev-only decision candidates": calls that cleared threshold and
        # did not need a Claude/Chris/Human fallback.
        "jev_only_decision_candidates": len(jev_only),
        # "Claude / Chris fallback rate": the complement, as a fraction of
        # total calls (not just objective ones -- every call that falls
        # back counts, regardless of whether ground truth exists for it).
        "fallback_rate": (len(fallback) / total) if total else None,
        "fallback_reasons": dict(Counter(r.get("fallback_reason") for r in fallback)),
        # Accuracy is reported only over calls with known ground truth
        # (DP4-01/02/03/10-style objective cases); this intentionally
        # mirrors section 9.4's own Accuracy/Agreement split rather than
        # inventing a number for ambiguous-boundary cases that have no
        # single correct answer.
        "accuracy_over_objective_ground_truth": (
            (len(objective_agree) / len(objective_with_truth)) if objective_with_truth else None
        ),
        "objective_sample_size": len(objective_with_truth),
        "jev_cost_usd_total": round(total_cost, 6),
        "latency_ms_p50": _percentile(latencies, 50),
        "latency_ms_p95": _percentile(latencies, 95),
    }


def _percentile(values: list[float], pct: float):
    if not values:
        return None
    s = sorted(values)
    k = (len(s) - 1) * (pct / 100.0)
    f, c = int(k), min(int(k) + 1, len(s) - 1)
    if f == c:
        return s[f]
    return s[f] + (s[c] - s[f]) * (k - f)


def main(argv=None) -> int:
    argv = argv or sys.argv[1:]
    if len(argv) != 1:
        print("usage: summarize_kpi.py <evidence.jsonl>", file=sys.stderr)
        return 2
    records = read_evidence(argv[0])
    import json

    print(json.dumps(summarize(records), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
