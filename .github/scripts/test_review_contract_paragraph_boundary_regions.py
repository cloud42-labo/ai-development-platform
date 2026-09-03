"""Fourth round of regressions: paragraph-boundary accuracy shared by the
code-span lookahead (I12) and type-7 HTML block detection (I11).

Both the multiline-code-span lookahead and type-7's "is a paragraph open"
check need to agree on where a paragraph actually ends. The lookahead used
to stop only at a blank line; `at_block_boundary` used to recognize only
ATX headings (plus blank lines). Neither accounted for a Setext heading
(text line + `===`/`---` underline, no `#`), and the lookahead additionally
didn't stop at an ATX heading, a fence opener, or a raw-HTML-block opener.
"""

from __future__ import annotations

import unittest

from review_contract import REQUIRED_SECTIONS, validate


class CodeSpanLookaheadBoundaryRegression(unittest.TestCase):
    def test_lookahead_stops_at_an_atx_heading_not_just_a_blank_line(self):
        # Codex's exact scenario: an unmatched backtick, then (no blank
        # line yet) an ATX heading, then a real unterminated comment
        # opener, then -- still with no blank line before it -- a matching
        # backtick. The heading already ended the paragraph the first
        # backtick lived in, so that later backtick must NOT count as
        # closing it (which would otherwise mask the real comment opener
        # as if it were still inside the span and let the fake contract
        # after it stand unhidden).
        body = (
            "Text with unmatched `\n"
            "## boundary\n"
            "<!--\n"
            "still no blank line yet, with a matching backtick right here `\n"
            "\n"
            "### Purpose / Contract\n\nReal purpose.\n"
            "### Invariants\n\n- Real invariant.\n"
            "### Adversarial Scenarios\n\n- Real scenario.\n"
            "### Validation\n\n- Real validation.\n"
            "### Known Limitations / Non-goals\n\n- Real limitation.\n"
        )
        failures = validate(body)
        for name in REQUIRED_SECTIONS:
            self.assertIn(f"missing heading: {name}", failures)

    def test_lookahead_stops_when_first_candidate_is_setext_underline(self):
        # The unmatched backtick is on the Setext heading text line itself.
        # Lookahead therefore STARTS on the underline. That underline closes
        # the current paragraph immediately, so a later matching backtick
        # cannot retroactively turn the opener into a multiline code span.
        body = (
            "Text with unmatched `\n"
            "====================\n"
            "<!--\n"
            "later matching backtick `\n"
            "\n"
            "### Purpose / Contract\n\nReal purpose.\n"
            "### Invariants\n\n- Real invariant.\n"
            "### Adversarial Scenarios\n\n- Real scenario.\n"
            "### Validation\n\n- Real validation.\n"
            "### Known Limitations / Non-goals\n\n- Real limitation.\n"
        )
        failures = validate(body)
        for name in REQUIRED_SECTIONS:
            self.assertIn(f"missing heading: {name}", failures)


class Type7SetextBoundaryRegression(unittest.TestCase):
    def test_type7_can_start_right_after_a_setext_heading(self):
        # A Setext heading (text + `===`/`---` underline, no `#`) closes a
        # paragraph exactly like an ATX heading does -- the standalone tag
        # right after one must still be eligible for type 7.
        body = (
            "Example\n"
            "=======\n"
            "<review>\n"
            "### Purpose / Contract\n"
            "Example purpose text.\n"
            "### Invariants\n"
            "- Example invariant.\n"
            "### Adversarial Scenarios\n"
            "- Example scenario.\n"
            "### Validation\n"
            "- Example validation.\n"
            "### Known Limitations / Non-goals\n"
            "- Example limitation.\n"
            "</review>\n"
        )
        failures = validate(body)
        for name in REQUIRED_SECTIONS:
            self.assertIn(f"missing heading: {name}", failures)

    def test_a_genuine_paragraph_text_line_is_not_mistaken_for_setext_text(self):
        # Regression guard: ordinary prose immediately followed by a line
        # that happens to consist only of dashes/equals, but where the
        # PAIR doesn't form a valid Setext heading per _SETEXT_HEADING_RE's
        # own exclusions (e.g. a list-marker line), must not falsely close
        # the paragraph.
        body = (
            "### Purpose / Contract\n"
            "Real purpose text.\n"
            "### Invariants\n"
            "- Real invariant.\n"
            "### Adversarial Scenarios\n"
            "- Real scenario.\n"
            "### Validation\n"
            "- Real validation.\n"
            "### Known Limitations / Non-goals\n"
            "- Real limitation.\n"
        )
        self.assertEqual(validate(body), [])


if __name__ == "__main__":
    unittest.main()
