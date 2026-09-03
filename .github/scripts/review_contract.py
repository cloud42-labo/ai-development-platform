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

HTML comments, fenced code blocks, and raw HTML blocks (all of CommonMark's
HTML block types 1/3/4/5/6/7 -- e.g. `<div>...`, `<pre>...</pre>`,
`<?processing instructions?>`, `<!DOCTYPE ...>`, `<![CDATA[...]]>`, and a
standalone custom tag alone on its own paragraph-starting line) are all
hidden from the ENTIRE body first, in one line-oriented structural pass
(`_strip_hidden_regions`), before any heading is looked for at all -- not
per-section after splitting, and not with a single `.sub()` call. Only a
known block-level tag (the CommonMark type-6 list), or type 7's stricter
"whole line, nothing else, not interrupting a paragraph" form, starts a
hidden HTML block; an inline-level tag like `<br>` or `<code>` does not, so
it never swallows the real prose it appears in. The parser also respects
Markdown code contexts: an apparent `<!--` inside an inline code span
(including one whose closing delimiter lands on a later line than its
opener) or an indented code block is literal code, never a hidden-region
opener, and a fence only closes when the closing marker is followed by
whitespace only.
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

# CommonMark "type 6" HTML block tag names -- block-level elements whose
# opening (or closing) tag alone on a line starts a raw HTML block that
# Markdown renders verbatim, never as real section structure. Deliberately
# excludes inline-level tags (span, code, a, em, strong, b, i, br, img, ...):
# those can legitimately appear inside real prose and must not be hidden.
_HTML_BLOCK_TAGS = frozenset({
    "address", "article", "aside", "base", "basefont", "blockquote", "body",
    "caption", "center", "col", "colgroup", "dd", "details", "dialog", "dir",
    "div", "dl", "dt", "fieldset", "figcaption", "figure", "footer", "form",
    "frame", "frameset", "h1", "h2", "h3", "h4", "h5", "h6", "head", "header",
    "hr", "html", "iframe", "legend", "li", "link", "main", "menu",
    "menuitem", "nav", "noframes", "ol", "optgroup", "option", "p", "param",
    "search", "section", "summary", "table", "tbody", "td", "tfoot", "th",
    "thead", "title", "tr", "track", "ul",
})
# "type 1" tags: the block continues until the matching closing tag, not
# until the next blank line -- pre/script/style/textarea are exactly the
# tags CommonMark special-cases this way, since their content is meant to
# be taken verbatim and commonly contains blank lines of its own.
_PRE_LIKE_HTML_TAGS = frozenset({"pre", "script", "style", "textarea"})
_HTML_BLOCK_OPEN_RE = re.compile(
    r"^[ \t]{0,3}</?([a-zA-Z][a-zA-Z0-9-]*)(?:[ \t>]|/>|$)"
)
# CommonMark "type 7": a tag name NOT in the type-6 list above still starts a
# hidden HTML block when the ENTIRE line (after up to 3 leading spaces) is
# nothing but one complete open or close tag -- but only when no paragraph
# is currently open, i.e. start of body, right after a blank line, right
# after a heading, or right after any other block-level construct (NOT
# merely "the previous line was blank" -- a heading closes a paragraph
# without itself being a blank line). Ends at the next blank line, same as
# type 6.
_HTML_BLOCK_TYPE7_LINE_RE = re.compile(
    r"^[ \t]{0,3}(?:</[a-zA-Z][a-zA-Z0-9-]*[ \t]*"
    r"|<[a-zA-Z][a-zA-Z0-9-]*(?:[ \t]+[^<>]*)?[ \t]*/?)>[ \t]*$"
)

# CommonMark "type 2" (HTML comment), "type 3" (processing instruction, e.g.
# `<?php ... ?>`), "type 4" (declaration, e.g. `<!DOCTYPE html>`), and
# "type 5" (CDATA, `<![CDATA[...]]>`) block/span openers -- each hides
# through its own close marker, possibly spanning multiple lines, same as an
# HTML comment already did. Alternation order matters: `<!--` and
# `<![CDATA[` must be tried before the bare `<!`+letter declaration pattern,
# since all three share the `<!` prefix.
_HIDDEN_SPAN_OPEN_RE = re.compile(r"<!--|<!\[CDATA\[|<!(?=[A-Za-z])|<\?")


