# AI Organization KPI / KMI — monthly report generator (ADP-055 / ADP-055-KMI)

## Purpose

On the 1st of every month (JST), aggregate the **prior JST calendar month**
from Notion `Task Time Events` + `Stories & Tasks`, and from GitHub PR
activity, then create-or-update one Notion page titled
`AI Organization KPI / KMI｜YYYY-MM` under the existing
[`AI Organization KPI / KMI Framework｜事業統制ツリー連動`](https://app.notion.com/p/3d0fbd826f3b8109a68ffb338b31280f)
page, in the **unified KPI/KMI format ADP-055-KMI defines**: every metric is
displayed paired (KPI = outcome/state, KMI = leading warning) and primarily
attributed to one of the Framework's 9 事業統制ツリー Management Points,
never as an independent metric list.

**The KPI / KMI Framework page is the authoritative definition of every
metric.** This integration is only the `Scheduler = When` + `KPI Report
Skill = How` half the Framework page's own automation section calls for — it
creates no new KPI database, and it never duplicates the Framework's
definitions here. Where the Framework defines a metric this integration has
no data source for (Context retention accuracy, Agent concurrency, Human
Attention time, evaluation-standard agreement, commercialization/revenue,
Postmortem recurrence classification, …), the generated report states
`Missing Data（未計測）` explicitly rather than approximating or guessing —
see "Scope decisions" below.

Flow:

`Apps Script time-driven trigger (day 1 of month, ~07:00 JST)` → `generateMonthlyKpiReport()` → `Notion Task Time Events / Stories & Tasks / Products (read)` + `GitHub Search API (read)` → `Notion page under AI Organization KPI / KMI Framework (create-or-update)`

### Report structure (ADP-055-KMI)

The generated page's section order:

1. Executive Summary (headline numbers, with month-over-month deltas once a
   prior month's snapshot exists — see "Month-over-month raw metrics" below)
2. **9 Management Points KPI / KMI** — one table row per Management Point
   (①〜⑨), each cell listing every metric the Framework defines for that
   point, computed where a data source exists and `Missing Data（未計測）`
   otherwise
3. Task Flow (Create / Close / 純増 / Close-Create比 / WIP, with a Type
   breakdown)
4. Delivery Flow — 3.1 PR Flow (Create/Merge, by repo and by Product) and 3.2
   Open PR Age (count / average Age / 48h超率, by repo and by Product)
5. Product別・Value Conversion横断分析 (the existing Product-level
   Capacity/Outcome table, plus Value Type coverage — what share of this
   month's completed Tasks even carry a `Value Type` at all, itself a
   measurement-quality KMI)
6. 構造的問題 — **intentionally left for the monthly Final Review to fill
   in**, not auto-generated. Turning this month's KPI/KMI numbers into a
   causal "structural problem" statement is a judgment call (interpreting
   *why* a number moved), not a data aggregation; auto-writing prose here
   would be exactly the kind of guessed classification this integration's
   Scope decisions rule out elsewhere. The Framework's own §5 Review Cadence
   already assigns this interpretation to the monthly Final Review
   (Human/AI judgment), the same way the weekly Blocked-reason
   classification is explicitly left to Sprint Review, not to this batch job.
7. 対策・Backlog / Sprint / 正本更新 — same reasoning as 6.; the Final
   Review appends its own remediation/owning-Skill mapping here.

A trailing, non-visible `code` block (language `json`, tagged with the
`ai-organization-kpi-raw-metrics-v1` marker) carries this month's headline
Flow numbers in machine-readable form — see "Month-over-month raw metrics".

Like `integrations/notion-time-events`, there is **no webhook, no public
endpoint, and no receiver credential**. Unlike that integration, this one is
a **standalone** Apps Script project — it is not bound to a Google
Spreadsheet, because it has no Sheets output at all; every output is the one
Notion page.

## Scope decisions (read before extending)

- **Product attribution for GitHub PRs** is done ONLY by matching a PR's
  `owner/repo/pull/<number>` against an existing Stories & Tasks
  `Pull Request` URL property, then reading that Task's `Product` relation.
  A PR with no matching Task, a matching Task with an empty `Product`, or a
  Task matching ambiguously (more than one hit) is reported under
  `Unknown/未分類`. **Never guessed from repo name, title, or branch.**
- **Blocked / Human Queue figures are a snapshot at report-generation time**
  (current `Status = Blocked` count, current Actionable Human Queue count —
  `Assigned Agent = Human` with `Status` in `Ready`/`In Progress`/`Review`,
  the same governed predicate as `governance/ai-execution-constraints.md`'s
  "Human Queue WIP constraint" and the Notion "Human Queue｜Actionable"
  view), plus Human Request Tasks whose `Completed At` falls inside the
  target month AND whose `Status` is `Done` (a Human Request Reopened and
  later closed as `Superseded` keeps its earlier `Completed At` but is
  excluded — see `queryCompletedTasksForRange_`). They surface inside
  Management Points ② and ⑧'s KPI/KMI cells (ADP-055-KMI's unified format
  attributes every metric to a Management Point rather than giving
  Blocked/Human Gate its own section). This is **not** the weekly
  Blocked-reason classification (AI Dependency / True Human Gate / External
  Condition / Stale Blocker) the Framework defines for Sprint Review — that
  classification reads free-text `Blocker` and requires human/AI judgment.
  Auto-classifying it here would be exactly the kind of guessed
  classification this integration's Acceptance Criteria prohibit, so the
  report states plainly what it does and does not compute instead of quietly
  approximating the weekly metric.
- **Task Flow (Create / Close / WIP) uses three separate queries.**
  `queryCreatedTasksForRange_` filters the built-in `Created` (`created_time`)
  property, with no `Status` restriction (Task Create is unconditional intake
  volume per the Framework's §3.1 definition). `queryClosedTasksForRange_`
  filters the custom `Closed At` date property **AND requires `Status` to be
  a terminal one (`Done` or `Superseded`)** — `Closed At` can be written
  while `Status` is still non-terminal (a documented partial-write/Reopen
  failure mode, `integrations/notion-time-events/README.md`); without the
  Status condition such a Task would be double-counted as both "closed" here
  and still-open WIP by `queryCurrentWipTasks_`, corrupting Close, Task純増
  (net), and the Close/Create ratio (Codex review, PR #74).
  `queryCurrentWipTasks_` is a `Status`-snapshot query
  (`Ready`/`In Progress`/`Review`/`Blocked`, excluding `Backlog` and the two
  terminal statuses). Task-level Age is **not** computed for the same reason
  given in "Known limitations" below (`Blocked "Age" is not reported`).
- **AI自律完遂率 / Human依存率** (`aggregateAiAutonomy_`) is computed only
  over this month's `Status = Done` Tasks whose `Assigned Agent` is actually
  set — a Task where it was never recorded is excluded from the denominator
  entirely, never guessed as either AI or Human. Any non-empty value other
  than the literal `Human` counts as an AI actor (`Claude`, `Claude Sonnet`,
  `Codex`, …), mirroring the Framework's own manual 2026-09 calculation.
- **Value Type coverage** (`aggregateValueTypeCoverage_`) reports what share
  of this month's completed Tasks carry a `Value Type` at all — a
  measurement-quality KMI in its own right (the Framework's 2026-09 Baseline
  flagged this at 3.1%), not filled in or inferred for Tasks missing it.
- **Open PR Age / 48h超率** (`aggregateOpenPrs_`, Management Point ①'s KMI)
  is a separate current-time `is:open` search per repo, distinct from the
  created/merged-in-month search `githubSearchPRs_` already runs — an Open
  PR's Age is `now - created_at`, so it is only meaningful as of
  report-generation time, not as a monthly aggregate. Product attribution
  reuses the same `lookupProductForPr_` a created/merged PR gets.
- **Active/Waiting hours are read from Notion's own `Active Hours` /
  `Waiting Hours` formula properties** on each Task Time Event — the same
  authoritative computation `Stories & Tasks`' own rollups use — never
  recomputed independently from `Started At`/`Ended At`.
- **Month membership for a Task Time Event is decided by `Started At`
  only.** An event that starts in the target month but ends in the next one
  has its whole recorded duration attributed to the start month. This is
  the same simplification the existing daily/weekly aggregation already
  makes; it is not a new imprecision introduced here.
- **A Time Event still open (no `Ended At`) at report-generation time
  contributes `0` hours**, because Notion's `Active Hours`/`Waiting Hours`
  formulas are read as-is rather than recomputed against "now". Since this
  report always targets a month that has already fully elapsed by the time
  it runs (the 1st of the following month), this only matters for a Task
  that has genuinely stayed `In Progress` continuously across the month
  boundary — an already-rare state this integration does not special-case.
- **GitHub scope is a fixed repo list** (`GITHUB_REPOS`, default: the seven
  repos in the KPI Framework page's own 2026-08 baseline table). A repo not
  in that list is invisible to this report — a documented limitation, not a
  silent gap. Extend it via the `GITHUB_REPOS` Script Property (JSON array
  of `"owner/repo"` strings) without touching code.
- **GitHub Search API result volume is capped** at
  `GITHUB_SEARCH_MAX_PAGES * 100` (300) PRs of one kind (created or merged)
  per repo per month, and the API itself caps any single search at 1000
  results regardless. Both this repo's 2026-08 baseline (255 PRs across ALL
  seven repos combined, for a whole month) and normal operation are far
  below this; if it is ever hit, the generated report's top callout says so
  explicitly (`truncated`) rather than silently under-counting.
- **Re-running for an already-reported month is safe and idempotent.** The
  page is found by its exact title (`findExistingReportPageWithFallback_` —
  see "Legacy title fallback" below), and its content is fully replaced
  (`replacePageContent_`) rather than appended to — a re-run never creates a
  duplicate page and never leaves stale sections mixed with fresh ones.
- **Sections 5 (構造的問題) and 6 (対策) are intentionally left for the
  monthly Final Review, not auto-generated.** Interpreting *why* a KPI/KMI
  moved is a human/AI judgment call the Framework's own §5 Review Cadence
  assigns to the 1st-of-month Final Review, not a data aggregation this
  batch job should approximate — see "Report structure" above. Because a
  rerun (`replacePageContent_`) otherwise deletes every top-level block, this
  content is read back and re-embedded across a rerun — see "Preserving
  Final Review content across reruns" below.

### Preserving Final Review content across reruns

`replacePageContent_` deletes every existing top-level block before
rebuilding a page from the latest aggregates — necessary so a rerun never
leaves stale sections mixed with fresh ones (see "Re-running..." above), but
that would also silently destroy any §5/§6 content a Final Review had
written directly onto the page (Codex review, PR #74). Before calling
`replacePageContent_`, `generateMonthlyKpiReportForMonth_` reads the
existing page's current children and pulls out whatever sits in §5/§6 beyond
this file's own regenerated placeholder callout
(`extractPreservedSections_` / `extractSectionHumanContent_`, matched by the
exact heading/placeholder text `SECTION5_HEADING`/`SECTION5_PLACEHOLDER_TEXT`
/ `SECTION6_HEADING`/`SECTION6_PLACEHOLDER_TEXT`/`DATA_QUALITY_HEADING`
declare once and share with `buildReportBlocks_`). `buildReportBlocks_`
re-embeds that content immediately after each section's freshly regenerated
placeholder, so the rebuilt page is a strict superset of the previous one
(this month's fresh aggregates plus whatever Final Review content already
existed) rather than a regression to an empty placeholder.

**A failed read here aborts the whole month, it does not degrade to
"nothing to preserve".** `extractPreservedSections_` does not catch its own
`fetchPageChildren_` call — a genuine read failure (transient network/API
error, malformed response, ...) propagates all the way out of
`generateMonthlyKpiReportForMonth_` (through `withRunLock_`'s try/finally,
which releases the lock but does not swallow the exception) *before*
`renameReportPage_`/`replacePageContent_` ever runs (Codex review, PR #74,
follow-up finding on the original fix in 8677c85: catching that error and
substituting empty sections had made a merely-failed read indistinguishable
from a page that legitimately has no §5/§6 content yet, after which the
rerun proceeded to delete the page's real, unread content anyway). "The page
has no §5/§6 heading" is not an error case needing a catch here — it already
returns cleanly as an empty array via `extractSectionHumanContent_`'s own
ordinary `indexOf`-not-found control flow, not via a caught exception.

Each preserved block is sanitized (`sanitizeBlockForAppend_`) from the shape
the Notion API returns (which carries `id`, `created_time`, etc. the create/
append endpoints reject) down to the shape they accept, recursing into any
block with children (a table's rows, a toggle's nested content, ...) the
same way `tableBlock_` already embeds `table_row` children inline. **Known
gap**: a block whose type-specific data itself contains a short-lived
reference — most notably an uploaded `image`/`file` block's expiring
internal URL — cannot be faithfully re-posted this way. Realistic Final
Review content (headings, paragraphs, lists, callouts, quotes, tables,
to-dos, code, dividers) has no such field, so this is an accepted,
documented limitation rather than something this integration solves.

### Legacy title fallback

ADP-055-KMI renamed the live report page title going forward
(`REPORT_TITLE_PREFIX`, `AI Organization KPI / KMI｜`), but
`generateMonthlyKpiReportFor` explicitly supports backfilling or rerunning
ANY past month per its own docstring — a month whose page was created under
the pre-rename title (`LEGACY_REPORT_TITLE_PREFIX`, `AI Organization KPI｜`)
and never manually renamed must still be found and updated, not duplicated
under the new title (Codex review, PR #74; this is also what Acceptance
Criterion 11 requires). `findExistingReportPageWithFallback_` checks the
current title first and only falls back to the legacy one if that misses;
`fetchPreviousMonthRawMetrics_` uses the same fallback so a month-over-month
comparison isn't lost across the rename either. When a legacy-titled page is
found, `renameReportPage_` migrates its title to the current one as part of
that same update, so a later lookup for the same month takes the cheaper,
first-checked current-title path — the integration converges on one title
scheme instead of permanently carrying both.

### Month-over-month raw metrics

Acceptance Criterion 12 requires 10月以降 (October onward) to add a
month-over-month comparison once 2026-09 is the Framework's Baseline month.
Re-parsing the previous month's *rendered* prose to recover its numbers would
be fragile (a wording change breaks the parse silently) and would itself be
a kind of guessed value. Instead, every generated report appends its own
headline Flow metrics as a small fenced `code` block (language `json`)
tagged with the literal marker `ai-organization-kpi-raw-metrics-v1`
(`buildRawMetricsBlock_`). The following month's run looks for that
month's report page under the same Framework page and, if found, reads that
block back structurally (`fetchPreviousMonthRawMetrics_` /
`fetchPageChildren_`) instead of parsing text. A missing prior page, a
missing tagged block, or unparseable JSON all degrade to "no comparison
available" (`previousMetrics: null`) rather than throwing — the current
month's report is never blocked by a broken or absent prior snapshot.

## Setup

**Deploying this is a Human step** (see "Deployment" below) — this
repository can only ship the code and tests, not create/configure an Apps
Script project or authorize it. This mirrors the precedent in
`HUMAN-BUG-ADP-STATUS-02-DEPLOY` for `integrations/notion-time-events`.

1. In the Apps Script editor ([script.google.com](https://script.google.com)), create a new **standalone** project (File → New project). Do not bind it to a Spreadsheet — this integration has no Sheets output.
2. Replace `Code.gs` with the current version from this directory.
3. Under **Project Settings → Script Properties**, add:
   - `NOTION_TOKEN` — same Notion integration token used by `integrations/notion-time-events`, with read access to `Stories & Tasks`, `Task Time Events`, `Products`, and both **Insert Content** AND **Update Content** capability under the `AI Organization KPI Framework` page (Insert Content alone lets the first run create the monthly report page, but every rerun fails at `DELETE /v1/blocks/{id}` without Update Content too — see "Notion connection requirements" below).
   - `GITHUB_TOKEN` — a token (fine-grained PAT or GitHub App installation token) with `Contents: read` / `Pull requests: read` (or `public_repo` scope for a classic PAT) across the repos in `GITHUB_REPOS`.
   - Never set either from committed code, logs, or the Sheet — there is no Sheet here at all.
4. Run `setup()` once from the editor. It records the default data-source/page IDs as Script Properties (only if not already set — safe to re-run) and installs the `generateMonthlyKpiReport` time-driven trigger (day 1 of month, ~07:00 `Asia/Tokyo`). Authorize the script when prompted.
5. Run `showSetupInfo()` and confirm `notionTokenConfigured: true`, `githubTokenConfigured: true`, and `monthlyTriggersInstalled: 1`.
6. To generate (or backfill) a specific month without waiting for the trigger, run `generateMonthlyKpiReportFor('2026-09')` from the editor. Safe to re-run for the same month — see "Re-running" above.

There is nothing to deploy beyond this: the project is not a Web App and defines no `doGet`/`doPost`.

### Trigger timing

Apps Script time-driven triggers do not guarantee the exact minute — actual
firing is commonly a few minutes to roughly an hour after the configured
time. This does not affect correctness: `computeTargetMonth_` derives the
target month from the JST calendar date at the moment the trigger actually
fires ("the JST month before the one `now` is currently in"), not from a
fixed clock assumption. A trigger firing anywhere on JST day 1 — early
morning or late in the day — still targets the correct prior month.

### Updating `notes/claude-scheduled-jobs.md` and the Notion Job Schedule page

**Not done by this PR.** Both `cloud42-labo/brain`'s
`notes/claude-scheduled-jobs.md` and the Notion
`Job Schedule｜AI自動実行スケジュール` page document only **Claude Code
Routines** (the scheduler this session can register via `create_trigger`),
not Apps Script's own internal time-driven triggers — the existing
`integrations/notion-time-events` reconciler's 5-minute poll trigger was
never listed there either, for the same reason. The Human who deploys this
integration and runs `setup()` is installing the equivalent of that
existing, already-precedented, un-listed trigger category. If that
precedent should change (listing Apps Script triggers there too), that is a
separate decision, not something to infer here.

## Notion connection requirements

Same connection `integrations/notion-time-events` already uses, plus scope
under the KPI Framework page:

- Read access to `Stories & Tasks`, `Task Time Events`, `Products`.
- **Insert Content** capability under the `AI Organization KPI Framework`
  page specifically (to create the first monthly report page there; every
  later page update only needs to touch that already-shared page and its
  own children, not the Framework page's own content).
- **Update Content** capability as well — a rerun for an already-generated
  month deletes that month's existing report-page child blocks
  (`DELETE /v1/blocks/{id}`) before appending fresh ones, and Notion
  requires Update Content for that endpoint. Insert Content alone lets the
  first run create a report but makes every rerun fail before it can
  refresh one.

`Stories & Tasks`.`Status`/`Type` are Notion **`select`** properties, not
the distinct **`status`** property type — the same schema fact
`integrations/notion-time-events`'s README documents; every filter this
file builds against them uses the `select` shape.

## Known limitations

- **No secondary sort key inside a GitHub Search API date-range tie.** Not
  applicable here at current volume (see "GitHub Search API result volume"
  above); flagged for completeness, mirroring how the sibling integration
  documents its own extreme-scale edges.
- **PR → Product attribution requires the Task's `Pull Request` property to
  already be recorded with the merged/created PR's real URL**, matched by
  the literal substring `owner/repo/pull/<number>`. A Task whose `Pull
  Request` field was never filled in, or was recorded before the PR number
  was known, is reported under `Unknown/未分類` even though a human could
  trace the connection some other way (commit message, branch name). This
  integration does not attempt that inference — see "Scope decisions"
  above.
- **A Time Event spanning a month boundary (`Started At` in one month,
  `Ended At` in the next) has its whole duration counted in the start
  month.** See "Scope decisions" above; this is an accepted simplification
  shared with the existing daily/weekly aggregation, not unique to this
  file.
- **Blocked "Age" is not reported, and neither is any other Task-level Age
  (WIP/Blocked dwell time).** Notion has no dedicated
  "became-Blocked-at"/"became-WIP-at" timestamp property, and this
  integration's Approach Decision explicitly rules out inventing new
  Stories & Tasks properties or a new KPI database for this task. Only
  current *counts* are reported (current Blocked count, current WIP count);
  Age requires either a new property (a separate, explicitly scoped
  decision) or the weekly Sprint Review's own manual classification process.
  Open PR Age is the one Age metric this report does compute, because GitHub
  already exposes `created_at` on every PR — no new property is needed there.
- **9 Management Points ③–⑦ and ⑨ are entirely `Missing Data（未計測）`.**
  This integration has no data source for experiment→outcome conversion,
  parallel-project counts, context-retention accuracy, Agent concurrency,
  commercialization/revenue, or Postmortem recurrence classification — see
  the Framework's own §7 Measurement Status. Reporting these as Missing Data
  rather than omitting the rows keeps the 9-row structure Acceptance
  Criterion 2 requires, without inventing values.
- **"Humanレビュー工数比率" and "Human Waiting Ratio" in Management Point ②
  are explicitly labeled Proxy, not exact.** They are computed from the
  `Human` actor's share of total Active/Waiting hours across ALL Task Time
  Events, not specifically review work — the `Work Type` property
  distinguishes `Initial Work`/`Review Fix`, not who did the reviewing. A
  true "Human review-only" hours metric would need a `Work Type` value (or
  separate property) this integration does not invent here.

## Tests

```
node --test test/*.test.mjs
```

Runs under plain Node (`node:test` + `node:vm`), the same pattern
`integrations/notion-time-events` uses — no Apps Script environment or
network access required. `test/support/gas-sandbox.mjs` provides a minimal
GAS runtime shim (`PropertiesService`, `LockService`, `ScriptApp` triggers,
`UrlFetchApp`) and a `fetchStub` helper for routing fake Notion/GitHub API
responses by method + path.

`test/task-flow.test.mjs`, `test/value-type-and-autonomy.test.mjs`,
`test/open-pr.test.mjs`, and `test/raw-metrics.test.mjs` cover the
ADP-055-KMI additions (Task Flow queries/aggregation, Value Type coverage,
AI autonomy, Open PR Age, and the month-over-month raw-metrics round trip).
`test/final-review-preservation.test.mjs` and
`test/legacy-title-migration.test.mjs` cover the three Codex-review fixes on
PR #74 (preserving §5/§6 human content across a rerun, requiring a terminal
Status for Task Close, and the legacy-title fallback/migration — see
"Preserving Final Review content across reruns" and "Legacy title fallback"
above). `test/full-report-smoke.test.mjs` is an end-to-end smoke test with
non-trivial data on every query path — the create/update idempotency tests
use entirely empty data, which would not have caught a runtime error
(undefined access, division by zero) reachable only when the 9 Management
Points table, Task Flow, and Open PR sections actually have numbers to
render.

Objects returned by a sandboxed function are constructed inside the `vm`
context, so their `Object.prototype` is not reference-equal to the test
file's own realm — comparing such an object with `assert.deepEqual` fails
even when every enumerable value matches. Tests compare these objects
field-by-field with `assert.equal` instead (the same pattern the existing
`aggregate-tasks.test.mjs` suite already uses).
