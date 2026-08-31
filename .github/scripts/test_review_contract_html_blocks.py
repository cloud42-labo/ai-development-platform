"""Regression for raw-HTML-block hiding in review_contract.py.

Codex-reported gap: a PR body can place the five required `###` headings
and plausible content inside a raw HTML block (e.g. `<pre>...</pre>` with no
blank line before it). CommonMark renders that whole block as literal
HTML/code, never as real Markdown sections -- but `_strip_hidden_regions`
only ever hid fenced code blocks and HTML comments, so `_ATX_HEADING_RE`
still found every `###` line inside the `<pre>` block as a real heading and
`validate()` returned success for a PR body with no actual contract at all.
"""

from __future__ import annotations

import unittest

from review_contract import REQUIRED_SECTIONS, split_sections, validate


class HtmlBlockRegressions(unittest.TestCase):
    def test_headings_inside_a_pre_block_are_not_boundaries_or_content(self):
        body = (
            "Here is what the template looks like:\n"
            "<pre>\n"
            "### Purpose / Contract\n\nExample purpose text.\n\n"
            "### Invariants\n\n- Example invariant.\n\n"
            "### Adversarial Scenarios\n\n- Example scenario.\n\n"
            "### Validation\n\n- Example validation.\n\n"
            "### Known Limitations / Non-goals\n\n- Example limitation.\n"
            "</pre>\n"
        )
        failures = validate(body)
        for name in REQUIRED_SECTIONS:
            self.assertIn(f"missing heading: {name}", failures)

    def test_headings_inside_a_div_block_hidden_until_blank_line(self):
        # A non-pre-like block tag (div) terminates at the next blank line,
        # per CommonMark's type-6 HTML block rule -- not at a closing tag.
        body = (
            "<div>\n"
            "### Purpose / Contract\n\nHidden.\n"
            "\n"
            "### Purpose / Contract\n\nReal purpose, after the blank line.\n"
            "### Invariants\n\n- Real invariant.\n"
            "### Adversarial Scenarios\n\n- Real scenario.\n"
            "### Validation\n\n- Real validation.\n"
            "### Known Limitations / Non-goals\n\n- Real limitation.\n"
        )
        self.assertEqual(validate(body), [])

    def test_a_real_heading_immediately_after_a_pre_block_is_still_found(self):
        body = (
            "<pre>\nsome literal code\n</pre>\n\n"
            "### Known Limitations / Non-goals\n\nReal limitation text.\n"
        )
        sections = {s.name: s.content for s in split_sections(body) if s.level == 3}
        self.assertIn("Real limitation text", sections["Known Limitations / Non-goals"])

    def test_ordinary_inline_html_like_br_is_not_treated_as_a_block(self):
        # `br` is an inline-level tag: not one of the type-6 block tags, and
        # here it also appears inline within a real prose line rather than
        # alone on its own line, so it satisfies neither type 6 (wrong tag
        # name) nor type 7 (the whole line must be just the one tag) --
        # unlike a standalone `<br>` line right after a heading, which type 7
        # *would* legitimately hide under CommonMark (see the type7 tests in
        # test_review_contract_more_hidden_regions.py): a heading closes
        # whatever paragraph preceded it, so the line after one is eligible
        # to start a type-7 block same as after a blank line.
        body = (
            "### Purpose / Contract\n"
            "Real purpose text with an inline <br> tag in the middle of it.\n"
            "### Invariants\n\n- Real invariant.\n"
            "### Adversarial Scenarios\n\n- Real scenario.\n"
            "### Validation\n\n- Real validation.\n"
            "### Known Limitations / Non-goals\n\n- Real limitation.\n"
        )
        self.assertEqual(validate(body), [])


if __name__ == "__main__":
    unittest.main()