def _is_setext_heading_pair(text_line: str, underline_line: str) -> bool:
    """True if `text_line` immediately followed by `underline_line` forms a
    genuine Setext heading -- reuses `_SETEXT_HEADING_RE` itself (rather than
    a fresh, potentially-diverging regex) so this shares the exact same
    exclusions it already encodes (a `- item` list line, a blank-line-
    preceded horizontal rule, ...). A paragraph closes at (and including)
    `underline_line` when this is true, same as any other heading."""
    return bool(_SETEXT_HEADING_RE.match(text_line + "\n" + underline_line))


def _paragraph_lookahead_lines(lines: list, start_idx: int) -> list:
    """The rest of the CURRENT paragraph starting at `start_idx`, for
    confirming whether an unmatched backtick run genuinely continues as a
    multiline code span (see `_paragraph_has_matching_close`). Stops BEFORE
    any line that would itself end the paragraph -- not just a blank line,
    but any other block-level construct this parser recognizes: an ATX or
    Setext heading, a fenced-code opener, or a raw-HTML-block (type 1/6)
    opener. When the first lookahead candidate is itself a Setext underline,
    it is paired with the immediately preceding current line so the heading
    boundary is recognized before scanning beyond it. (Type 7 is deliberately
    not checked here: whether a given line qualifies for type 7 already
    depends on paragraph state, which would make this recursive for
    comparatively little benefit -- a known, documented residual gap.) A
    backtick match found only past one of these boundaries is not actually
    reachable within the same paragraph and must not count.
    """
    result: list = []
    n = len(lines)
    idx = start_idx
    while idx < n:
        candidate = lines[idx]
        if not candidate.strip():
            break
        if idx == start_idx and idx > 0 and _is_setext_heading_pair(lines[idx - 1], candidate):
            break
        if _ATX_HEADING_RE.match(candidate):
            break
        if idx + 1 < n and _is_setext_heading_pair(candidate, lines[idx + 1]):
            break
        fence_match = _FENCE_OPEN_RE.match(candidate)
        if fence_match:
            marker = fence_match.group(1)
            if marker[0] != "`" or "`" not in fence_match.group(2):
                break
        html_match = _HTML_BLOCK_OPEN_RE.match(candidate)
        if html_match:
            tag = html_match.group(1).lower()
            if tag in _HTML_BLOCK_TAGS or tag in _PRE_LIKE_HTML_TAGS:
                break
        result.append(candidate)
        idx += 1
    return result


def _find_span_close(line: str, delimiter: str, search_from: int) -> int:
    """Return the index of `delimiter` in `line` that closes a code span
    opened by that same delimiter, or -1. A closing run must be exactly
    `delimiter`'s length -- not touching a longer backtick run on either
    side, which would make it part of a different run entirely."""
    run_len = len(delimiter)
    length = len(line)
    while True:
        candidate = line.find(delimiter, search_from)
        if candidate == -1:
            return -1
        before_ok = candidate == 0 or line[candidate - 1] != "`"
        after = candidate + run_len
        after_ok = after >= length or line[after] != "`"
        if before_ok and after_ok:
            return candidate
        search_from = candidate + 1


def _paragraph_has_matching_close(paragraph_lookahead: list, delimiter: str) -> bool:
    """True if some line in `paragraph_lookahead` contains a close for
    `delimiter`. Used to confirm a backtick run left unmatched on its own
    line genuinely continues as a code span into a LATER line of the SAME
    paragraph, rather than being CommonMark's fallback: a backtick run with
    no matching run ANYWHERE before the paragraph ends is not a code span
    at all -- just literal backtick characters."""
    return any(_find_span_close(candidate, delimiter, 0) != -1 for candidate in paragraph_lookahead)


