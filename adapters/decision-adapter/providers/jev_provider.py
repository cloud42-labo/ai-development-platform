"""Jev (TypeSafe AI System One) DecisionProvider implementation.

Schema confirmed live (not assumed) in
`docs/jev-decision-point-inventory.md` section 9.2 (`ADP-065-T03`,
2026-09-28 JST): `POST https://api.typesafe.ai/v1/systemone` takes
`{model, state, questions}` where `questions` is a dict of named
Choice/Score/Noul questions, and returns `{model, answers, usage}`.
No sampling parameters (temperature/top_p/seed) exist on this API --
do not add them here; see that section for why.

Authentication: this provider does not assume one fixed way to get a key
into the request, because this file runs in more than one execution
environment:

- Some environments (e.g. this repository's own `ADP-065-T03` PoC,
  `evidence/adp-065-t03/jev_dp4_poc.py`) inject the key as the
  `TYPESAFE_API_KEY` environment variable, and the caller must set a
  `Bearer` header itself.
- Other environments (confirmed live for `ADP-065-T05`'s own smoke test,
  see `evidence/adp-065-t05/README.md`) route `api.typesafe.ai` through a
  policy-enforcing egress proxy that injects the credential transparently
  -- an explicit Authorization header is neither required nor present.

This provider therefore sends a `Bearer` header only when
`TYPESAFE_API_KEY` is set in the environment, and otherwise sends the
request unauthenticated at this layer, relying on whatever
transport-level credential injection the execution environment provides.
It never raises merely because the env var is absent (unlike the older
single-environment PoC script) -- only an actual non-200 response or
transport failure is a `ProviderError`.
"""
from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request

from decision_adapter import ProviderError, ProviderResponse, TypedQuestion

API_URL = "https://api.typesafe.ai/v1/systemone"

# Explicit fixed version, not the rolling "jev-latest" alias -- confirmed
# accepted directly by the live API even though GET /v1/models only lists
# rolling aliases (section 9.2). Pin this so a silent upstream model swap
# cannot change shadow-mode behavior without a deliberate version bump here.
MODEL = "jev-1.13.0"

# $0.042 / MTok input, output free (docs/jev-decision-point-inventory.md
# header recap, confirmed unchanged by the section 9.2 usage fields).
_INPUT_COST_PER_TOKEN = 0.042 / 1_000_000.0

_TIMEOUT_SECONDS = 60


class JevProvider:
    """Concrete `DecisionProvider` for Jev. One instance is stateless/reusable."""

    def __init__(self, api_url: str = API_URL, model: str = MODEL, timeout: float = _TIMEOUT_SECONDS):
        self._api_url = api_url
        self._model = model
        self._timeout = timeout

    def call(self, decision_point_id: str, state: dict, question: TypedQuestion) -> ProviderResponse:
        payload = {
            "model": self._model,
            "state": state,
            "questions": {
                decision_point_id: {
                    "type": question.output_kind,
                    "instructions": question.instructions,
                    "criteria": question.criteria,
                }
            },
        }
        headers = {"Content-Type": "application/json"}
        api_key = os.environ.get("TYPESAFE_API_KEY")
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"

        req = urllib.request.Request(
            self._api_url,
            data=json.dumps(payload).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        t0 = time.monotonic()
        try:
            with urllib.request.urlopen(req, timeout=self._timeout) as resp:
                raw = resp.read()
                status = resp.status
        except urllib.error.HTTPError as exc:
            raise ProviderError("http_error", f"HTTP {exc.code}: {exc.read()[:500]!r}") from exc
        except urllib.error.URLError as exc:
            raise ProviderError("connection_error", str(exc.reason)) from exc
        except TimeoutError as exc:
            raise ProviderError("timeout", str(exc)) from exc
        latency_ms = (time.monotonic() - t0) * 1000.0

        if status != 200:
            raise ProviderError("non_200_status", f"status={status} body={raw[:500]!r}")

        try:
            body = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ProviderError("invalid_json", str(exc)) from exc

        try:
            answer = body["answers"][decision_point_id]
            model_used = body["model"]
            usage = body["usage"]
        except KeyError as exc:
            raise ProviderError("unexpected_response_shape", f"missing key {exc}") from exc

        value, confidence, probabilities = _parse_answer(question.output_kind, answer)
        input_tokens = usage.get("input_tokens", 0)
        output_tokens = usage.get("output_tokens", 0)

        return ProviderResponse(
            model=model_used,
            model_version=model_used,  # Jev's `model` field IS the fixed version string (section 9.2).
            output_kind=question.output_kind,
            value=value,
            confidence=confidence,
            probabilities=probabilities,
            latency_ms=latency_ms,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cost_usd=input_tokens * _INPUT_COST_PER_TOKEN,
        )


def _parse_answer(output_kind: str, answer: dict):
    try:
        if output_kind == "choice":
            return answer["choice"], answer["confidence"], answer.get("probabilities")
        if output_kind == "score":
            return answer["score"], answer["confidence"], answer.get("probabilities")
        if output_kind == "noul":
            # No confidence field exists for Noul (section 9.2) -- the
            # probability itself is the value a Decision Point's own logic
            # thresholds, not a separate confidence score.
            return answer["noul"], None, None
    except KeyError as exc:
        raise ProviderError("unexpected_response_shape", f"answer missing key {exc}") from exc
    raise ProviderError("unknown_output_kind", output_kind)
