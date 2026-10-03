"""Unit tests for the vendor-neutral Decision Adapter core (no network calls).

Run with: python3 -m pytest adapters/decision-adapter/tests/ -q
(or plain `python3 -m unittest` from this directory -- no pytest-only
features are used).
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from decision_adapter import (  # noqa: E402
    ProviderError,
    ProviderResponse,
    TypedQuestion,
    decide,
)
from evidence import append_evidence_record, read_evidence  # noqa: E402


class FakeProvider:
    """A scripted provider: returns a fixed response or raises a fixed error."""

    def __init__(self, response=None, error=None):
        self._response = response
        self._error = error
        self.calls = []

    def call(self, decision_point_id, state, question):
        self.calls.append((decision_point_id, state, question))
        if self._error is not None:
            raise self._error
        return self._response


CHOICE_QUESTION = TypedQuestion(
    output_kind="choice",
    instructions="pick one",
    criteria={"a": "option a", "b": "option b"},
)


def _decide(evidence_sink=None, **kwargs):
    """Test helper: supplies decision_point_label/evidence_sink defaults so
    call sites below stay focused on what each test actually varies."""
    kwargs.setdefault("decision_point_id", "dp_test")
    kwargs.setdefault("decision_point_version", "1.0.0")
    kwargs.setdefault("threshold_version", "1.0.0")
    kwargs.setdefault("decision_point_label", "unit-test")
    sink = evidence_sink if evidence_sink is not None else []
    return decide(evidence_sink=sink.append if isinstance(sink, list) else sink, **kwargs), sink


class DecideTests(unittest.TestCase):
    def test_high_confidence_routes_to_jev_shadow_and_is_never_auto_actionable(self):
        provider = FakeProvider(
            response=ProviderResponse(
                model="jev-1.13.0", model_version="jev-1.13.0", output_kind="choice",
                value="a", confidence=0.99, probabilities={"a": 0.99, "b": 0.01},
                latency_ms=120.0, input_tokens=100, output_tokens=10, cost_usd=0.0000042,
            )
        )
        result, sink = _decide(
            state={"x": 1}, question=CHOICE_QUESTION, confidence_threshold=0.7,
            provider=provider, fallback_route="claude",
        )
        self.assertEqual(result.route, "jev_shadow")
        self.assertEqual(result.value, "a")
        self.assertFalse(result.below_threshold)
        self.assertIsNone(result.fallback_reason)
        # Hard invariant regardless of confidence: v1 never marks anything
        # auto-actionable.
        self.assertFalse(result.auto_actionable)
        self.assertEqual(result.mode, "shadow")
        # Every call must produce exactly one evidence record.
        self.assertEqual(len(sink), 1)
        self.assertEqual(sink[0]["route"], "jev_shadow")

    def test_below_threshold_routes_to_configured_fallback(self):
        provider = FakeProvider(
            response=ProviderResponse(
                model="jev-1.13.0", model_version="jev-1.13.0", output_kind="choice",
                value="a", confidence=0.5, probabilities={"a": 0.5, "b": 0.5},
                latency_ms=120.0, input_tokens=100, output_tokens=10, cost_usd=0.0000042,
            )
        )
        result, sink = _decide(
            state={"x": 1}, question=CHOICE_QUESTION, confidence_threshold=0.7,
            provider=provider, fallback_route="human",
        )
        self.assertEqual(result.route, "fallback")
        self.assertTrue(result.below_threshold)
        self.assertEqual(result.fallback_route, "human")
        self.assertEqual(result.fallback_reason, "below_threshold")
        self.assertEqual(len(sink), 1)

    def test_provider_error_routes_to_fallback_and_never_raises(self):
        provider = FakeProvider(error=ProviderError("timeout", "connection timed out"))
        result, sink = _decide(
            state={"x": 1}, question=CHOICE_QUESTION, confidence_threshold=0.7,
            provider=provider, fallback_route="chris",
        )
        self.assertEqual(result.route, "fallback")
        self.assertEqual(result.fallback_route, "chris")
        self.assertEqual(result.fallback_reason, "provider_error:timeout")
        self.assertIsNone(result.model)
        self.assertIsNone(result.confidence)
        # Evidence must still be written even though the provider failed.
        self.assertEqual(len(sink), 1)
        self.assertEqual(sink[0]["fallback_reason"], "provider_error:timeout")

    def test_invalid_fallback_route_rejected(self):
        provider = FakeProvider(response=None)
        with self.assertRaises(ValueError):
            _decide(
                state={}, question=CHOICE_QUESTION, confidence_threshold=0.7,
                provider=provider, fallback_route="not-a-real-actor",
            )

    def test_missing_evidence_sink_and_path_rejected_before_calling_provider(self):
        provider = FakeProvider(response=None)
        with self.assertRaises(ValueError):
            decide(
                decision_point_id="dp_test", decision_point_version="1.0.0",
                state={}, question=CHOICE_QUESTION, confidence_threshold=0.7,
                threshold_version="1.0.0", provider=provider, fallback_route="claude",
                decision_point_label="unit-test",
            )
        # The provider must never be called when the evidence requirement
        # fails fast -- a caller cannot pay for a call it is guaranteed to
        # be unable to log.
        self.assertEqual(provider.calls, [])

    def test_choice_value_outside_criteria_is_out_of_bounds_not_jev_shadow(self):
        provider = FakeProvider(
            response=ProviderResponse(
                model="jev-1.13.0", model_version="jev-1.13.0", output_kind="choice",
                value="not-a-real-option", confidence=0.99, probabilities=None,
                latency_ms=10.0, input_tokens=1, output_tokens=1, cost_usd=0.0,
            )
        )
        result, sink = _decide(
            state={}, question=CHOICE_QUESTION, confidence_threshold=0.7,
            provider=provider, fallback_route="claude",
        )
        self.assertEqual(result.route, "fallback")
        self.assertTrue(result.below_threshold)
        self.assertTrue(result.fallback_reason.startswith("out_of_bounds:"))
        self.assertEqual(len(sink), 1)

    def test_score_outside_api_scale_is_out_of_bounds(self):
        score_question = TypedQuestion(output_kind="score", instructions="rate it", criteria=["low", "high"])
        provider = FakeProvider(
            response=ProviderResponse(
                model="jev-1.13.0", model_version="jev-1.13.0", output_kind="score",
                value=99, confidence=0.9, probabilities=None,
                latency_ms=10.0, input_tokens=1, output_tokens=1, cost_usd=0.0,
            )
        )
        result, _ = _decide(
            state={}, question=score_question, confidence_threshold=0.7,
            provider=provider, fallback_route="chris",
        )
        self.assertEqual(result.route, "fallback")
        self.assertTrue(result.fallback_reason.startswith("out_of_bounds:"))

    def test_noul_outside_unit_interval_is_out_of_bounds(self):
        noul_question = TypedQuestion(output_kind="noul", instructions="yes/no?", criteria=None)
        provider = FakeProvider(
            response=ProviderResponse(
                model="jev-1.13.0", model_version="jev-1.13.0", output_kind="noul",
                value=1.5, confidence=None, probabilities=None,
                latency_ms=10.0, input_tokens=1, output_tokens=1, cost_usd=0.0,
            )
        )
        result, _ = _decide(
            state={}, question=noul_question, confidence_threshold=0.7,
            provider=provider, fallback_route="claude",
        )
        self.assertEqual(result.route, "fallback")
        self.assertTrue(result.fallback_reason.startswith("out_of_bounds:"))

    def test_malformed_confidence_is_out_of_bounds(self):
        provider = FakeProvider(
            response=ProviderResponse(
                model="jev-1.13.0", model_version="jev-1.13.0", output_kind="choice",
                value="a", confidence="very sure", probabilities=None,  # wrong type on purpose
                latency_ms=10.0, input_tokens=1, output_tokens=1, cost_usd=0.0,
            )
        )
        result, _ = _decide(
            state={}, question=CHOICE_QUESTION, confidence_threshold=0.7,
            provider=provider, fallback_route="claude",
        )
        self.assertEqual(result.route, "fallback")
        self.assertTrue(result.fallback_reason.startswith("out_of_bounds:"))

    def test_noul_is_never_auto_marked_below_threshold(self):
        provider = FakeProvider(
            response=ProviderResponse(
                model="jev-1.13.0", model_version="jev-1.13.0", output_kind="noul",
                value=0.3, confidence=None, probabilities=None,
                latency_ms=100.0, input_tokens=50, output_tokens=5, cost_usd=0.0000021,
            )
        )
        noul_question = TypedQuestion(output_kind="noul", instructions="yes/no?", criteria=None)
        result, _ = _decide(
            state={}, question=noul_question, confidence_threshold=0.7,
            provider=provider, fallback_route="claude",
        )
        self.assertEqual(result.route, "jev_shadow")
        self.assertEqual(result.value, 0.3)

    def test_state_is_hashed_not_logged_verbatim(self):
        provider = FakeProvider(
            response=ProviderResponse(
                model="jev-1.13.0", model_version="jev-1.13.0", output_kind="choice",
                value="a", confidence=0.9, probabilities=None,
                latency_ms=1.0, input_tokens=1, output_tokens=1, cost_usd=0.0,
            )
        )
        secret_state = {"notion_task_text": "something not meant for evidence files"}
        result, sink = _decide(
            state=secret_state, question=CHOICE_QUESTION, confidence_threshold=0.7,
            provider=provider, fallback_route="claude",
        )
        evidence_dict = result.to_evidence_dict()
        self.assertTrue(evidence_dict["input_hash"].startswith("sha256:"))
        self.assertNotIn("notion_task_text", str(evidence_dict))
        self.assertNotIn("notion_task_text", str(sink[0]))

    def test_same_state_hashes_identically_regardless_of_key_order(self):
        provider = FakeProvider(
            response=ProviderResponse(
                model="m", model_version="m", output_kind="choice", value="a",
                confidence=0.9, probabilities=None, latency_ms=1.0,
                input_tokens=1, output_tokens=1, cost_usd=0.0,
            )
        )
        r1, _ = _decide(
            decision_point_id="dp", state={"a": 1, "b": 2}, question=CHOICE_QUESTION,
            confidence_threshold=0.5, provider=provider, fallback_route="claude",
        )
        r2, _ = _decide(
            decision_point_id="dp", state={"b": 2, "a": 1}, question=CHOICE_QUESTION,
            confidence_threshold=0.5, provider=provider, fallback_route="claude",
        )
        self.assertEqual(r1.input_hash, r2.input_hash)


class EvidenceTests(unittest.TestCase):
    def test_append_and_read_roundtrip(self):
        import tempfile

        provider = FakeProvider(
            response=ProviderResponse(
                model="jev-1.13.0", model_version="jev-1.13.0", output_kind="choice",
                value="a", confidence=0.95, probabilities={"a": 0.95, "b": 0.05},
                latency_ms=200.0, input_tokens=10, output_tokens=2, cost_usd=0.00000042,
            )
        )
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "evidence.jsonl"
            decide(
                decision_point_id="dp_test", decision_point_version="1.0.0",
                state={"x": 1}, question=CHOICE_QUESTION, confidence_threshold=0.7,
                threshold_version="1.0.0", provider=provider, fallback_route="claude",
                decision_point_label="unit-test", evidence_path=path,
                ground_truth="a", objective=True,
            )
            # A second, differently-labeled call for a *different* decision
            # point appends rather than overwrites.
            append_evidence_record(
                path,
                {"decision_point_id": "dp_other", "decision_point_label": "unit-test-2",
                 "objective": None, "ground_truth": None, "agrees_with_ground_truth": None},
            )
            records = read_evidence(path)
        self.assertEqual(len(records), 2)
        self.assertEqual(records[0]["decision_point_label"], "unit-test")
        self.assertTrue(records[0]["agrees_with_ground_truth"])
        self.assertIsNone(records[1]["ground_truth"])


if __name__ == "__main__":
    unittest.main()
