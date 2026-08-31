"""Focused regressions for hidden-region parsing in review_contract.py."""

from __future__ import annotations

import unittest

from review_contract import REQUIRED_SECTIONS, validate


class HiddenRegionRegressions(unittest.TestCase):
    def test_invalid_fence_close_suffix_does_not_expose_hidden_contract(self):
        body = (
            "```markdown\n"
            "```not-a-close\n"
            "### Purpose / Contract\nReal purpose.\n"
            "### Invariants\n- I1. Real invariant.\n"
            "### Adversarial Scenarios\n- A1. Real scenario.\n"
            "### Validation\n- Real validation.\n"
            "### Known Limitations / Non-goals\n- Real limitation.\n"
            "```\n"
        )
        failures = validate(body)
        for name in REQUIRED_SECTIONS:
            self.assertIn(f"missing heading: {name}", failures)

    def test_inline_code_html_comment_opener_is_literal(self):
        body = (
            "### Purpose / Contract\n"
            "Document the `<!--` opener literally.\n"
            "### Invariants\n- I1. Real invariant.\n"
            "### Adversarial Scenarios\n- A1. Real scenario.\n"
            "### Validation\n- Real validation.\n"
            "### Known Limitations / Non-goals\n- Real limitation.\n"
        )
        self.assertEqual(validate(body), [])

    def test_indented_code_html_comment_opener_is_literal(self):
        body = (
            "### Purpose / Contract\nReal purpose.\n"
            "    <!-- literal code, not a comment -->\n"
            "### Invariants\n- I1. Real invariant.\n"
            "### Adversarial Scenarios\n- A1. Real scenario.\n"
            "### Validation\n- Real validation.\n"
            "### Known Limitations / Non-goals\n- Real limitation.\n"
        )
        self.assertEqual(validate(body), [])


if __name__ == "__main__":
    unittest.main()
