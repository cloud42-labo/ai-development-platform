"""Evidence/audit logging for Decision Adapter shadow calls.

One JSON object per line (JSONL), appended -- never rewritten -- so a
partial run never loses previously-recorded evidence (same append-only
principle `evidence/adp-065-t03/jev_dp4_poc.py` already used for its own
checkpoint file). Each line is a `DecisionResult.to_evidence_dict()` plus
the fields `decide()` itself cannot know on its own: `decision_point_label`
(a descriptive tag for a specific fixture/call, kept separate from the
authoritative `decision_point_id` grouping key -- see
`evidence_tools/summarize_kpi.py`), `objective`/`ground_truth` (only when
the caller has independent ground truth to compare against -- None
otherwise), and `agrees_with_ground_truth`. Never log the raw `state`
payload; `DecisionResult` already carries only its hash.

This module intentionally does not import `decision_adapter` (it takes
plain dicts, not a `DecisionResult` object) so that `decision_adapter.py`
can import `append_evidence_record`/`build_evidence_record` from here
without a circular import -- `decide()` is the only place in this package
that is allowed to call `append_evidence_record` as part of producing a
result (see `decision_adapter.py`'s "Hard constraints").
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Optional


def build_evidence_record(
    result_dict: dict,
    decision_point_label: str,
    objective: Optional[bool] = None,
    ground_truth: Optional[str] = None,
    agrees_with_ground_truth: Optional[bool] = None,
) -> dict:
    record = dict(result_dict)
    record["decision_point_label"] = decision_point_label
    record["objective"] = objective
    record["ground_truth"] = ground_truth
    record["agrees_with_ground_truth"] = agrees_with_ground_truth
    return record


def append_evidence_record(path: str | Path, record: dict) -> None:
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
