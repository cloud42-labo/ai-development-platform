"""Regression tests for review_contract.py.

Run directly: python3 .github/scripts/test_review_contract.py
Or via unittest discovery: python3 -m unittest discover -s .github/scripts
"""

from __future__ import annotations

import unittest

from review_contract import REQUIRED_SECTIONS, is_section_empty, split_sections, validate

COMPLETE_BODY = """## Summary

Some summary text.

## Review Contract

### Purpose / Contract

Real purpose text.

### Invariants

- I1. Real invariant.

### Adversarial Scenarios

- A1. Real scenario.

### Validation

- Real validation mapping.

### Known Limitations / Non-goals

- Real limitation.

## References

- Notion link.
"""


class ValidateCompleteBody(unittest.TestCase):
    def test_complete_body_passes(self):
        self.assertEqual(validate(COMPLETE_BODY), [])


class SectionBoundaryScenarios(unittest.TestCase):
    """A1-style regression: the final required section must never absorb a
    later, unrelated heading's content -- regardless of that heading's own
    level -- and must correctly fail when it is genuinely empty.
    """

    def _body_with_empty_final_section(self, trailer: str) -> str:
        return (
            "## Review Contract\n\n"
            "### Purpose / Contract\n\nReal purpose.\n\n"
            "### Invariants\n\n- I1. Real invariant.\n\n"
            "### Adversarial Scenarios\n\n- A1. Real scenario.\n\n"
            "### Validation\n\n- Real validation.\n\n"
            "### Known Limitations / Non-goals\n\n"
            "<!-- Intentionally deferred behavior or scope boundaries. -->\n\n"
            + trailer
        )

    def test_empty_final_section_followed_by_references_heading_fails(self):
        # The exact Codex-reported P1: `## References` must not be absorbed
        # as content of `Known Limitations / Non-goals`.
        body = self._body_with_empty_final_section(
            "## References\n\n- https://example.com/real-link\n"
        )
        failures = validate(body)
        self.assertIn("empty section: Known Limitations / Non-goals", failures)

    def test_empty_final_section_followed_by_h1_fails(self):
        body = self._body_with_empty_final_section("# Appendix\n\nSome appendix text.\n")
        failures = validate(body)
        self.assertIn("empty section: Known Limitations / Non-goals", failures)

    def test_empty_final_section_at_true_end_of_body_fails(self):
        body = self._body_with_empty_final_section("")
        failures = validate(body)
        self.assertIn("empty section: Known Limitations / Non-goals", failures)

    def test_non_final_section_stops_at_next_h3(self):
        # A section in the middle must not swallow the next required ###
        # section's own content either.
        body = (
            "### Purpose / Contract\n\nReal purpose.\n\n"
            "### Invariants\n\n- I1. Real invariant.\n\n"
            "### Adversarial Scenarios\n\n- A1. Real scenario.\n\n"
            "### Validation\n\n- Real validation.\n\n"
            "### Known Limitations / Non-goals\n\n- Real limitation.\n"
        )
        sections = {s.name: s.content for s in split_sections(body) if s.level == 3}
        self.assertNotIn("Invariants", sections["Purpose / Contract"])
        self.assertIn("Real invariant", sections["Invariants"])
        self.assertEqual(validate(body), [])

    def test_section_stops_at_next_h2(self):
        body = (
            "### Known Limitations / Non-goals\n\nReal limitation text.\n\n"
            "## References\n\n- link\n"
        )
        sections = {s.name: s.content for s in split_sections(body) if s.level == 3}
        self.assertNotIn("References", sections["Known Limitations / Non-goals"])
        self.assertNotIn("link", sections["Known Limitations / Non-goals"])

    def test_deeper_heading_inside_section_is_content_not_a_boundary(self):
        # A #### (or deeper) heading is not one of the three boundary levels
        # and must remain part of the enclosing section's own content.
        body = (
            "### Adversarial Scenarios\n\n"
            "#### Sub-scenario detail\n\nStill inside Adversarial Scenarios.\n\n"
            "### Validation\n\n- Real validation.\n"
        )
        sections = {s.name: s.content for s in split_sections(body) if s.level == 3}
        self.assertIn("Sub-scenario detail", sections["Adversarial Scenarios"])
        self.assertIn("Still inside", sections["Adversarial Scenarios"])

    def test_headings_hidden_inside_a_spanning_html_comment_are_not_boundaries(self):
        # Codex-reported gap: opening an HTML comment right after the first
        # required heading and closing it only after the last one hides
        # every other required heading (and its placeholder text) inside
        # ONE comment spanning multiple would-be sections. A per-fragment
        # comment-strip (after splitting) never sees a matching <!--/--> pair
        # in any single fragment, so the "commented out" headings would be
        # treated as real boundaries and their placeholder text as real
        # content. Stripping comments from the WHOLE body before splitting
        # closes this: none of those headings should even be found.
        body = (
            "### Purpose / Contract\n\n"
            "Real purpose.\n\n"
            "<!--\n"
            "### Invariants\n"
            "This whole rest of the contract is inside one HTML comment.\n\n"
            "### Adversarial Scenarios\n"
            "Placeholder text that must NOT be counted as real content.\n\n"
            "### Validation\n"
            "Placeholder text that must NOT be counted as real content.\n\n"
            "### Known Limitations / Non-goals\n"
            "Placeholder text that must NOT be counted as real content.\n"
            "-->\n"
        )
        # Without stripping comments first, each fragment produced by
        # splitting on the hidden headings sees only real-looking prose (no
        # matching <!--/--> pair in any single fragment to strip), so this
        # would wrongly validate as complete instead of failing outright.
        failures = validate(body)
        self.assertIn("missing heading: Invariants", failures)
        self.assertIn("missing heading: Adversarial Scenarios", failures)
        self.assertIn("missing heading: Validation", failures)
        self.assertIn("missing heading: Known Limitations / Non-goals", failures)

    def test_setext_h1_stops_a_section_the_same_as_atx(self):
        # Codex-reported gap: Markdown also supports Setext-style headings
        # (`Text` underlined with `===`/`---`) as an alternative to `#`/`##`.
        # I2 requires stopping at ANY same-or-shallower heading, not only
        # ATX ones.
        body = (
            "### Known Limitations / Non-goals\n\n"
            "<!-- nothing real here -->\n\n"
            "References\n"
            "==========\n\n"
            "- https://example.com/real-link\n"
        )
        failures = validate(body)
        self.assertIn("empty section: Known Limitations / Non-goals", failures)
        sections = {s.name: s.content for s in split_sections(body)}
        self.assertNotIn("real-link", sections["Known Limitations / Non-goals"])

    def test_setext_h2_stops_a_section_the_same_as_atx(self):
        body = (
            "### Known Limitations / Non-goals\n\n"
            "<!-- nothing real here -->\n\n"
            "References\n"
            "----------\n\n"
            "- https://example.com/real-link\n"
        )
        failures = validate(body)
        self.assertIn("empty section: Known Limitations / Non-goals", failures)

    def test_single_dash_line_is_not_mistaken_for_a_setext_underline(self):
        # A lone `-` immediately after text is an ordinary list item, not a
        # Setext H2 underline (which requires 2+ dashes) — must not be
        # treated as a boundary or misclassified as anything but content.
        body = (
            "### Known Limitations / Non-goals\n\n"
            "Some real limitation text.\n"
            "-\n"
        )
        sections = {s.name: s.content for s in split_sections(body) if s.level == 3}
        self.assertIn("Some real limitation text", sections["Known Limitations / Non-goals"])

    def test_horizontal_rule_after_a_blank_line_is_not_mistaken_for_setext(self):
        # A `---` thematic break separated from the preceding paragraph by a
        # blank line is a horizontal rule, not a Setext heading of that
        # paragraph — CommonMark requires no blank line between the text and
        # its underline for a Setext heading to form.
        body = (
            "### Known Limitations / Non-goals\n\n"
            "Some real limitation text.\n\n"
            "---\n\n"
            "More text that must still count as this section's own content.\n"
        )
        sections = {s.name: s.content for s in split_sections(body) if s.level == 3}
        self.assertIn("More text that must still count", sections["Known Limitations / Non-goals"])

    def test_unclosed_html_comment_hides_everything_after_it_through_end_of_body(self):
        # Codex-reported gap: `<!--.*?-->` matches nothing when the opener
        # has no matching closer anywhere in the rest of the document -- a
        # non-greedy regex leaves an unmatched `<!--` (and everything after
        # it) completely VISIBLE, the opposite of hidden. A real Markdown
        # renderer treats an unterminated comment as consuming the rest of
        # the document, not silently revealing it.
        body = (
            "### Purpose / Contract\n\nReal purpose.\n\n"
            "### Invariants\n\n- I1. Real invariant.\n\n"
            "### Adversarial Scenarios\n\n- A1. Real scenario.\n\n"
            "### Validation\n\n- Real validation mapping.\n\n"
            "<!-- opens here and never closes\n"
            "### Known Limitations / Non-goals\n\n- Real limitation.\n"
        )
        failures = validate(body)
        self.assertIn("missing heading: Known Limitations / Non-goals", failures)

    def test_headings_inside_a_fenced_code_block_are_not_boundaries_or_content(self):
        # Codex-reported gap: a PR body can legitimately show what the
        # template looks like inside a fenced example -- complete with all
        # five required `###` headings and prose -- without the real
        # contract sections actually being filled in anywhere. Heading
        # discovery must not treat a `###` line that only exists as code
        # text inside a fence as a real section boundary.
        body = (
            "Here is what the template looks like:\n\n"
            "```markdown\n"
            "### Purpose / Contract\n\nExample purpose text.\n\n"
            "### Invariants\n\n- Example invariant.\n\n"
            "### Adversarial Scenarios\n\n- Example scenario.\n\n"
            "### Validation\n\n- Example validation.\n\n"
            "### Known Limitations / Non-goals\n\n- Example limitation.\n"
            "```\n"
        )
        failures = validate(body)
        for name in REQUIRED_SECTIONS:
            self.assertIn(f"missing heading: {name}", failures)

    def test_a_real_heading_immediately_after_a_closed_fence_is_still_found(self):
        # The fence-hiding pass must not swallow content after the fence
        # closes -- only the fenced region itself is hidden.
        body = (
            "```\nsome code\n```\n\n"
            "### Known Limitations / Non-goals\n\nReal limitation text.\n"
        )
        sections = {s.name: s.content for s in split_sections(body) if s.level == 3}
        self.assertIn("Real limitation text", sections["Known Limitations / Non-goals"])


