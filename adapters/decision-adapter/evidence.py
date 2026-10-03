"""Evidence/audit logging for Decision Adapter shadow calls.

One JSON object per line (JSONL), appended -- never rewritten -- so a
partial run never loses previously-recorded evidence (same append-only
principle `evidence/adp-065-t03/jev_dp4_poc.py` already used for its own
checkpoint file). Each line is exactly `DecisionResult.to_evidence_dict()`
plus the two fields `decide()` itself cannot know: `decision_point_label`
(a human-readable tag for the KPI summarizer) and `objective` (True/False,
only when the caller has independent ground truth to compare against --
None otherwise). Never log the raw `state` payload; `DecisionResult`
already carries only its hash.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

from decision_adapter import DecisionResult


def append_evidence(
    path: str | Path,
    result: DecisionResult,
    decision_point_label: str,
    objective: Optional[bool] = None,
    ground_truth: Optional[str] = None,
    agrees_with_ground_truth: Optional[bool] = None,
) -> None:
    record = result.to_evidence_dict()
    record["decision_point_label"] = decision_point_label
    record["objective"] = objective
    record["ground_truth"] = ground_truth
    record["agrees_with_ground_truth"] = agrees_with_ground_truth

    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


def read_evidence(path: str | Path) -> list[dict]:
    p = Path(path)
    if not p.exists():
        return []
    with p.open(encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]
