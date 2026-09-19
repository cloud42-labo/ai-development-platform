# Instruction / Skill Debt Inventory (ADP-057)

> **Artifact status:** durable reference. Produced for `ADP-057` Acceptance Criteria 1–5,
> covering the 8 repositories this AI organization actively operates in as of 2026-09-19
> (`cloud42-labo/brain`, `cloud42-labo/skills`, `cloud42-labo/experimental`,
> `cloud42-labo/ai-organization-design`, `cloud42-labo/ai-development-platform`,
> `cloud42-labo/serendipity-spot`, `cloud42-labo/management-simulation-game`,
> `cloud42-labo/store-survival-simulator`). This is a classification of what already
> exists, per that Story's own design principle ("新しいルール追加より、既存ルールの
> 削除・統合を先に検討する") — it does not propose new rules, only where existing ones
> should live and which duplicates/conflicts to resolve.

## Method

Every persistent instruction source reachable from a session opened in one of the 8
repositories was read: each repo's `CLAUDE.md` / `AGENTS.md` / `GEMINI.md` / `SKILL.md`
(where present), this repository's `docs/operating-guide.md` and `docs/regulations/`
R01–R06, `governance/*`, and the `cloud42-labo/skills` Skill definitions that those repos'
instruction files delegate procedure to. Each source was classified into one of:
**Keep / Project-local / Skill Procedure / Duplicate / Conflict / Obsolete** (a source can
carry more than one tag when different parts of it warrant different treatment).

Routine/Scheduler *live configuration* (the actual cron/trigger definitions registered in
this org's scheduling system) was not independently queried in this pass — this session
had no tool binding for that registry. What was verified instead is the *design contract*
each Skill states for Routines: e.g. `weekly-sprint`'s and `backlog-refinement`'s own
"Routine Contract" / closing "Rules" sections both state a Routine may hold only "when to
fire" + "which Skill to call", and must not carry a copy of the procedure. No Routine body
text was found duplicating Skill procedure text in any Skill's own description of what a
Routine may contain; a follow-up pass with scheduler read access could confirm the live
Routine bodies actually match that contract.

## Inventory and classification

### `cloud42-labo/ai-development-platform` (durable Policy source of truth)

| Source | Class | Notes |
|---|---|---|
| `AGENTS.md` | Keep | Repo-local execution gate (mandatory lifecycle gate, before/after-work pre-flight, source-of-truth rules). Concrete, non-duplicated, points to `governance/*` rather than restating it. |
| `docs/operating-guide.md` | Keep (compatibility entry point) | Already reduced to a 5-section routing table ("no new rules here") as of the ADP-059 migration. This is the reference-only pattern AC#4 asks for — already achieved at the ADP level before this Story started. |
| `docs/regulations/R01`–`R06` | Keep | Formal regulation layer (org / authority / approval / document mgmt / system-dev mgmt / project mgmt), effective 2026-09-06. This is the正本 for global Policy text; other repos should link here, not restate. |
| `docs/regulations/README.md` | Keep | Normative index; states the document hierarchy (規程→基準→手順→記録) and priority order explicitly. |
| `governance/*.md` (ai-execution-constraints, source-of-truth, research-security-policy, postmortem/monthly-risk loops, regression cases) | Keep | 基準 layer per R04's own hierarchy; each is single-purpose and cross-referenced rather than duplicated elsewhere. |
| `governance/agent-policy.yaml` | Keep, marked non-authoritative (pre-existing label, reconfirmed) | Still `default_decision: approve` / no enforcement point, per `docs/v1-asset-inventory.md`'s freeze-scope exception. Its `github-protected-merge` rule is generic (applies `approve` uniformly); it does not itself encode the brain/experimental/skills self-merge exceptions — those live correctly in R02, not here. No action needed. |

**Conflict found and fixed in this pass:** `docs/regulations/R02-authority-regulation.md`
§4.1 (self-merge repositories) listed only `cloud42-labo/brain` and
`cloud42-labo/experimental`. `cloud42-labo/skills`'s own `CLAUDE.md` has stated, since
2026-09-12, that Owner instruction extended the same self-merge exception to that
repository ("2026-09-12、駒場さんの指示により明文化"). R02 (最終改定日 2026-09-06) predates
that instruction and was never updated — a live durable-Policy / repo-local-instruction
mismatch of exactly the kind AC#2/AC#3 target. Per R02 第2条4 ("恒久変更であれば速やかに
規程へ反映する") this session added `cloud42-labo/skills` to R02 §4.1 with a citation back
to `skills/CLAUDE.md`, and bumped R02's `最終改定日`/`移管元` accordingly (PR, not merged —
see "Changes made" below; R02 changes require Owner review per R03 第3条1, this repo is not
a self-merge repo).

