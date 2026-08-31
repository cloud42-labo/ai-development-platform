"""Third round of regressions for hidden-region parsing in review_contract.py.

Covers three more Codex findings against the type-3/4/5/7 and multiline
code-span rounds: `search` missing from the type-6 tag list, an unmatched
backtick run wrongly assumed to always start a multiline code span (even
with no matching close anywhere in the paragraph), and type-7 detection
using the wrong signal ("was the previous line blank") instead of "is a
paragraph currently open" (a heading closes a paragraph without itself
being blank).
"""

from __future__ import annotations

import unittest

from review_contract import REQUIRED_SECTIONS, validate


class SearchTagRegression(unittest.TestCase):
    def test_search_tag_hides_headings_like_the_rest_of_the_type6_list(self):
        # `<search>` is CommonMark type 6 (like `<div>`), so -- unlike the
        # type-1 tags (pre/script/style/textarea) -- it's hidden through the
        # next blank line, not a matching closing tag; avoid blank lines
        # between the fake headings so the region stays hidden throughout.
        # Directly follows real prose with no blank line, so type 7's
        # fallback (which requires no open paragraph) does NOT apply here --
        # this specifically exercises type 6's own, paragraph-interruption-
        # tolerant membership list, not type 7's isolation-based rule.
        body = (
            "Real prose right here, with no blank line before the next line.\n"
            "<search>\n"
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
            "</search>\n"
        )
        failures = validate(body)
        for name in REQUIRED_SECTIONS:
            self.assertIn(f"missing heading: {name}", failures)


class UnmatchedBacktickRegression(unittest.TestCase):
    def test_an_unmatched_backtick_does_not_mask_a_real_comment_opener_after_it(self):
        # Codex-reported gap: a backtick with NO matching close anywhere in
        # the paragraph is not a code span at all under CommonMark -- it's
        # literal text. The old code assumed every EOL-unmatched backtick
        # started a genuine multiline span regardless, which wrongly masked
        # a REAL unterminated HTML comment on the next line as if it were
        # still inside that (nonexistent) span -- hiding it from detection
        # and leaving a fake contract inside it fully visible to validate().
        body = (
            "Text with unmatched `\n"
            "<!--\n"
            "\n"
            "### Purpose / Contract\n\nReal purpose.\n"
            "### Invariants\n\n- Real invariant.\n"
            "### Adversarial Scenarios\n\n- Real scenario.\n"
            "### Validation\n\n- Real validation.\n"
            "### Known Limitations / Non-goals\n\n- Real limitation.\n"
        )
        # The real headings above are inside an (unintentionally, but
        # genuinely) unterminated HTML comment opened by the literal `<!--`,
        # since the lone backtick before it was never a real code span --
        # so they must be reported missing, the same as any other
        # unterminated-comment case.
        failures = validate(body)
        for name in REQUIRED_SECTIONS:
            self.assertIn(f"missing heading: {name}", failures)

    def test_a_backtick_with_a_real_match_later_in_the_paragraph_still_masks(self):
        # Regression guard: the lookahead fix must not break the ALREADY-
        # covered genuine multiline-span case, where a matching close does
        # exist later in the same paragraph.
        body = (
            "### Purpose / Contract\n"
            "A multiline code span: `<!--\n"
            "still code`\n"
            "Real purpose text.\n"
            "### Invariants\n\n- Real invariant.\n"
            "### Adversarial Scenarios\n\n- Real scenario.\n"
            "### Validation\n\n- Real validation.\n"
            "### Known Limitations / Non-goals\n\n- Real limitation.\n"
        )
        self.assertEqual(validate(body), [])


class Type7ParagraphTrackingRegression(unittest.TestCase):
    def test_type7_can_start_right_after_a_heading_not_just_a_blank_line(self):
        # Codex-reported gap: a heading closes whatever paragraph preceded
        # it (it is its own block, not paragraph text) -- so a standalone
        # tag line immediately after a heading, with no blank line between,
        # is still eligible to start a type-7 HTML block. The old code used
        # "was the previous line blank" as its only signal, missing this.
        body = (
            "## Example\n"
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


if __name__ == "__main__":
    unittest.main()