class EmptySectionDetection(unittest.TestCase):
    def test_html_comment_only_section_is_empty_for_every_required_section(self):
        for name in REQUIRED_SECTIONS:
            with self.subTest(section=name):
                self.assertTrue(is_section_empty("\n<!-- placeholder guidance -->\n"))

    def test_bullet_only_section_is_empty_for_every_required_section(self):
        for name in REQUIRED_SECTIONS:
            with self.subTest(section=name):
                self.assertTrue(is_section_empty("\n- \n"))
                self.assertTrue(is_section_empty("\n-\n"))

    def test_comment_and_bullet_together_still_empty(self):
        self.assertTrue(is_section_empty("\n<!-- guidance -->\n- \n"))

    def test_real_bullet_content_is_not_empty(self):
        self.assertFalse(is_section_empty("\n- Real content here.\n"))

    def test_prose_content_is_not_empty(self):
        self.assertFalse(is_section_empty("\nSome real prose.\n"))


class MissingHeadingScenarios(unittest.TestCase):
    def test_missing_required_heading_is_reported(self):
        body = (
            "### Purpose / Contract\n\nReal purpose.\n\n"
            "### Invariants\n\n- I1. Real invariant.\n\n"
            "### Adversarial Scenarios\n\n- A1. Real scenario.\n\n"
            "### Validation\n\n- Real validation.\n"
            # Known Limitations / Non-goals heading entirely absent.
        )
        failures = validate(body)
        self.assertIn("missing heading: Known Limitations / Non-goals", failures)

    def test_empty_body_reports_all_five_missing(self):
        failures = validate("")
        self.assertEqual(len(failures), 5)
        for name in REQUIRED_SECTIONS:
            self.assertIn(f"missing heading: {name}", failures)


class DuplicateHeadingScenario(unittest.TestCase):
    def test_duplicate_required_heading_uses_the_last_occurrence(self):
        # An author who edits the contract by re-pasting a section (rather
        # than editing in place) should be judged on the version that is
        # actually last in the document.
        body = (
            "### Known Limitations / Non-goals\n\n<!-- old, empty -->\n\n"
            "### Purpose / Contract\n\nReal purpose.\n\n"
            "### Invariants\n\n- I1. Real invariant.\n\n"
            "### Adversarial Scenarios\n\n- A1. Real scenario.\n\n"
            "### Validation\n\n- Real validation.\n\n"
            "### Known Limitations / Non-goals\n\n- Real limitation, written later.\n"
        )
        self.assertEqual(validate(body), [])


if __name__ == "__main__":
    unittest.main()
