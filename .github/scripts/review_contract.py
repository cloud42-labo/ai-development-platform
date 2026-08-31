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
through 3 (`#`/`##`/`###` ATX headings, and `Text\n===`/`Text\n---` Setext
H1/H2 headings). Each section's content is *exactly* the text between its
own heading and the next heading of level <= 3 (or the end of the
document) -- so a required `###` section can never run past a same-level
or shallower heading, regardless of what that heading's own name is or how
many required sections precede or follow it. A heading of level 4 or
deeper (`####...`) inside a section's own content is not a boundary and is
treated as ordinary content, matching how the PR template never nests that
deep.

HTML comments and fenced code blocks are hidden from the ENTIRE body
first, in one line-oriented structural pass (`_strip_hidden_regions`),
before any heading is looked for at all -- not per-section after
splitting, and not with a single `.sub()` call. The parser also respects
Markdown code contexts: an apparent `<!--` inside an inline code span or an
indented code block is literal code, not an HTML-comment opener, and a fence
only closes when the closing marker is followed by whitespace only.
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

_ATX_HEADING_RE = re.compile(r"(?m)^(#{1,3})[ \t]+(.*?)[ \t]*$")
_SETEXT_HEADING_RE = re.compile(
    r"(?m)^(?![ \t]*(?:#{1,6}[ \t]|[-*+][ \t]|>))[ \t]*(\S.*?)[ \t]*\n(=+|-{2,})[ \t]*$"
)
_HTML_COMMENT_RE = re.compile(r"<!--.*?-->", re.S)
_EMPTY_BULLET_RE = re.compile(r"(?m)^[ \t]*[-*+][ \t]*$")
_FENCE_OPEN_RE = re.compile(r"^[ \t]{0,3}(`{3,}|~{3,})(.*)$")
_FENCE_CLOSE_RE = re.compile(r"^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$")
_INDENTED_CODE_RE = re.compile(r"^(?: {4}|\t)")


def _mask_inline_code_spans(line: str) -> str:
    """Mask complete backtick code spans while preserving character offsets.

    HTML-comment delimiters inside code spans are literal text in Markdown and
    must not change comment state. Unclosed backtick runs are left untouched;
    they do not form a complete code span.
    """
    chars = list(line)
    i = 0
    length = len(line)
    while i < length:
        if line[i] != "`":
            i += 1
            continue

        run_start = i
        while i < length and line[i] == "`":
            i += 1
        run_len = i - run_start
        delimiter = "`" * run_len
        search_from = i
        close_start = -1

        while True:
            candidate = line.find(delimiter, search_from)
            if candidate == -1:
                break
            before_ok = candidate == 0 or line[candidate - 1] != "`"
            after = candidate + run_len
            after_ok = after >= length or line[after] != "`"
            if before_ok and after_ok:
                close_start = candidate
                break
            search_from = candidate + 1

        if close_start == -1:
            continue

        close_end = close_start + run_len
        for pos in range(run_start, close_end):
            chars[pos] = " "
        i = close_end

    return "".join(chars)


def _strip_hidden_regions(body: str) -> str:
    """Hide fenced code blocks and HTML comments before heading discovery.

    Hidden lines are replaced with empty lines so line count remains stable.
    Fenced blocks only close on valid Markdown closing-fence syntax: the same
    fence character, at least the opening length, and no non-whitespace suffix.
    Inline code spans and indented code blocks are not interpreted as HTML
    comments. An unmatched real HTML-comment opener hides through EOF.
    """
    lines = body.replace("\r\n", "\n").split("\n")
    visible_lines: list[str] = []
    in_fence = False
    fence_char = ""
    fence_len = 0
    in_comment = False

    for line in lines:
        if in_fence:
            match = _FENCE_CLOSE_RE.match(line)
            if match and match.group(1)[0] == fence_char and len(match.group(1)) >= fence_len:
                in_fence = False
            visible_lines.append("")
            continue

        if not in_comment:
            match = _FENCE_OPEN_RE.match(line)
            if match:
                marker = match.group(1)
                # A backtick opening fence cannot use a backtick in its info
                # string. Treat such a line as ordinary prose rather than a
                # fence opener; tilde fences do not have this restriction.
                if marker[0] != "`" or "`" not in match.group(2):
                    in_fence = True
                    fence_char = marker[0]
                    fence_len = len(marker)
                    visible_lines.append("")
                    continue

            if _INDENTED_CODE_RE.match(line):
                visible_lines.append(line)
                continue

        scan_line = line if in_comment else _mask_inline_code_spans(line)
        parts: list[str] = []
        pos = 0
        while True:
            if in_comment:
                close = line.find("-->", pos)
                if close == -1:
                    pos = len(line)
                    break
                in_comment = False
                pos = close + 3
                scan_line = _mask_inline_code_spans(line)
                continue

            open_idx = scan_line.find("<!--", pos)
            if open_idx == -1:
                parts.append(line[pos:])
                pos = len(line)
                break
            parts.append(line[pos:open_idx])
            pos = open_idx + 4
            in_comment = True

        visible_lines.append("".join(parts))

    return "\n".join(visible_lines)


@dataclass(frozen=True)
class Section:
    level: int
    name: str
    content: str


def _find_headings(body: str):
    """Return (start, end, level, name) for every ATX/Setext heading."""
    headings = []
    for match in _ATX_HEADING_RE.finditer(body):
        headings.append((match.start(), match.end(), len(match.group(1)), match.group(2).strip()))
    for match in _SETEXT_HEADING_RE.finditer(body):
        level = 1 if match.group(2).startswith("=") else 2
        headings.append((match.start(), match.end(), level, match.group(1).strip()))
    headings.sort(key=lambda h: h[0])
    return headings


def split_sections(body: str) -> list[Section]:
    """Split `body` at every real Markdown heading of level 1-3."""
    body = _strip_hidden_regions(body)
    headings = _find_headings(body)
    sections: list[Section] = []
    for index, (_start, end, level, name) in enumerate(headings):
        content_end = headings[index + 1][0] if index + 1 < len(headings) else len(body)
        sections.append(Section(level=level, name=name, content=body[end:content_end]))
    return sections


def is_section_empty(content: str) -> bool:
    """True if `content` has no substantive text after scaffolding removal."""
    stripped = _HTML_COMMENT_RE.sub("", content)
    stripped = _EMPTY_BULLET_RE.sub("", stripped)
    return not stripped.strip()


def validate(body: str, required: tuple[str, ...] = REQUIRED_SECTIONS) -> list[str]:
    """Return human-readable failures; an empty list means valid."""
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
