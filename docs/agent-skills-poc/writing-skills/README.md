# Writing Skills PoC — japanese-tech-writing / cognitive-rhythm-writing

Date: 2026-09-26 (JST)
Status: PoC result and adoption proposal (ADP-031-B, Story ADP-031, Epic ADP-EPIC-06)
Scope: Compare the same Android technical article written with and without the two
writing skills, in both generation mode and revision mode, and record readability,
technical accuracy, and over-conversion so the adoption conditions for each skill
can be decided. Operational state (Status, time records) stays in the Notion Task;
this document is the durable evidence.

## Skills under test

| Skill | Source (pinned) | License | Role in ADP-EPIC-06 design |
|---|---|---|---|
| `japanese-tech-writing` (jtw) | gist `k16shikano/fd287c3133457c4fd8f5601d34aa817d` @ `8f2d576` (2026-09-09) | Unlicense | Base norm for technical documents |
| `cognitive-rhythm-writing` (crw) | gist `k16shikano/eb2929f13ed19c97188393d297be8432` @ `a3b1e26` (2026-07-09) | Unlicense (author applies it to all public gists) | Additional norm for read-through articles |

Both are imported verbatim into `cloud42-labo/skills` under `vendor/`.

## Method

- One brief and fact sheet ([brief.md](brief.md)): "where to keep screen state:
  `remember` / `rememberSaveable` / `ViewModel`", 1,800–2,500 chars, 3–5 headings,
  2–3 Kotlin examples, facts 1–7 mandatory.
- Five samples, each produced by a fresh Claude Sonnet subagent that saw only the
  brief, the skill files for its condition, and (for revisions) its input draft:

  | Sample | Mode | Input | Skill |
  |---|---|---|---|
  | A | generate | brief | none |
  | B | generate | brief | jtw |
  | C | generate | brief | crw (+ jtw, which crw requires) |
  | D | revise | A | jtw |
  | E | revise | D | crw (+ jtw) |

  D and E were added after review (PR #72) pointed out that the first round tested
  only generation mode while the proposal is about revision.
- Evaluation layers:
  1. Mechanical check ([lint.py](lint.py) → [lint-result.json](lint-result.json)):
     jtw banned-phrase counts, crw leak vocabulary, sentence length, fact coverage.
  2. Blind review by a separate Claude session acting as a senior Android engineer
     and Japanese technical editor. Round 1: A/B/C
     ([blind-review.md](blind-review.md), key X = C, Y = A, Z = B). Round 2: A/D/E
     ([blind-review-2.md](blind-review-2.md), key P = E, Q = A, R = D).
  3. Manual cross-check of every accuracy finding against the fact sheet and the
     Compose API.
- Limitation: n = 1 per condition, one topic, one model, and the reviewer is also
  an LLM. A was scored in both rounds and moved from accuracy 4 to 3, so treat a
  one-point difference as noise. The findings show *failure modes*, not averages.

## Results

| | A: none | B: jtw gen | C: crw gen | D: jtw revise A | E: crw revise D |
|---|---|---|---|---|---|
| Readability (blind, 1–5) | 4 / 4 | 3 | 4 | 4 | 3 |
| Accuracy (blind, 1–5) | 4 / 3 | **2** | 4 | 2 | 2 |
| jtw banned phrases (mechanical) | 4 | 0 | 0 (1 false positive) | 1 | 0 |
| Avg sentence length / sentences ≥ 80 chars | 46.5 / 4 | 48.3 / 1 | 36.8 / 0 | 45.5 / 3 | 40.1 / 2 |
| New technical errors vs A (manual) | — | 3, one fatal | 2 | 1 | 6 |
| Fixed A's existing errors | — | n/a | n/a | 0 of 3 | 0 of 3 |
| Subagent tokens / wall time | 67k / 43 s | 82k / 117 s | 98k / 201 s | 86k / 116 s | 94k / 158 s |

A's two scores are round 1 / round 2. Mechanical false positives: `回収` hits are
"memory reclaim" (メモリ回収), and `ここでは` in C is "does not happen here".

### Main finding

Every skill-applied sample introduced at least one new technical error that the
baseline did not have, and neither revision fixed any error already in A. The
skills change *how* sentences are phrased, and each rephrasing of a claim is a
chance to change its meaning. Nothing in either skill checks meaning against the
source facts.

### What each skill changed

**jtw in generation mode (B)** removed every filler phrase but produced the only
fatal error: "入力欄の一文字ごとの値やスクロール位置は前者に…" where 前者 is
`ViewModel`, so the conclusion tells the reader to do the opposite of fact 10.

**jtw in revision mode (D)** was the gentlest change: readability stayed at 4 and
3 of A's 4 filler phrases went away. Rewriting the personified "プロセス終了には
無力" produced a new error, "`ViewModel` も他の手段と同じく値を保てない", which
wrongly implies `rememberSaveable` does not survive process death. A's existing
problem (the closing advice conflicts with fact 8) was left in place.

**crw in generation mode (C)** gave the most engaging structure with accuracy
unchanged, but the title hid the topic, an opening question was never resolved,
and an addition beyond the fact sheet misdescribed `listSaver`.

**crw in revision mode (E)** lowered readability to 3 and added the most errors:
it kept D's "他の手段と同じく" error, turned the `rememberSaveable` bullet into
"画面が生きている間は消えてほしくない UI 状態" (which `remember` already covers),
added the overclaim "違うのは…だけだ", and opened with "判断の軸は一つでいい" before
listing three criteria. It also slightly exceeded the length limit.

## Adoption proposal

| Skill | Proposal | Invoke when | Do not invoke when |
|---|---|---|---|
| jtw | **Adopt conditionally, revision mode only** | Revising a finished Japanese technical draft before publication, to remove LLM filler and translationese, **followed by an accuracy diff review** | First-pass generation from facts (B's fatal error); English documents; operational notes (journal, Notion Result) |
| crw | **Do not wire into ADP now** | — (a person may still use it by hand on essays such as AOD articles, where a human editor reviews the result) | Any ADP pipeline gate; reference docs, how-to/API guides, README, specs, PR bodies |

Required gate whenever jtw (or crw by hand) rewrites a document: an **accuracy
diff review** by a different session or a person, comparing each changed sentence
that states a technical claim against the source or the pre-revision text. It
must check pronoun and comparison references (前者/後者, 他の手段と同じく), removed
hedges, summary bullets, and anything added beyond the source. Also check that the
title and headings keep the topic keywords and that length and structure limits
still hold.

Cost: each skill pass added roughly 20–45 % tokens and 2.5–5× wall time per
article in this run.

The pipeline wiring (which ADP gate calls jtw) belongs to the follow-on
integration work in ADP-EPIC-06 (PoC pass criterion 5); this document supplies
the evidence and the proposed call / no-call conditions.

## Files

- [brief.md](brief.md) — shared brief and fact sheet
- [samples/](samples/) — the five articles A–E, unedited
- [blind-review.md](blind-review.md), [blind-review-2.md](blind-review-2.md) — blind reviews
- [lint.py](lint.py), [lint-result.json](lint-result.json) — mechanical check
