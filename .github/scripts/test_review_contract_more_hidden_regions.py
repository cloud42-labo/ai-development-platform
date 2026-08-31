"""Further regressions for hidden-region parsing in review_contract.py.

Covers three Codex findings against the raw-HTML-block and code-span-masking
rounds: CommonMark HTML block types 3-5 and 7 (only 1/6 were covered before),
and a code span whose closing delimiter lands on a later line than its
opener (masking previously ran per-line only, so the opener's line leaked an
unmasked `<!--` and hid every real section after it through EOF).
"""

from __future__ import annotations

import unittest

from review_contract import REQUIRED_SECTIONS, validate


def _wrap(open_tag: str, close_tag: str) -> str:
    return (
        "Here is what the template looks like:\n"
        + open_tag + "\n"
        "### Purpose / Contract\n\nExample purpose text.\n\n"
        "### Invariants\n\n- Example invariant.\n\n"
        "### Adversarial Scenarios\n\n- Example scenario.\n\n"
        "### Validation\n\n- Example validation.\n\n"
        "### Known Limitations / Non-goals\n\n- Example limitation.\n"
        + close_tag + "\n"
    )


class HtmlBlockTypeRegressions(unittest.TestCase):
    def test_type3_processing_instruction_hides_headings_inside_it(self):
        failures = validate(_wrap("<?review", "?>"))
        for name in REQUIRED_SECTIONS:
            self.assertIn(f"missing heading: {name}", failures)

    def test_type4_declaration_hides_headings_inside_it(self):
        failures = validate(_wrap("<!DOCTYPE html", ">"))
        for name in REQUIRED_SECTIONS:
            self.assertIn(f"missing heading: {name}", failures)

    def test_type5_cdata_hides_headings_inside_it(self):
        failures = validate(_wrap("<![CDATA[", "]]>"))
        for name in REQUIRED_SECTIONS:
            self.assertIn(f"missing heading: {name}", failures)

    def test_type7_standalone_custom_tag_hides_headings_inside_it(self):
        # `review` is not one of the type-6 block tags, but a tag alone on
        # its own line, preceded by a blank line (here: start of body),
        # still starts a hidden HTML block under CommonMark's type 7. Unlike
        # type 1 (pre/script/style/textarea), type 7 ends at the next blank
        # line, not a closing tag -- so this fixture avoids blank lines
        # between the fake headings, matching how CommonMark actually scopes
        # the hidden region (a blank line inside would end it early).
        body = (
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

    def test_type7_tag_not_preceded_by_a_blank_line_does_not_hide(self):
        # Type 7 explicitly cannot interrupt an existing paragraph -- a
        # standalone-looking tag line directly after real prose (no blank
        # line between) must NOT start a hidden region.
        body = (
            "Some real prose text right here, not a blank line before next.\n"
            "<review>\n"
            "### Purpose / Contract\n\nReal purpose that must stay visible.\n"
            "### Invariants\n\n- Real invariant.\n"
            "### Adversarial Scenarios\n\n- Real scenario.\n"
            "### Validation\n\n- Real validation.\n"
            "### Known Limitations / Non-goals\n\n- Real limitation.\n"
        )
        self.assertEqual(validate(body), [])

    def test_type7_tag_with_trailing_content_on_the_same_line_does_not_hide(self):
        # Type 7 requires the ENTIRE line to be just the one tag -- a line
        # that also carries real prose after the tag is not a match.
        body = (
            "\n"
            "<review>real content after an inline-looking custom tag</review>\n"
            "### Purpose / Contract\n\nReal purpose.\n"
            "### Invariants\n\n- Real invariant.\n"
            "### Adversarial Scenarios\n\n- Real scenario.\n"
            "### Validation\n\n- Real validation.\n"
            "### Known Limitations / Non-goals\n\n- Real limitation.\n"
        )
        self.assertEqual(validate(body), [])


class MultilineCodeSpanRegressions(unittest.TestCase):
    def test_a_code_span_closing_on_a_later_line_masks_its_own_opener_line_too(self):
        # Codex-reported gap: `_mask_inline_code_spans` used to mask each
        # line independently, so a code span's OPENING line -- containing a
        # literal `<!--` inside the (still-open) span -- was left unmasked
        # on that line, wrongly starting HTML-comment state and hiding every
        # real section after it through EOF.
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

    def test_a_same_line_comment_before_an_unclosed_span_does_not_corrupt_span_state(self):
        # Adversarial case for the stateful mask function's own call
        # discipline: a line with an ordinary same-line HTML comment
        # (opens and closes within the line) FOLLOWED by a code span that
        # is genuinely unclosed till EOL. If `_mask_inline_code_spans` were
        # called a second time for this same physical line (once up front,
        # then again after the comment's close is found mid-line), the
        # second call would re-scan from position 0 with `span_state`
        # already mutated by the first call, misreading the span's own
        # OPENING backtick as if it were a stray CLOSING one and silently
        # unmasking real comment text. Must resolve correctly regardless.
        body = (
            "### Purpose / Contract\n"
            "a <!--x--> b `unclosed\n"
            "still unclosed here, with a literal <!-- inside it too`\n"
            "Real text after the span closes.\n"
            "### Invariants\n\n- Real invariant.\n"
            "### Adversarial Scenarios\n\n- Real scenario.\n"
            "### Validation\n\n- Real validation.\n"
            "### Known Limitations / Non-goals\n\n- Real limitation.\n"
        )
        self.assertEqual(validate(body), [])

    def test_an_unclosed_code_span_resets_at_a_blank_line(self):
        # A lone, never-closed backtick run must not hide an entire later
        # section forever -- a blank line ends the paragraph the span's
        # inline parsing happens within, so span state resets there.
        body = (
            "### Purpose / Contract\n"
            "An unclosed span starts here: `oops\n"
            "\n"
            "### Invariants\n\n- Real invariant, with a literal `<!--` in it.\n"
            "### Adversarial Scenarios\n\n- Real scenario.\n"
            "### Validation\n\n- Real validation.\n"
            "### Known Limitations / Non-goals\n\n- Real limitation.\n"
        )
        self.assertEqual(validate(body), [])


if __name__ == "__main__":
    unittest.main()
