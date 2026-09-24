# Jev × ADP — Decision Point Inventory and Application Candidates

Date: 2026-09-24 (JST)
Status: Decision-support report (`ADP-065-T02`)
Scope: Inventory ADP's recurring Decision Points across Human Gate logic, Task
routing, Risk judgment/scoring, Review/Escalation logic, anomaly detection,
and Refinement; for each, define it structurally (Decision Type, Input state,
Typed output, Confidence threshold, Authority, Fallback, Evidence storage
location) and classify it as Jev向き / LLM向き / Human専用. This document is
the design/inventory deliverable itself — no PoC, no adapter code, no live
call to Jev's API.

Source of Truth for Jev's official spec: `ADP-065-T01` (Notion), grounded in
TypeSafe AI's own official docs. Treated here as established fact and not
re-derived. Recap only (see T01's Result for the full sourced write-up):
Jev is a hosted "System One model" API (`POST
https://api.typesafe.ai/v1/systemone`) that takes a `state` plus typed
questions and returns one of three typed output kinds — **Choice** (up to 255
options), **Score** (2–10 point scale), or **Noul** (a yes-probability).
Current stable model `jev-1.13.0` (alias `jev-latest`); $0.042/MTok input,
output free; 64k context/request, state+longest question up to 32k,
text-only. Official SDKs: Python/JavaScript. **API access has been
early-access/waitlist since 2026-09-15 and ADP does not currently have
confirmed access** — this document does not attempt a live call, per this
task's own Approach Decision.

## Executive summary

ADP already runs a fairly large number of recurring, *typed* judgment calls —
the Human Gate pre-flight's per-criterion classification, `agent-policy.yaml`'s
allow/require_approval/deny table, Backlog Refinement's MISC→Epic/Story
placement, Task Approach Review's sizing check, and the Monthly Risk Review's
severity/escalation triage are the clearest examples. Several of these are
structurally a near-exact match for Jev's `Choice`/`Score`/`Noul` output
kinds: bounded, repeated at volume, and already documented as classification
problems today (`docs/cloudflare-os-evaluation.md` §9's own
`decision = evaluate(actor, service, action, resource, environment,
task_context)` formula is, in effect, a hand-written description of a
`Choice` decision).

None of them should move to Jev as a full replacement for the human or LLM
judgment currently exercised. Every rule already carrying `decision: approve`
in `governance/agent-policy.yaml` (protected-branch merge, production
deploy, destructive delete, credential/authority change), and every
Human-only category in `governance/ai-execution-constraints.md`'s Human gate
pre-flight, stays exactly where it is: Jev has no authority to move those,
and this document does not propose weakening any existing gate to make room
for it. Where Jev fits at all, it fits as a **high-confidence-threshold
triage/pre-filter in front of an existing gate** — auto-acting only above a
calibrated confidence, and falling back to the LLM path or the Human path
ADP already uses today for everything below that threshold or outside its
bounded option set. This is also why every candidate below is written against
a swappable **Decision Adapter** interface (§5) rather than a hardcoded
dependency on `api.typesafe.ai`: today's adapter implementation is "the
acting LLM reasons about it directly," and Jev would be, at most, one
alternate implementation of that same interface, reversible the same way
`docs/claude-projects-evaluation.md` §5 makes Claude Projects itself
reversible as an Execution Adapter.

**Inventory result: 10 Decision Point candidates.** 6 Jev向き (as bounded
triage/pre-filters only), 3 LLM向き, 1 excluded from Jev's decision space
entirely — hardcoded and non-negotiable either way, but not uniformly
Human: DP-5 is Human/Owner for production/destructive/credential authority,
and deterministic AI cross-authority (not Human) for protected-branch merge
specifically, per R02 §4. See §4 for the summary table.

## 1. What counts as a "Decision Point" here

A candidate had to be: (a) a judgment ADP's own governance documents already
name as a recurring decision (not a one-off), (b) traceable to a specific
rule/schema/workflow file in this repository, and (c) something that
currently consumes AI or Human attention repeatedly. Purely mechanical
counting/threshold logic that requires no judgment at all (e.g. comparing an
integer to a constant) is noted where found, but is not itself a Jev/LLM
candidate — the inventory says so explicitly rather than forcing it into one
of the three buckets.

## 2. Decision Point candidates

### DP-1 — Acceptance-Criterion Human-only triage

- **Decision Type**: per-Acceptance-Criterion classification into
  `AI-verifiable` / `Human evidence already exists` / `Human-only`.
- **Input state**: the Acceptance Criterion text, the Task's current
  evidence (Notion Result/Decisions, GitHub PRs/commits/CI, prior search
  results), and the "Outcome-before-procedure" substitution question (could
  an AI-controlled change remove the manual step without changing the
  Outcome?).
- **Typed output**: **Choice** (3 options) for the base classification.
- **Confidence threshold**: high only (e.g. auto-classify only above a
  calibrated threshold on the unambiguous majority — read-only checks, CI/log
  inspection, deployment/test-suite execution, all of which
  `governance/ai-execution-constraints.md`'s "Default classification
  (`ADP-043-P`)" already treats as `AI-verifiable` by default). Anything
  ambiguous, anything touching the Outcome-before-procedure substitution
  question, and anything the criterion text itself frames as physical,
  account, legal, financial, or irreversible falls straight through to the
  existing LLM-driven pre-flight — never auto-acted on by Jev alone.
- **Authority**: the acting AI runs the pre-flight (`governance/
  ai-execution-constraints.md` "Human gate pre-flight"); regression cases
  (`HUMAN-ADP-EPIC-09-SR-T03`, PM-8) show misclassification has real cost in
  both directions, which is exactly why this is scoped as triage, not
  final say.
- **Fallback**: unchanged — the full LLM-run pre-flight procedure (evidence
  search, per-criterion classification, current-gate relevance check,
  written record) as it exists today.
- **Evidence storage location**: Notion Task `Result` / `Approach Decision`
  (per pre-flight step 7); `governance/state-transition-pre-check-regression-
  cases.md` and `docs/human-gate-pre-check-examples.md` for the regression
  fixtures a threshold would be tuned against.
- **Bucket: Jev向き** (bounded triage only, high threshold, LLM/Human fallback
  unchanged for everything else).

### DP-2 — AI-to-AI stop-gate necessity judgment

- **Decision Type**: whether a proposed action should cause another AI or
  workflow to stop/wait/lose authority.
- **Input state**: the proposed stop, and a precedence chain across five
  named sources (latest Owner instruction → repo-local `CLAUDE.md`/`AGENTS.md`
  → ADP regulations/this file → Brain Decision → current Task fields) per
  `governance/ai-execution-constraints.md` "AI-to-AI stop gate pre-flight."
- **Typed output**: superficially **Noul** (yes-probability of "stop is
  warranted"), but the actual work is citing which of five sources resolves
  a conflict and writing that citation into the record — open-ended
  synthesis and justification, not a fixed-type score.
- **Confidence threshold**: not applicable — a probability alone cannot
  satisfy step 6 ("record the checked sources... a newly invented stop with
  no cited authority is invalid").
- **Authority**: the acting AI (Claude or Chris/ChatGPT), per the
  representative regression case in that file (`experimental` PR #89).
- **Fallback**: none needed beyond the existing procedure — this is already
  fully AI-executable, just not by a fixed-type classifier.
- **Evidence storage location**: `Result`, `Approach Decision`, or PR
  discussion (pre-flight step 6); regression fixtures in `governance/
  authority-stop-gate-regression-cases.md`.
- **Bucket: LLM向き.**

### DP-3 — Backlog→Epic/Story placement routing

- **Decision Type**: which existing Epic/Parent Story a newly-placed MISC
  Task belongs under (or whether none fits and a new Epic/Story is needed).
- **Input state**: the Task's title/description, the current set of active
  Epics/Stories and their goals (`docs/epic-goal-quality-standard.md`), and
  placement evidence carried from MISC intake (`governance/
  ai-execution-constraints.md` "New Task placement pre-flight check").
  Placement itself is reserved to Backlog Refinement (hosted as
  `cloud42-labo/skills`' `backlog-refinement`/`hierarchical-refinement`
  Skills, indexed at `package/skills.md`; this repository is not where their
  procedure lives, only where the Rule requiring MISC-first intake does).
- **Typed output**: **Choice** among the current Epic/Story set (bounded —
  well under Jev's 255-option cap for any realistic ADP backlog size), plus
  a distinguished "none fit" option.
- **Confidence threshold**: high for routing to an *existing* Epic/Story
  only; the "none fit / needs a new Epic" branch is structural (creates
  durable hierarchy) and stays with `hierarchical-refinement`'s LLM-driven
  judgment regardless of any score.
- **Authority**: Backlog Refinement (weekly cadence, or on-demand per
  `governance/ai-execution-constraints.md` point 6), which alone is
  authorized to set Product/Epic/Parent Story on a Task.
- **Fallback**: unrouted items stay `MISC｜<title>` in `Backlog` until the
  next Backlog Refinement pass — identical to today's behavior when
  placement is unclear.
- **Evidence storage location**: Notion Task's `Product`/`Epic`/`Parent
  Story` fields and `Approach Decision`.
- **Bucket: Jev向き** (existing-target routing only; new-Epic/Story creation
  is explicitly out of scope for Jev).

### DP-4 — Ambiguous action → policy-category classification

- **Decision Type**: mapping an agent's proposed action to one of
  `governance/agent-policy.yaml`'s named `action`/`resource` categories
  (`read`, `notion-managed-task-update`, `github-working-branch`,
  `github-protected-merge`, `production-change`, `destructive-delete`,
  `credential-or-authority-change`, `self-authority-escalation`) when the
  action doesn't already deterministically match a rule row.
- **Input state**: `(actor, service, action, resource, environment,
  task_context)` — the exact tuple `docs/cloudflare-os-evaluation.md` §9's
  Phase-1 Policy Checker formula (`decision = evaluate(...)`) already names
  as the needed function signature.
- **Typed output**: **Choice** among the enumerated policy categories.
- **Confidence threshold**: high only; below threshold the action is treated
  as unmatched, which per the current (flagged-as-wrong) `default_decision:
  approve` auto-allows it today — `docs/cloudflare-os-evaluation.md` §10
  already records that this default must move to fail-closed
  (`deny`/`require_approval`) before this schema is authoritative. This
  inventory does not change that finding; it only notes that once fail-closed
  is in place, a below-threshold Jev classification would correctly fall
  through to `deny`/`require_approval`, not to `allow`.
- **Authority**: whichever component evaluates `agent-policy.yaml` — today
  this is undefined/unenforced (`docs/v1-asset-inventory.md`'s Freeze-scope
  exception; `schema_version` carries the `-experimental` suffix for exactly
  this reason).
- **Fallback**: unmatched action → deny/require_approval once fail-closed
  lands (not yet true today) → Human/LLM adjudication.
- **Evidence storage location**: `governance/agent-policy.yaml` itself
  (`audit: true` on every rule), plus whatever future enforcement-point log
  Phase 2 of `docs/cloudflare-os-evaluation.md` §9 introduces.
- **Bucket: Jev向き** (category triage only, feeding an already-deterministic
  table; does **not** touch the allow/require_approval/deny decision for any
  rule already marked `approve`/`deny` — see DP-5).

### DP-5 — Protected-branch merge / production / destructive / credential
authorization

- **Decision Type**: whether a protected-branch merge, production
  deploy/publish/config change, destructive delete/purge, or
  credential/permission/policy change may proceed.
- **Input state**: same tuple as DP-4, but these five `agent-policy.yaml`
  rule ids already carry `decision: approve` or `decision: deny`
  (self-authority-escalation) unconditionally — there is no ambiguous middle
  the classification in DP-4 is meant to resolve. **`decision: approve` is not
  itself "Human" — it means an approval gate is required, and which authority
  satisfies that gate is defined by R02, not by this policy file.** For
  `github-protected-merge` specifically, R02 §4 makes that gate a
  **repo-dependent, deterministic AI/Human split**, not a blanket Human one:
  self-merge repos (`brain`/`experimental`/`skills`) satisfy it via the
  acting AI itself (still subject to CI/P0/P1/mergeability gates, §4.1);
  every other repo — including this one — satisfies it via R02 §4.2's
  cross-AI Author≠Merger flow (Claude-authored PRs merged by Chris,
  Chris-authored PRs merged by Claude), with **"Ownerは通常のmerge
  operatorとしない"** stated explicitly. The other three rule ids
  (production deploy/publish/config change, destructive delete/purge,
  credential/permission/policy change) are different: R02 §7 and
  R03 reserve those specifically for Owner/Human
  (本人確認・credential発行・権限付与・支払・購入・契約等), with no AI or
  cross-AI substitute.
- **Typed output**: does not apply — this is not a probabilistic judgment at
  all; it is a hardcoded authority boundary either way (AI cross-authority
  for protected-branch merge, Human/Owner for the other three).
- **Confidence threshold**: not applicable. No confidence score changes the
  outcome, and no calibrated model may substitute its own judgment for any
  of these four regardless of confidence.
- **Authority**: protected-branch merge — the repo-dependent AI authority in
  R02 §4 above (self-merge AI, or cross-AI Chris/Claude), unless a
  Repository固有ルール or Owner's explicit instruction sets a different
  merge authority (R02 §4.2 last line). Production deploy/destructive
  delete/credential change — Human/Owner only (`R02-authority-regulation.md`
  §7, `R03-approval-regulation.md`).
- **Fallback**: n/a — this is itself the terminal/fallback state for DP-4's
  low-confidence and out-of-category cases, and for DP-1's genuinely
  Human-only Acceptance Criteria.
- **Evidence storage location**: `governance/agent-policy.yaml` rule
  definitions; Human Request records in Notion when the Human-only boundary
  (production/destructive/credential) is hit; PR merge record on GitHub for
  protected-branch merge.
- **Bucket: excluded from Jev — hardcoded, non-negotiable either way**
  (Human専用 for production/destructive/credential; deterministic AI
  cross-authority, not Human, for protected-branch merge — included in this
  inventory because the task's own acceptance criteria ask for the
  "merge authority on protected branches" example to be named directly
  rather than folded into DP-4, and because getting *who* holds that
  authority wrong would be exactly the kind of Jev/LLM boundary error §1
  warns against).

### DP-6 — Postmortem severity & escalation-category triage

- **Decision Type**: Monthly Risk Review §3–4's severity reassessment and
  per-risk decision (`Accept/monitor`, `Strengthen control`, `Escalate to
  Owner/Human`, `Close`).
- **Input state**: Postmortem record, recurrence history, affected
  rule/control family, current preventive-task status
  (`governance/monthly-risk-management-review.md` §"Required inputs" /
  §"Review sequence").
- **Typed output**: **Choice** (4-way: Accept/Strengthen/Escalate/Close) or
  **Score** (severity, mappable to Jev's 2–10 scale) for the triage pass.
- **Confidence threshold**: high, and — mirroring DP-5 — every item on the
  "Mandatory escalation to Owner/Human" list (secret/credential exposure,
  unapproved metered spend, external publication/reputation risk,
  irreversible production change, repeated violation after an implemented
  control) is excluded from Jev's decision space *before* triage even runs,
  regardless of any score it would produce. Jev, if used, only pre-sorts the
  remainder.
- **Authority**: Chris (ChatGPT) prepares the portfolio view; Owner makes
  escalation/acceptance decisions (`monthly-risk-management-review.md`
  §"Roles").
- **Fallback**: current fully-manual monthly review sequence.
- **Evidence storage location**: Monthly Risk Review record in Notion;
  Postmortems; Preventive Tasks.
- **Bucket: Jev向き** (triage/pre-sort only, with the mandatory-escalation
  list hardcoded out of its scope exactly as DP-5 is hardcoded out of DP-4's).

### DP-7 — Review-round same-objective / same-area gate

- **Decision Type**: `governance/review-loop-control.md`'s Round-3
  ("Approach Refinement trigger") and Round-5 ("hard cap") thresholds. Per
  §2, the round counter itself increments on **every** substantive
  review round for the same change objective/Task目的, regardless of which
  subsystem/area a given finding touches — it does **not** reset just
  because a new finding happens to concern a different subsystem. The
  counter only starts fresh for an intentional, Notion-recorded
  Split/Superseded replacement PR (§2's last bullet), never from area
  similarity/dissimilarity alone. The judgment that *does* recur is a
  separate, narrower question, upstream only of the **Round-3 trigger**
  (§3): whether 3 consecutive rounds' findings share "同一subsystem、state
  transition、invariant、migration、retry/failure mode、provenance model"
  — that same-area test decides whether Round-3's Approach-Refinement
  escalation fires, not whether the round counter itself increments or
  resets.
- **Input state**: current finding text vs. prior findings' subsystem/area
  in the same change objective, for the Round-3 same-area check only; the
  round counter itself needs just "was this call a substantive review
  round for this change objective: yes/no" (§2).
- **Typed output**: the counting itself fits no Jev type (it needs no model
  at all — an integer comparison that never resets on area grounds). The
  Round-3 same-area pre-check ("do 3 consecutive rounds share the same
  subsystem/area: yes/no") would be **Noul**.
- **Confidence threshold**: n/a for the counting; high-only for the Round-3
  same-area pre-check, with anything ambiguous resolved by the
  reviewer/acting agent as today.
- **Authority**: the acting agent tracking round count against
  `review-loop-control.md` §2–4; Owner approval required for round 6+.
- **Fallback**: manual same-area judgment (current behavior).
- **Evidence storage location**: Notion Task/Result or PR discussion
  (§6 "記録").
- **Bucket: LLM向き** for the Round-3 same-area sub-decision (the round
  counting itself needs no model, Jev or otherwise — noted per §1's rule
  that not every found Decision Point is a model candidate).

### DP-8 — Postmortem recurrence / common-mode pattern detection

- **Decision Type**: Monthly Risk Review §2 — grouping incidents "by rule
  family / control failure," detecting the same rule family failing again,
  multiple products failing at the same gate, controls existing only as
  reference text, Human remaining the only effective detector.
- **Input state**: the full set of Open/Actioning Postmortems and their
  narrative Timeline/Root-cause sections (`governance/
  postmortem-improvement-loop.md`), read across the whole portfolio, not one
  record at a time.
- **Typed output**: doesn't cleanly fit any of Jev's three kinds — clustering
  free-text incidents into "rule families" and recognizing a common-mode
  pattern across them is open-ended synthesis, not a fixed-option
  classification of one bounded input.
- **Confidence threshold**: n/a.
- **Authority**: Chris (ChatGPT), preparing the portfolio view.
- **Fallback**: n/a — already the only viable path.
- **Evidence storage location**: Monthly Risk Review record in Notion.
- **Bucket: LLM向き.**

### DP-9 — Task sizing / 1-AI-working-day fit check

- **Decision Type**: whether a Task/Subtask fits within 1 AI working day
  (`review-loop-control.md` §3 point 1) — part of Task Approach Review's
  Finalize step (hosted in `cloud42-labo/skills`' `task-approach-review`).
- **Input state**: Task description, scope, dependency count, prior
  splitting history for similar Tasks.
- **Typed output**: **Choice** (`fits-as-is` / `needs-split` /
  `needs-more-design`) or **Score** (rough estimated AI-working-days).
- **Confidence threshold**: high for the clear-fit case (small, well-scoped,
  single-failure-domain Tasks); anything borderline or already showing
  Round-3-style repeated findings (DP-7) escalates to LLM-driven
  decomposition — the actual *how* to split a Task is generative work Jev's
  fixed output types cannot do.
- **Authority**: `task-approach-review` (Finalize mode) /
  `hierarchical-refinement`.
- **Fallback**: existing LLM-run Approach Review procedure.
- **Evidence storage location**: Notion Task `Approach Decision`; Backlog
  Refinement records.
- **Bucket: Jev向き** (sizing triage only; actual decomposition design stays
  LLM向き).

### DP-10 — MISC duplicate / supersede detection

- **Decision Type**: whether a new MISC/Backlog item duplicates or should
  supersede an existing open Task, during Backlog Refinement intake
  (`governance/ai-execution-constraints.md` "New Task placement pre-flight
  check").
- **Input state**: new item's text vs. the set of currently open MISC/Backlog
  and near-duplicate Tasks.
- **Typed output**: **Noul** (yes-probability of duplicate/supersede match)
  per candidate pair.
- **Confidence threshold**: high for auto-flagging a likely duplicate for
  review; actually merging/consolidating content is left to the LLM-driven
  Backlog Refinement pass regardless of the flag's confidence, since
  consolidation changes Task content and must not happen unattended.
- **Authority**: Backlog Refinement.
- **Fallback**: unflagged items proceed through normal placement; flagged
  items get LLM review before consolidation.
- **Evidence storage location**: Notion Task `Approach Decision` / linked
  duplicate reference.
- **Bucket: Jev向き** (duplicate-candidate flagging only; consolidation
  itself stays LLM向き).

## 3. What Jev would not be trusted to do, anywhere in this inventory

Repeated across DP-1, DP-4, DP-6, DP-9, and DP-10: Jev, if adopted, is never
the thing that *acts* on a below-threshold or high-stakes result. It only
narrows what the existing LLM/Human path has to look at, and every rule
`agent-policy.yaml` already marks `approve`/`deny` (DP-5), every Human-only
Acceptance-Criterion category (DP-1's floor), and every mandatory-escalation
category in the Monthly Risk Review (DP-6's floor) is excluded from its
decision space before any confidence threshold is even evaluated — not
merely outvoted by one. This is the concrete form the task's "don't weaken
any existing ADP Policy/Rule to fit Jev" constraint takes in this design.

## 4. Bucket summary

| # | Decision Point | Typed output | Bucket |
|---|---|---|---|
| DP-1 | Acceptance-Criterion Human-only triage | Choice | Jev向き (triage) |
| DP-2 | AI-to-AI stop-gate necessity judgment | (Noul-shaped, but needs cited synthesis) | LLM向き |
| DP-3 | Backlog→Epic/Story placement routing | Choice | Jev向き (existing-target only) |
| DP-4 | Ambiguous action → policy-category classification | Choice | Jev向き (category triage) |
| DP-5 | Protected-branch merge / production / destructive / credential authorization | n/a | **Excluded from Jev** (Human専用 for production/destructive/credential; AI cross-authority per R02 §4 — not Human — for protected-branch merge) |
| DP-6 | Postmortem severity & escalation-category triage | Choice / Score | Jev向き (triage) |
| DP-7 | Review-round same-objective / same-area gate | Noul (upstream judgment only; counting itself needs no model) | LLM向き |
| DP-8 | Postmortem recurrence / common-mode pattern detection | doesn't fit | LLM向き |
| DP-9 | Task sizing / 1-AI-working-day fit check | Choice / Score | Jev向き (triage) |
| DP-10 | MISC duplicate / supersede detection | Noul | Jev向き (flagging only) |

**Split: 6 Jev向き (all scoped as triage/pre-filter, never final authority) /
3 LLM向き / 1 excluded from Jev entirely (DP-5 — mixed Human/Owner and AI
cross-authority, per R02 §4/§7; never a probabilistic judgment either
way).**

## 5. Decision Adapter shape (not implemented by this task)

Consistent with `docs/claude-projects-evaluation.md` §5's Execution Adapter
pattern, any future Jev usage should sit behind one interface, e.g.:

```
decision = decide(decision_point_id, state, typed_question, confidence_threshold)
  → { output_kind: Choice|Score|Noul, value, confidence, below_threshold: bool }
```

with the caller (the existing Skill/gate procedure for that Decision Point)
always retaining the fallback path already documented per-DP above. Today's
only implementation of `decide()` is "the acting LLM reasons about it
directly" — nothing about that changes until a later task actually builds an
adapter. Concretely, adopting Jev later means:

1. **No hardcoded TypeSafe dependency.** `decide()` is called by
   Decision-Point-specific call sites, not by rewriting `governance/
   ai-execution-constraints.md` or `agent-policy.yaml` to assume
   `api.typesafe.ai` exists.
2. **Fail-open only toward the existing fallback, never toward auto-action.**
   Below-threshold, out-of-bounds-option, and API-unavailable all resolve to
   "run the existing LLM/Human procedure," not to a default `allow`/`Done`.
3. **Metered-service and data-transfer gates apply unchanged.** Per
   `governance/research-security-policy.md` §1/§3/§4, any `state`/question
   payload sent to Jev must clear the public-information default and the
   extraction-budget/write-authority checks like any other external
   service call — Task text, Postmortem text, and policy-decision context are
   not automatically approved for external transfer merely because a
   Decision Point exists for them.
4. **Versioning.** If/when this Adapter is built, it is a new asset — most
   naturally a Schema (`agent-policy.yaml`-adjacent) or a Skill
   (`cloud42-labo/skills`), versioned per `docs/versioning-policy.md`'s
   existing per-class rules; this document does not itself bump any
   `adp-package.yaml` version field.

## 6. Explicit non-goals of this task

- No PoC and no adapter code — `ADP-065-T02`'s Approach Decision is
  inventory/design only, and API access is unconfirmed (early-access/waitlist
  since 2026-09-15).
- No change to `governance/agent-policy.yaml`'s `default_decision` (still
  the fail-open `approve` `docs/cloudflare-os-evaluation.md` §10 already
  flags as wrong) — fixing that is that document's own follow-up, not this
  one's.
- No change to any existing Human Gate, stop gate, or authority boundary.

## 7. Open items carried to later tasks

- Whether/when ADP gets confirmed Jev API access (`ADP-065-T01`'s own open
  item) gates any PoC.
- A real PoC (if access arrives) should start with DP-1 or DP-9 — the two
  candidates with the most existing regression fixtures
  (`governance/state-transition-pre-check-regression-cases.md`,
  `docs/human-gate-pre-check-examples.md`) to validate a calibrated
  confidence threshold against before trusting it with live triage.
- `governance/agent-policy.yaml` moving to fail-closed
  (`docs/cloudflare-os-evaluation.md` §10) is a prerequisite for DP-4's
  below-threshold case to behave safely; this inventory depends on that fix
  landing first, and does not substitute for it.

## Primary sources

- `ADP-065-T01` (Notion) — Jev's confirmed official spec (recap in this
  document's header only).
- This repository: `governance/ai-execution-constraints.md`,
  `governance/agent-policy.yaml`, `governance/review-loop-control.md`,
  `governance/monthly-risk-management-review.md`,
  `governance/postmortem-improvement-loop.md`,
  `governance/research-security-policy.md`, `governance/source-of-truth.md`,
  `docs/cloudflare-os-evaluation.md`, `docs/claude-projects-evaluation.md`
  (structural precedent for this document), `docs/versioning-policy.md`,
  `package/rules.md`, `package/workflows.md`, `package/skills.md`.
- `cloud42-labo/skills`: `backlog-refinement`, `task-approach-review`,
  `hierarchical-refinement` (referenced by name; their content is not
  reproduced here — see `package/skills.md` for why Skills content is not
  duplicated into this repository).