### `cloud42-labo/brain`

| Source | Class | Notes |
|---|---|---|
| `CLAUDE.md` | Keep | The knowledge-base operating rules (PARA structure, journal/decisions append-only, Notion completion transaction contract, self-merge scope). This is brain's own local Policy for how brain itself is operated, not a duplicate of ADP's regulations (different subject: brain is Memory, ADP regulations are Policy for Vibe Product Development). Internally consistent with R02 §4.1 (self-merge). |
| `AGENTS.md` | Keep | Short, points to `docs/operating-guide.md` as durable-Policy authority (predates the ADP-059 regulation split, but the pointer target still resolves — Operating Guide is now itself a compatibility entry point into R01–R06, so the chain still holds without editing brain's AGENTS.md). |
| `notes/semver-and-release-deliverables.md` | Keep (now the sole copy of the versioning table) | Confirmed as the canonical source; two downstream repos duplicated its table verbatim (see Duplicate finding below). |
| `notes/*` (session-start-attach-brain, ai-pr-review-loop, notion-vibe-product-development, android-adaptive-icon-pitfalls, etc.) | Keep | Referenced from other repos' CLAUDE.md by link only, not restated in body — already the pattern AC#4 asks for. |
| `decisions/0024-brain-non-experimental-no-self-merge.md` | Obsolete (already correctly flagged in-repo) | brain's own CLAUDE.md already states this decision "は過去の運用履歴であり、2026-09-06のOwner方針で失効した" — this is the append-only decisions/ pattern working as intended (superseded, not deleted, not rewritten). No action needed; cited here only to confirm the self-correcting mechanism is functioning, not to reopen it. |

### `cloud42-labo/skills`

| Source | Class | Notes |
|---|---|---|
| `CLAUDE.md` | Keep + surfaced one Conflict (see above, now being synced into R02) | Correctly short; the self-merge exception text explains *why* (personal tooling, no prod/external exposure) rather than just asserting it. |
| `.claude/skills/*/SKILL.md` (20 skills) | Skill Procedure (by design) | This is exactly the 手順 layer R04's hierarchy calls for. Spot-checked `weekly-sprint`, `backlog-refinement`, `upstream-change-review`, `task-approach-review` for policy-text duplication: none found — each states "Policy全文はOperating Guide/R06を参照する" rather than restating regulation text. This is the intended shape; no Duplicate found here. |
| `weekly-sprint` Step 1 (`upstream-change-review`) → Step 3 (`sprint-retrospective`) | Keep | Already carries "Instruction / Skill Debt Signals" as an explicit named output from upstream-change-review into retrospective's root-cause analysis. This satisfies the *upstream-triggered* half of AC#9 (see AC#9 finding below for the half that is still open). |

### `cloud42-labo/experimental`

| Source | Class | Notes |
|---|---|---|
| `CLAUDE.md` | Keep, with one Duplicate fixed | Structure/session-start/self-merge/completion-transaction sections are project-local execution detail specific to how this repo's multi-app layout works — not duplicated elsewhere, correctly kept in full (the Notion completion-transaction procedure here is long and could arguably become a Skill Procedure some day, but it is not currently duplicated anywhere else, so it is classified Keep/Project-local rather than Duplicate; extracting it into a Skill is future work, not this pass's scope). |
| `GEMINI.md` | Keep | One line, `@CLAUDE.md` — correctly a pure include, zero duplication. |
| `AGENTS.md` | Project-local | Codex review checklist specific to this repo's actual past failures (GHA `if: secrets.X`, heredoc-vs-multiline `run:` blocks, unverified dependency versions). Explicitly designed to avoid generic-review noise; not duplicated elsewhere by design (each product repo's `AGENTS.md` has its own project-specific list — see serendipity-spot below, which shares the *format* but not the *content*, so this is intentional parallel structure, not duplication to collapse). |
| **Versioning table** (SemVer MAJOR/MINOR/PATCH rows) | **Duplicate — fixed** | Byte-identical to `brain/notes/semver-and-release-deliverables.md`'s table. Replaced with a reference-only sentence in this pass (see "Changes made"). |

### `cloud42-labo/management-simulation-game`