def _mask_inline_code_spans(line: str, span_state: dict, paragraph_lookahead: list) -> str:
    """Mask complete backtick code spans while preserving character offsets.

    HTML-comment (and processing-instruction/declaration/CDATA) delimiters
    inside code spans are literal text in Markdown and must not change hidden-
    region state.

    A code span's closing delimiter can be on a LATER line than its opener --
    CommonMark allows a span's content to include line breaks (rendered as
    spaces). `span_state` (`{"in_span": bool, "delim": str}`) threads that
    across calls: a line entered already inside a span has its own text
    scanned only for the close; if the close isn't found either, the ENTIRE
    line is masked and the state carries forward again. Resets at a blank
    line, mirroring how a blank line ends the paragraph a code span's inline
    parsing happens within -- an unclosed span cannot itself keep hiding
    headings across a real section boundary.

    A backtick run with NO matching close anywhere -- not on this line, and
    not on any later line before the paragraph ends (`paragraph_lookahead`,
    the remaining lines of the current paragraph) -- is not a code span at
    all under CommonMark: it is left as literal, unmasked text, and does not
    start `span_state["in_span"]`. Treating every unmatched run as an
    always-continuing span would let it swallow a genuine, real hidden-region
    opener (e.g. an unterminated HTML comment) on a later line as if it were
    masked code, hiding it from `validate()` even though a real Markdown
    renderer would show that comment's own hiding taking effect instead.
    """
    if not line.strip():
        span_state["in_span"] = False
        span_state["delim"] = ""
        return line

    chars = list(line)
    length = len(line)
    i = 0

    if span_state["in_span"]:
        delimiter = span_state["delim"]
        close_start = _find_span_close(line, delimiter, 0)
        if close_start == -1:
            return " " * length
        close_end = close_start + len(delimiter)
        for pos in range(0, close_end):
            chars[pos] = " "
        i = close_end
        span_state["in_span"] = False
        span_state["delim"] = ""

    while i < length:
        if line[i] != "`":
            i += 1
            continue

        run_start = i
        while i < length and line[i] == "`":
            i += 1
        run_len = i - run_start
        delimiter = "`" * run_len
        close_start = _find_span_close(line, delimiter, i)

        if close_start == -1:
            if not _paragraph_has_matching_close(paragraph_lookahead, delimiter):
                # No matching run anywhere before the paragraph ends -- not
                # a code span at all. Leave these backticks as literal text
                # (already correct in `chars`) and keep scanning past them.
                continue
            # A later line in this same paragraph does close it -- the span
            # continues past EOL.
            for pos in range(run_start, length):
                chars[pos] = " "
            span_state["in_span"] = True
            span_state["delim"] = delimiter
            i = length
            break

        close_end = close_start + run_len
        for pos in range(run_start, close_end):
            chars[pos] = " "
        i = close_end

    return "".join(chars)


