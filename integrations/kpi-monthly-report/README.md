# AI Organization KPI — monthly report generator (ADP-055)

## Purpose

On the 1st of every month (JST), aggregate the **prior JST calendar month**
from Notion `Task Time Events` + `Stories & Tasks`, and from GitHub PR
activity, then create-or-update one Notion page titled
`AI Organization KPI｜YYYY-MM` under the existing
[`AI Organization KPI Framework｜週次・月次の能力配分とフロー管理`](https://app.notion.com/p/3d0fbd826f3b8109a68ffb338b31280f)
page.

**The KPI Framework page is the authoritative definition of every metric.**
This integration is only the `Scheduler = When` + `KPI Report Skill = How`
half the Framework page's own "自動生成の実装状態" section calls for — it
creates no new KPI database, and it never duplicates the Framework's
definitions here.

Flow:

`Apps Script time-driven trigger (day 1 of month, ~07:00 JST)` → `generateMonthlyKpiReport()` → `Notion Task Time Events / Stories & Tasks / Products (read)` + `GitHub Search API (read)` → `Notion page under AI Organization KPI Framework (create-or-update)`

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
- **"Blocked / Human Gate" section is a snapshot at report-generation time**
  (current `Status = Blocked` count, current Actionable Human Queue count —
  `Assigned Agent = Human` with `Status` in `Ready`/`In Progress`/`Review`,
  the same governed predicate as `governance/ai-execution-constraints.md`'s
  "Human Queue WIP constraint" and the Notion "Human Queue｜Actionable"
  view), plus Human Request Tasks whose `Completed At` falls inside the
  target month. It is **not**
  the weekly Blocked-reason classification (AI Dependency / True Human Gate
  / External Condition / Stale Blocker) the KPI Framework defines for Sprint
  Review — that classification reads free-text `Blocker` and requires
  human/AI judgment. Auto-classifying it here would be exactly the kind of
  guessed classification ADP-055's Acceptance Criteria prohibits, so this
  report states plainly what it does and does not compute (see the
  generated page's own "4. Blocked / Human Gate" section) instead of
  quietly approximating the weekly metric.
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
  page is found by its exact title (`findExistingReportPage_`) under the
  Framework page, and its content is fully replaced (`replacePageContent_`)
  rather than appended to — a re-run never creates a duplicate page and
  never leaves stale sections mixed with fresh ones.

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
- **Blocked "Age" is not reported.** Notion has no dedicated
  "became-Blocked-at" timestamp property, and this integration's Approach
  Decision explicitly rules out inventing new Stories & Tasks properties or
  a new KPI database for this task. Only a current Blocked *count* is
  reported; Age requires either a new property (a separate, explicitly
  scoped decision) or the weekly Sprint Review's own manual classification
  process.

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
