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
from evidence import append_evidence, read_evidence  # noqa: E402


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


class DecideTests(unittest.TestCase):
    def test_high_confidence_routes_to_jev_shadow_and_is_never_auto_actionable(self):
        provider = FakeProvider(
            response=ProviderResponse(
                model="jev-1.13.0", model_version="jev-1.13.0", output_kind="choice",
                value="a", confidence=0.99, probabilities={"a": 0.99, "b": 0.01},
                latency_ms=120.0, input_tokens=100, output_tokens=10, cost_usd=0.0000042,
            )
        )
        result = decide(
            decision_point_id="dp_test", decision_point_version="1.0.0",
            state={"x": 1}, question=CHOICE_QUESTION, confidence_threshold=0.7,
            threshold_version="1.0.0", provider=provider, fallback_route="claude",
        )
        self.assertEqual(result.route, "jev_shadow")
        self.assertEqual(result.value, "a")
        self.assertFalse(result.below_threshold)
        self.assertIsNone(result.fallback_reason)
        # Hard invariant regardless of confidence: v1 never marks anything
        # auto-actionable.
        self.assertFalse(result.auto_actionable)
        self.assertEqual(result.mode, "shadow")

    def test_below_threshold_routes_to_configured_fallback(self):
        provider = FakeProvider(
            response=ProviderResponse(
                model="jev-1.13.0", model_version="jev-1.13.0", output_kind="choice",
                value="a", confidence=0.5, probabilities={"a": 0.5, "b": 0.5},
                latency_ms=120.0, input_tokens=100, output_tokens=10, cost_usd=0.0000042,
            )
        )
        result = decide(
            decision_point_id="dp_test", decision_point_version="1.0.0",
            state={"x": 1}, question=CHOICE_QUESTION, confidence_threshold=0.7,
            threshold_version="1.0.0", provider=provider, fallback_route="human",
        )
        self.assertEqual(result.route, "fallback")
        self.assertTrue(result.below_threshold)
        self.assertEqual(result.fallback_route, "human")
        self.assertEqual(result.fallback_reason, "below_threshold")

    def test_provider_error_routes_to_fallback_and_never_raises(self):
        provider = FakeProvider(error=ProviderError("timeout", "connection timed out"))
        result = decide(
            decision_point_id="dp_test", decision_point_version="1.0.0",
            state={"x": 1}, question=CHOICE_QUESTION, confidence_threshold=0.7,
            threshold_version="1.0.0", provider=provider, fallback_route="chris",
        )
        self.assertEqual(result.route, "fallback")
        self.assertEqual(result.fallback_route, "chris")
        self.assertEqual(result.fallback_reason, "provider_error:timeout")
        self.assertIsNone(result.model)
        self.assertIsNone(result.confidence)

    def test_invalid_fallback_route_rejected(self):
        provider = FakeProvider(response=None)
        with self.assertRaises(ValueError):
            decide(
                decision_point_id="dp_test", decision_point_version="1.0.0",
                state={}, question=CHOICE_QUESTION, confidence_threshold=0.7,
                threshold_version="1.0.0", provider=provider, fallback_route="not-a-real-actor",
            )

    def test_noul_is_never_auto_marked_below_threshold(self):
        provider = FakeProvider(
            response=ProviderResponse(
                model="jev-1.13.0", model_version="jev-1.13.0", output_kind="noul",
                value=0.3, confidence=None, probabilities=None,
                latency_ms=100.0, input_tokens=50, output_tokens=5, cost_usd=0.0000021,
            )
        )
        noul_question = TypedQuestion(output_kind="noul", instructions="yes/no?", criteria=None)
        result = decide(
            decision_point_id="dp_test", decision_point_version="1.0.0",
            state={}, question=noul_question, confidence_threshold=0.7,
            threshold_version="1.0.0", provider=provider, fallback_route="claude",
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
        result = decide(
            decision_point_id="dp_test", decision_point_version="1.0.0",
            state=secret_state, question=CHOICE_QUESTION, confidence_threshold=0.7,
            threshold_version="1.0.0", provider=provider, fallback_route="claude",
        )
        evidence_dict = result.to_evidence_dict()
        self.assertTrue(evidence_dict["input_hash"].startswith("sha256:"))
        self.assertNotIn("notion_task_text", str(evidence_dict))

    def test_same_state_hashes_identically_regardless_of_key_order(self):
        provider = FakeProvider(
            response=ProviderResponse(
                model="m", model_version="m", output_kind="choice", value="a",
                confidence=0.9, probabilities=None, latency_ms=1.0,
                input_tokens=1, output_tokens=1, cost_usd=0.0,
            )
        )
        r1 = decide(
            decision_point_id="dp", decision_point_version="1.0.0",
            state={"a": 1, "b": 2}, question=CHOICE_QUESTION, confidence_threshold=0.5,
            threshold_version="1.0.0", provider=provider, fallback_route="claude",
        )
        r2 = decide(
            decision_point_id="dp", decision_point_version="1.0.0",
            state={"b": 2, "a": 1}, question=CHOICE_QUESTION, confidence_threshold=0.5,
            threshold_version="1.0.0", provider=provider, fallback_route="claude",
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
        result = decide(
            decision_point_id="dp_test", decision_point_version="1.0.0",
            state={"x": 1}, question=CHOICE_QUESTION, confidence_threshold=0.7,
            threshold_version="1.0.0", provider=provider, fallback_route="claude",
        )
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "evidence.jsonl"
            append_evidence(path, result, decision_point_label="unit-test", ground_truth="a",
                             agrees_with_ground_truth=True, objective=True)
            append_evidence(path, result, decision_point_label="unit-test-2")
            records = read_evidence(path)
        self.assertEqual(len(records), 2)
        self.assertEqual(records[0]["decision_point_label"], "unit-test")
        self.assertTrue(records[0]["agrees_with_ground_truth"])
        self.assertIsNone(records[1]["ground_truth"])


if __name__ == "__main__":
    unittest.main()