def _strip_hidden_regions(body: str) -> str:
    """Hide fenced code blocks, HTML comments, and other raw HTML regions
    before heading discovery.

    Hidden lines are replaced with empty lines so line count remains stable.
    Fenced blocks only close on valid Markdown closing-fence syntax: the same
    fence character, at least the opening length, and no non-whitespace suffix.
    Inline code spans (including ones spanning multiple lines) and indented
    code blocks are not interpreted as HTML comments or any other hidden-span
    opener. An unmatched real opener (HTML comment, processing instruction,
    or declaration) hides through EOF.
    """
    lines = body.replace("\r\n", "\n").split("\n")
    visible_lines: list[str] = []
    in_fence = False
    fence_char = ""
    fence_len = 0
    hidden_span_kind = None  # None | "comment" | "pi" | "decl" | "cdata"
    hidden_span_close = ""
    in_html_block = False
    html_block_pre_like = False
    html_block_close_tag = ""
    span_state = {"in_span": False, "delim": ""}
    # True whenever no paragraph is currently open -- start of body, right
    # after a blank line, right after a heading, or right after any other
    # block-level construct (a heading is its own block and, like a blank
    # line, closes whatever paragraph came before it without opening one of
    # its own). Type 7 HTML blocks may only start here; type 6 may start
    # anywhere.
    at_block_boundary = True

    for idx, line in enumerate(lines):
        line_is_blank = not line.strip()

        if in_fence:
            match = _FENCE_CLOSE_RE.match(line)
            if match and match.group(1)[0] == fence_char and len(match.group(1)) >= fence_len:
                in_fence = False
            visible_lines.append("")
            at_block_boundary = True
            continue

        if in_html_block:
            if html_block_pre_like:
                # Type-1 tags (pre/script/style/textarea): hidden through the
                # matching closing tag, not a blank line -- their content is
                # meant to be taken verbatim and commonly contains blank
                # lines of its own.
                visible_lines.append("")
                if html_block_close_tag in line.lower():
                    in_html_block = False
                at_block_boundary = True
                continue
            # Every other block tag (CommonMark types 6/7): hidden through the
            # next blank line, which is itself NOT part of the block and
            # stays visible so a real heading right after it is still found.
            if line_is_blank:
                in_html_block = False
                visible_lines.append(line)
                at_block_boundary = True
                continue
            visible_lines.append("")
            at_block_boundary = True
            continue

        if hidden_span_kind is None:
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
                    at_block_boundary = True
                    continue

            html_match = _HTML_BLOCK_OPEN_RE.match(line)
            html_tag = html_match.group(1).lower() if html_match else None
            if html_match and (html_tag in _HTML_BLOCK_TAGS or html_tag in _PRE_LIKE_HTML_TAGS):
                # CommonMark type 6/1: a known block-level tag starts a
                # hidden region regardless of what precedes it.
                in_html_block = True
                html_block_pre_like = html_tag in _PRE_LIKE_HTML_TAGS
                html_block_close_tag = "</" + html_tag + ">"
                if html_block_pre_like and html_block_close_tag in line.lower():
                    # Opens and closes on the same line (e.g. `<pre>x</pre>`).
                    in_html_block = False
                visible_lines.append("")
                at_block_boundary = True
                continue

            if at_block_boundary:
                # CommonMark type 7: ANY tag name (not just the type-6 list)
                # alone on its own line -- nothing else, not even prose --
                # starts a hidden region too, but only when it can't be
                # interrupting an existing paragraph: no paragraph is open
                # right now (start of body, right after a blank line, right
                # after a heading, or right after another block-level
                # construct). Tags already covered by type 6/1 above never
                # reach here.
                type7_match = _HTML_BLOCK_TYPE7_LINE_RE.match(line)
                if type7_match:
                    in_html_block = True
                    html_block_pre_like = False
                    html_block_close_tag = ""  # blank-line-terminated, tag irrelevant
                    visible_lines.append("")
                    at_block_boundary = True
                    continue

            if _INDENTED_CODE_RE.match(line):
                visible_lines.append(line)
                at_block_boundary = True
                continue

        # A heading line is its own block: it closes whatever paragraph
        # preceded it, and does not itself open one -- the line right after
        # a heading is still eligible to start a type-7 HTML block.
        at_block_boundary = (
            line_is_blank
            or bool(_ATX_HEADING_RE.match(line))
            or (idx > 0 and _is_setext_heading_pair(lines[idx - 1], line))
        )

        # Computed lazily, AT MOST ONCE for this physical line: `_mask_inline_
        # code_spans` mutates `span_state`, so calling it more than once per
        # line (once when a carried-over hidden span closes mid-line, then
        # again for a second such close) would re-scan the same text against
        # state it had already advanced past, corrupting it. One call gives
        # the same masked text regardless of when within the line it runs.
        # `paragraph_lookahead` is likewise computed lazily -- only needed if
        # this line turns out to contain a genuinely unmatched backtick run.
        scan_line = None
        paragraph_lookahead = None
        parts: list[str] = []
        pos = 0
        while True:
            if hidden_span_kind:
                close = line.find(hidden_span_close, pos)
                if close == -1:
                    pos = len(line)
                    break
                hidden_span_kind = None
                pos = close + len(hidden_span_close)
                continue

            if scan_line is None:
                if paragraph_lookahead is None:
                    paragraph_lookahead = _paragraph_lookahead_lines(lines, idx + 1)
                scan_line = _mask_inline_code_spans(line, span_state, paragraph_lookahead)

            open_match = _HIDDEN_SPAN_OPEN_RE.search(scan_line, pos)
            if not open_match:
                parts.append(line[pos:])
                pos = len(line)
                break
            parts.append(line[pos:open_match.start()])
            opener = open_match.group(0)
            pos = open_match.end()
            if opener == "<!--":
                hidden_span_kind, hidden_span_close = "comment", "-->"
            elif opener.startswith("<![CDATA["):
                hidden_span_kind, hidden_span_close = "cdata", "]]>"
            elif opener == "<?":
                hidden_span_kind, hidden_span_close = "pi", "?>"
            else:  # "<!" followed by a letter -- a declaration (type 4)
                hidden_span_kind, hidden_span_close = "decl", ">"

        visible_lines.append("".join(parts))
        prev_line_blank = line_is_blank

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