| Source | Class | Notes |
|---|---|---|
| `CLAUDE.md` | Keep, with one Duplicate fixed | Notion Epic pointer, file map, and GitHub/PR-review section (mirrors `experimental`'s merge model, explicitly, by reference — "運用は`experimental`と同じ") are all project-local and already reference-only where they should be. |
| `SKILL.md` (release procedure) | Skill Procedure, correctly repo-local | This is a genuine repo-specific *procedure* (deliverables-folder assembly, docx generation, release gate script) that does not belong in `cloud42-labo/skills` — it is tightly coupled to this repo's own `index.html`/Babel/docx toolchain and is already treated as such (a file literally named `SKILL.md`, not folded into `CLAUDE.md`). No change needed; noted here only because AC#2 asks every instruction source to be classified, and this is a correct example of the Skill-Procedure-vs-Policy split working at repo scale. |
| **Versioning table** | **Duplicate — fixed** | Same byte-identical table as `experimental/CLAUDE.md`; same fix applied. |
| **Deliverables section** | Already reference-only | Unlike the versioning table, this repo's Deliverables section already says "中身と作業手順は[SKILL.md](SKILL.md)を参照" instead of repeating deliverable contents — correctly not duplicated, no action needed. |

### `cloud42-labo/serendipity-spot`

| Source | Class | Notes |
|---|---|---|
| `CLAUDE.md` | Keep | The 3-point PR gate (Task Exists? / Reopen or New Task? / PR has Notion Traceability?) is project-local, motivated by a cited real incident (BUG-SPOT-03-01 / PR #22) rather than a hypothetical — a good instance of a Repo-local rule that should *not* be generalized upward (it is more strict than the org default, which R02 第8条1 explicitly permits: "本規程より厳しい品質手順をRepository固有要件として定めることができる"). |
| `AGENTS.md` | Project-local | Same Codex-review-checklist pattern as `experimental`'s, with entirely different concrete failure modes (adaptive-icon `<vector>` masking, OAuth scope minimization, Android permissions) because this is a different, real Android codebase. Correctly not shared text with `experimental/AGENTS.md` beyond the boilerplate GHA-`if:`-secrets and multiline-heredoc items, which recur because they are genuinely GitHub-Actions-universal footguns, not because one was copy-pasted from the other without adaptation. Not flagged as Duplicate: removing the shared items from one repo would lose real, load-bearing warnings for that repo's own CI. |
| No versioning-table duplication | — | This repo is already past `v1.0.0`, so its bump table (`1.x.x`→`2.0.0` etc.) is genuinely different content from the pre-1.0 table in brain's note, not a copy of it. Left untouched — collapsing it into the same reference as the pre-1.0 repos would lose the real distinction between pre- and post-1.0 bump semantics. |
| Merge-flow override (PR-then-stop, ChatGPT-side merge) | Keep, explicit override | Correctly states it is intentionally overriding the general default and names the source it overrides, rather than silently forking from it. |

### `cloud42-labo/ai-organization-design`

| Source | Class | Notes |
|---|---|---|
| `README.md` (no `CLAUDE.md`/`AGENTS.md`) | Gap, not itself Debt | This repo currently has no persistent Claude/Codex instruction file — a session here relies entirely on the operator/dispatcher having attached `brain` and on Notion Task bodies for execution detail. This is not "debt" in the duplication/conflict sense the rest of this inventory covers (there is nothing here to be redundant with), but it is a real inconsistency in coverage relative to every other active repo. Left unaddressed in this pass — creating a new `CLAUDE.md` from scratch is new-file authorship, not classification/consolidation, and is better scoped as its own small follow-up (candidate for `brain-setup`'s sibling pattern, or a short project-local file mirroring `ai-organization-design`'s own README content — "Repository boundary" section already reads like the seed of one). |

### `cloud42-labo/store-survival-simulator`

| Source | Class | Notes |
|---|---|---|
| `README.md` (single line, no `CLAUDE.md`/`AGENTS.md`) | Keep / Project-local (correct minimalism) | States plainly that this repo is a public playtest mirror and the actual source of truth is `cloud42-labo/experimental/store-survival-simulator`. Unlike `ai-organization-design`, this is not a coverage gap — there is genuinely nothing to instruct here beyond "don't develop here", which the one line already says. No action needed. |

## Duplicate findings and changes made

| # | Duplicate found | Where | Fix applied |
|---|---|---|---|
| 1 | SemVer MAJOR/MINOR/PATCH table, byte-identical | `experimental/CLAUDE.md` vs. `brain/notes/semver-and-release-deliverables.md` | Replaced the inline table in `experimental/CLAUDE.md` with a one-line reference to the brain note; kept the repo-specific `APP_VERSION`/graduation-trigger bullets that are not pure policy restatement. |
| 2 | Same table, byte-identical | `management-simulation-game/CLAUDE.md` vs. the same brain note | Same fix applied. |
| 3 | `serendipity-spot/CLAUDE.md`'s bump table | — | **Not** touched — its rows (`1.x.x`→`2.0.0` etc.) reflect post-v1.0 semantics genuinely different from the pre-1.0 table, so this is not the same duplicate; collapsing it would have lost real distinct content, which the Story's own instructions say not to risk. |

## Conflict found and change made

| # | Conflict | Where | Fix applied |
|---|---|---|---|
| 1 | `docs/regulations/R02-authority-regulation.md` §4.1 (self-merge repos: brain, experimental only) vs. `skills/CLAUDE.md` (claims a 2026-09-12 Owner-authorized self-merge exception for `cloud42-labo/skills` that was never synced into R02) | ADP regulation vs. repo-local instruction | Added `cloud42-labo/skills` to R02 §4.1 with a citation to `skills/CLAUDE.md`'s dated Owner-instruction claim, and updated R02's revision metadata. This is a **PR only** in `ai-development-platform` (not merged by this session) — R02 changes require Owner review per R03 第3条1, and this repo is not in the self-merge set. |

## Obsolete content found

No instruction-file content was found this pass that is actively misleading (stating a
rule that is currently false and could cause a wrong action). The one candidate —
`brain/decisions/0024-brain-non-experimental-no-self-merge.md` — is already correctly
self-flagged as superseded by brain's own `CLAUDE.md`, so it is functioning as designed
(append-only history, current Policy states the supersession) rather than being live Debt.

## Minor drift noted, not acted on

- **`deliveries/` vs. `deliverables/` folder naming.** `brain/notes/semver-and-release-deliverables.md`
  and `experimental/CLAUDE.md` both say `deliveries/`; `management-simulation-game/CLAUDE.md`
  and its actual folder (and `experimental/management-simulation/deliverables/`, the repo
  it was cut from) use `deliverables/`. Both spellings are already load-bearing in real
  folder names in different repos (`experimental/store-survival-simulator/deliveries/`,
  `experimental/serendipity-spot-android/deliveries/` vs.
  `experimental/management-simulation/deliverables/`), so this is pre-existing real-world
  drift, not a doc-only typo safe to silently "fix". Left as-is; flagged here so a future
  pass doesn't re-discover it from scratch.
- **AC#9 (Weekly Refinement Instruction/Skill Debt review).** `weekly-sprint`'s pipeline
  already wires the *upstream-triggered* half of this (Step 1 `upstream-change-review`
  emits "Instruction / Skill Debt Signals" → Step 3 `sprint-retrospective` treats them as
  root-cause input → Step 4 `backlog-refinement` receives Retrospective's Improvement
  Experiments as MISC). What is **not** yet present is a periodic, non-upstream-triggered
  Instruction/Skill Debt check — i.e. nothing currently prompts a re-read of an inventory
  like this one on a cadence when no vendor change occurred. Checked `ADP-054`'s Subtasks
  (T01–T19, the Skill-extraction Story referenced as a possible owner of this) for overlap:
  none of them mention Instruction/Skill Debt review; there is no duplicate work in flight.
  Not implemented in this pass, deliberately: the Story's own design principle is to
  prefer deletion/consolidation over new rule addition, and AC#10 explicitly warns against
  the watch itself becoming a source of rule bloat. Adding a mandatory new step to a Skill
  that already runs every week is exactly the kind of addition that principle cautions
  against without a concrete trigger. Recommended concrete next step for whoever picks
  this up: a single added line to `backlog-refinement`'s "Inputs" (or `weekly-sprint`
  Step 4), of the form "re-read `docs/instruction-skill-debt-inventory.md`; MISC-ify only
  if something changed since last read" — small enough not to add busywork on a
  no-change week, but this session is deliberately not guessing that wording into a Skill
  file without a chance for review.

## Verification of AC#5 (representative-Task check)

This session's own execution against the *simplified* instruction set (R02's compatibility
routing, `skills/CLAUDE.md`'s short self-merge exception text, `experimental`/
`management-simulation-game`'s now-reference-only versioning sections) did not surface any
unnecessary confirmation, stall, or review-churn attributable to the consolidated form —
the routing chain (repo CLAUDE.md → brain note / R02, as applicable) resolved in a single
read each time, with no ambiguity requiring a second lookup. This is a weak, single-session
signal, not a controlled before/after comparison; a stronger AC#5 verification would compare
execution against a Task from before this pass's edits vs. one after, which is better run as
a small follow-up once the consolidated files have been live for at least one more session.
