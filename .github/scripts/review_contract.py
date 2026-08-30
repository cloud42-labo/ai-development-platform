"""Parses and validates the PR Review Contract embedded in a PR body.

Design invariant: the five required `###` sections must be validated
*independently* of one another and of any surrounding content. The previous
implementation searched each required section with its own regular
expression whose lookahead only terminated at another `###` heading, so the
*last* required section (`Known Limitations / Non-goals`) silently absorbed
everything after it up to the end of the PR body -- including an unrelated
`## References` section -- whenever nothing else in the body happened to
start with `###`. A comment-only or empty final section could then pass CI
by "borrowing" non-empty content that was never actually written under it.

The fix here is structural, not a patched regex: `split_sections` performs a
single pass over the body, splitting it at every Markdown heading of level 1
through 3 (`#`, `##`, `###`). Each section's content is *exactly* the text
between its own heading and the next heading of level <= 3 (or the end of
the document) -- so a required `###` section can never run past a
same-level or shallower heading, regardless of what that heading's own name
is or how many required sections precede or follow it. A heading of level 4
or deeper (`####...`) inside a section's own content is not a boundary and
is treated as ordinary content, matching how the PR template never nests
that deep.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

REQUIRED_SECTIONS = (
    "Purpose / Contract",
    "Invariants",
    "Adversarial Scenarios",
    "Validation",
    "Known Limitations / Non-goals",
)

_HEADING_RE = re.compile(r"(?m)^(#{1,3})[ \t]+(.*?)[ \t]*$")
_HTML_COMMENT_RE = re.compile(r"<!--.*?-->", re.S)
_EMPTY_BULLET_RE = re.compile(r"(?m)^[ \t]*[-*+][ \t]*$")


@dataclass(frozen=True)
class Section:
    level: int
    name: str
    content: str


def split_sections(body: str) -> list[Section]:
    """Splits `body` into Markdown sections at every heading of level 1-3.

    Each section's `content` runs from immediately after its own heading line
    to immediately before the next level-1..3 heading (or end of string).
    Content before the first heading is discarded (not part of any named
    section, and never required).
    """
    body = body.replace("\r\n", "\n")
    matches = list(_HEADING_RE.finditer(body))
    sections: list[Section] = []
    for index, match in enumerate(matches):
        level = len(match.group(1))
        name = match.group(2).strip()
        start = match.end()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(body)
        sections.append(Section(level=level, name=name, content=body[start:end]))
    return sections


def is_section_empty(content: str) -> bool:
    """True if `content` has no substantive text once template scaffolding
    (HTML comments, and bullet markers with nothing after them) is removed.
    """
    stripped = _HTML_COMMENT_RE.sub("", content)
    stripped = _EMPTY_BULLET_RE.sub("", stripped)
    return not stripped.strip()


def validate(body: str, required: tuple[str, ...] = REQUIRED_SECTIONS) -> list[str]:
    """Returns a list of human-readable failure strings; empty means valid.

    Only a level-3 (`###`) heading counts as satisfying a required section --
    matching the PR template, where these are sub-headings under the
    `## Review Contract` heading. If a required name appears more than once
    at level 3, the LAST occurrence is authoritative (mirrors "the contract
    as currently written," consistent with the PR body being append-only
    edited over review rounds).
    """
    sections = split_sections(body)
    by_name: dict[str, str] = {}
    for section in sections:
        if section.level == 3 and section.name in required:
            by_name[section.name] = section.content

    failures: list[str] = []
    for name in required:
        if name not in by_name:
            failures.append(f"missing heading: {name}")
            continue
        if is_section_empty(by_name[name]):
            failures.append(f"empty section: {name}")
    return failures


def main() -> int:
    import json
    import os
    import sys

    with open(os.environ["GITHUB_EVENT_PATH"], encoding="utf-8") as fh:
        event = json.load(fh)

    body = event.get("pull_request", {}).get("body") or ""
    failures = validate(body)

    if failures:
        print("PR Review Contract is incomplete:")
        for failure in failures:
            print(f"- {failure}")
        print("\nFill every Review Contract section in the PR body before review/merge.")
        return 1

    print("PR Review Contract is complete.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
