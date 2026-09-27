// AI Organization KPI — monthly report generator (ADP-055)
//
// Purpose: on the 1st of each month (JST), aggregate the PRIOR JST calendar
// month from Notion `Task Time Events` + `Stories & Tasks` and from GitHub
// PR activity, and create-or-update one Notion page titled
// `AI Organization KPI / KMI｜YYYY-MM` under the existing
// `AI Organization KPI / KMI Framework｜事業統制ツリー連動` page, in the
// unified KPI/KMI-paired-by-Management-Point format ADP-055-KMI defines.
//
// This file is a STANDALONE Apps Script project (time-driven trigger only,
// no Web App, no bound Spreadsheet — there is no Sheets output here, unlike
// integrations/notion-time-events). It reuses the same security model as
// that integration: no inbound endpoint, one secret per external API in
// Script Properties, and every mutation derived from data re-fetched over an
// authenticated API call. See README.md "Setup" for how to deploy it — that
// is a Human step this repository cannot perform (see README "Deployment").
//
// Scope decisions this file makes explicit (see README "Known limitations"
// for the reasoning behind each):
//   - Product attribution for GitHub PRs is done ONLY by matching a PR's
//     html_url against an existing Stories & Tasks `Pull Request` property.
//     A PR with no matching Task, or a matching Task with no Product set, is
//     reported under UNKNOWN_LABEL. Never guessed from repo name alone.
//   - "Blocked / Human Gate" stats are a snapshot at report-generation time
//     (current `Status = Blocked` count, current open `Type = Human Request`
//     count), plus Human Request Tasks completed inside the target month —
//     NOT the weekly Blocked-reason classification (AI Dependency / True
//     Human Gate / External Condition / Stale Blocker) the KPI Framework
//     defines for Sprint Review. That classification requires reading free
//     text (`Blocker`) and is a human/AI judgment call this monthly batch
//     job does not attempt — doing so would be exactly the kind of guessed
//     classification the task's Acceptance Criteria prohibits.
//   - A Task Time Event that started in the target month but ended in the
//     next one has its whole duration attributed to the start month (same
//     simplification the existing daily/weekly aggregation already makes).

const DEFAULTS = {
  NOTION_VERSION: '2026-03-11',
  TASKS_DATA_SOURCE_ID: 'fc5e770f-c68e-4799-afe7-ec4bff0dab59',
  TIME_EVENTS_DATA_SOURCE_ID: '544b9a17-2653-47aa-b62c-bb52425b3bf2',
  PRODUCTS_DATA_SOURCE_ID: '2cee4878-ea37-485d-a57d-ae117387a640',
  // "AI Organization KPI / KMI Framework｜事業統制ツリー連動"
  KPI_FRAMEWORK_PAGE_ID: '3d0fbd826f3b8109a68ffb338b31280f',
  // Repositories the GitHub aggregation scans. Any repo not listed here is
  // invisible to this report — a documented limitation, not a silent gap.
  // Sourced from the KPI Framework page's own 2026-08 baseline table.
  GITHUB_REPOS: [
    'cloud42-labo/brain',
    'cloud42-labo/experimental',
    'cloud42-labo/serendipity-spot',
    'cloud42-labo/ai-organization-design',
    'cloud42-labo/ai-development-platform',
    'cloud42-labo/management-simulation-game',
    'cloud42-labo/skills',
  ],
  // Day-of-month + JST hour the monthly trigger fires on. Apps Script
  // time-driven triggers do not guarantee the exact minute; the aggregation
  // itself is date-driven (computeTargetMonth_), not clock-driven, so a
  // trigger firing a little late on day 1 still computes the correct prior
  // month.
  TRIGGER_DAY_OF_MONTH: 1,
  TRIGGER_HOUR_JST: 7,
};

const UNKNOWN_LABEL = 'Unknown/未分類';
const MISSING_DATA_LABEL = 'Missing Data（未計測）';
// ADP-055-KMI renamed the live monthly report page from
// "AI Organization KPI｜YYYY-MM" to "AI Organization KPI / KMI｜YYYY-MM" as
// part of moving to the unified KPI/KMI format (the 2026-09 page under the
// Framework page already carries this title). REPORT_TITLE_PREFIX must match
// the page's REAL title exactly — findExistingReportPage_ matches by exact
// title string — otherwise a re-run would create a second, duplicate page
// instead of updating the existing one (violates Acceptance Criterion 11).
const REPORT_TITLE_PREFIX = 'AI Organization KPI / KMI｜';
// The title every report page carried before ADP-055-KMI's rename above.
// `generateMonthlyKpiReportFor` can be (and per its own README is meant to
// be) called to backfill/rerun ANY past month, not just ones already
// migrated to the new title — a month whose page still carries this legacy
// title must still be found and updated in place, never re-created under
// the new title as a duplicate (Codex review, PR #74; Acceptance
// Criterion 11). See findExistingReportPageWithFallback_.
const LEGACY_REPORT_TITLE_PREFIX = 'AI Organization KPI｜';
// An Open PR older than this (hours) counts toward the KMI "48h超率" — the
// same 48h threshold the AI Organization KPI / KMI Framework's Management
// Point ① KMI column defines ("Open PR Age・48h超率"). Not independently
// invented here.
const OPEN_PR_AGE_ALERT_HOURS = 48;
// Marks the machine-readable metrics snapshot appended to every generated
// report page (see "Month-over-month raw metrics" below). ADP-055-KMI
// Acceptance Criterion 12 requires 10月以降 (October onward) to add a
// month-over-month comparison once 2026-09 is Baseline. Re-parsing rendered
// prose from the previous month's page would be fragile and would risk
// silently misreading a number — exactly the kind of guessed value this
// integration's own Scope decisions rule out. Instead each run appends its
// own key metrics as a fenced JSON code block tagged with this marker, and
// the following month's run reads that block back structurally instead of
// parsing rendered text.
const RAW_METRICS_MARKER = 'ai-organization-kpi-raw-metrics-v1';

// §5/§6 headings and this file's own regenerated placeholder callout text,
// each declared once here and reused by both buildReportBlocks_ (which
// writes them) and extractPreservedSections_ (which reads them back before a
// rerun deletes them) — see "Preserving Final Review content across
// reruns" below. Keeping one definition prevents the two from silently
// drifting apart.
const SECTION5_HEADING = '5. 構造的問題';
const SECTION5_PLACEHOLDER_TEXT =
  '本セクションは自動集計の対象外。上記KPI/KMIから構造的問題を判断する作業（Management Point → KPI → KMI → 構造的問題という因果解釈）は、' +
  'Framework §5 Review Cadenceが定める毎月1日の前月Final Review（Human/AI判断）でこのページへ直接追記する。' +
  '推測分類を自動生成しないという本統合の一貫した方針（README Scope decisions）に従い、空欄のまま生成する。';
const SECTION6_HEADING = '6. 対策・Backlog / Sprint / 正本更新';
const SECTION6_PLACEHOLDER_TEXT =
  '同じく前月Final Reviewで、セクション5の構造的問題ごとに対策と担当Skill（例: pr-review-convergence / human-gate-preflight / ' +
  'backlog-refinement / sprint-planning / sprint-retrospective）を追記し、必要な変更をBacklog・Sprint・正本ドキュメントへ反映する。';
const DATA_QUALITY_HEADING = 'データ品質・Unknown/未分類の扱い';

// Notion search API page size / GitHub search API page size share this cap.
const MAX_PAGE_SIZE = 100;
// GitHub Search API cannot return more than 1000 results for one query
// regardless of pagination; beyond that only total_count is trustworthy.
const GITHUB_SEARCH_HARD_CAP = 1000;
// How many GitHub search result pages we actually walk per query, to keep
// a single monthly run's GitHub calls bounded. 3 pages * 100 = 300 PRs of a
// single kind (created or merged) in one repo in one month comfortably
// exceeds anything this org has produced (2026-08 baseline: 255 PRs across
// ALL seven repos combined for the whole month).
const GITHUB_SEARCH_MAX_PAGES = 3;

// ---------------------------------------------------------------------------
// Setup / trigger management
// ---------------------------------------------------------------------------

function setup() {
  const props = PropertiesService.getScriptProperties();
  props.setProperties({
    TASKS_DATA_SOURCE_ID: props.getProperty('TASKS_DATA_SOURCE_ID') || DEFAULTS.TASKS_DATA_SOURCE_ID,
    TIME_EVENTS_DATA_SOURCE_ID: props.getProperty('TIME_EVENTS_DATA_SOURCE_ID') || DEFAULTS.TIME_EVENTS_DATA_SOURCE_ID,
    PRODUCTS_DATA_SOURCE_ID: props.getProperty('PRODUCTS_DATA_SOURCE_ID') || DEFAULTS.PRODUCTS_DATA_SOURCE_ID,
    KPI_FRAMEWORK_PAGE_ID: props.getProperty('KPI_FRAMEWORK_PAGE_ID') || DEFAULTS.KPI_FRAMEWORK_PAGE_ID,
    GITHUB_REPOS: props.getProperty('GITHUB_REPOS') || JSON.stringify(DEFAULTS.GITHUB_REPOS),
  }, false);

  installMonthlyTrigger();
  Logger.log('Setup complete. This project has no public endpoint. It stores NOTION_TOKEN and GITHUB_TOKEN in Script Properties only — set both manually before the first real run.');
}

function showSetupInfo() {
  const props = PropertiesService.getScriptProperties();
  Logger.log(JSON.stringify({
    notionTokenConfigured: Boolean(props.getProperty('NOTION_TOKEN')),
    githubTokenConfigured: Boolean(props.getProperty('GITHUB_TOKEN')),
    tasksDataSourceId: tasksDataSourceId_(),
    timeEventsDataSourceId: timeEventsDataSourceId_(),
    productsDataSourceId: productsDataSourceId_(),
    kpiFrameworkPageId: kpiFrameworkPageId_(),
    githubRepos: githubRepos_(),
    monthlyTriggersInstalled: monthlyTriggers_().length,
  }, null, 2));
}

function installMonthlyTrigger() {
  removeMonthlyTriggers();
  ScriptApp.newTrigger('generateMonthlyKpiReport')
    .timeBased()
    .onMonthDay(DEFAULTS.TRIGGER_DAY_OF_MONTH)
    .atHour(DEFAULTS.TRIGGER_HOUR_JST)
    .inTimezone('Asia/Tokyo')
    .create();
  Logger.log('Installed generateMonthlyKpiReport trigger: day ' + DEFAULTS.TRIGGER_DAY_OF_MONTH + ' of month, ~' + DEFAULTS.TRIGGER_HOUR_JST + ':00 Asia/Tokyo.');
}

function removeMonthlyTriggers() {
  monthlyTriggers_().forEach(function (trigger) {
    ScriptApp.deleteTrigger(trigger);
  });
}

function monthlyTriggers_() {
  return ScriptApp.getProjectTriggers().filter(function (trigger) {
    return trigger.getHandlerFunction() === 'generateMonthlyKpiReport';
  });
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

// Trigger entry point. Always targets "the JST calendar month before the one
// this run is currently in" — see computeTargetMonth_.
function generateMonthlyKpiReport() {
  return withRunLock_(function () {
    const target = computeTargetMonth_(new Date());
    return generateMonthlyKpiReportForMonth_(target);
  });
}

// Operator escape hatch for a manual/backfill run of a specific month, e.g.
// generateMonthlyKpiReportFor('2026-09'). Runs the identical pipeline as the
// trigger; safe to call for the current live month too — the page is always
// created-or-updated idempotently by title, never duplicated.
function generateMonthlyKpiReportFor(label) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(label));
  if (!match) throw new Error('generateMonthlyKpiReportFor expects "YYYY-MM", got: ' + label);
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) {
    throw new Error('generateMonthlyKpiReportFor: month must be 01-12, got: ' + label);
  }
  // A leading-zero year like "0026" is syntactically \d{4} but Number()
  // collapses it to 26 — Date.UTC(26, ...) then applies JS's legacy
  // two-digit-year remap to 1926, silently mislabeling and misdating the
  // report. Require all 4 digits to survive numeric conversion.
  if (String(year).length !== 4) {
    throw new Error('generateMonthlyKpiReportFor: year must be a 4-digit year without leading zeros, got: ' + label);
  }
  return withRunLock_(function () {
    return generateMonthlyKpiReportForMonth_(targetMonthFromYearMonth_(year, month));
  });
}

function generateMonthlyKpiReportForMonth_(target) {
  Logger.log('Generating AI Organization KPI report for ' + target.label + ' (' + target.startIso + ' .. ' + target.endIsoExclusive + ')');

  const timeEvents = queryTimeEventsForRange_(target.startIso, target.endIsoExclusive);
  const timeAgg = aggregateTimeEvents_(timeEvents.results);

  const productMap = fetchProductMap_();
  const taskProductCache = {};
  const timeByProduct = aggregateTimeEventsByProduct_(timeEvents.results, productMap, taskProductCache);

  const completedTasks = queryCompletedTasksForRange_(target.startIso, target.endIsoExclusive);
  const taskAgg = aggregateTasksByProduct_(completedTasks.results, productMap);
  const doneTasks = completedTasks.results.filter(function (task) { return selectName_(task.properties.Status) === 'Done'; });

  const blockedSnapshot = aggregateBlockedSnapshot_(queryCurrentBlockedTasks_().results, productMap);
  const humanQueueSnapshot = aggregateHumanQueueSnapshot_(queryCurrentOpenHumanRequests_().results, productMap);
  const humanCompletedInMonth = aggregateHumanCompletedInMonth_(completedTasks.results, productMap);

  const createdTasks = queryCreatedTasksForRange_(target.startIso, target.endIsoExclusive);
  const closedTasks = queryClosedTasksForRange_(target.startIso, target.endIsoExclusive);
  const wipTasks = queryCurrentWipTasks_();
  const taskFlow = aggregateTaskFlow_(createdTasks.results, closedTasks.results, wipTasks.results);

  const valueTypeCoverage = aggregateValueTypeCoverage_(doneTasks);
  const aiAutonomy = aggregateAiAutonomy_(doneTasks);

  const githubReport = aggregateGitHub_(target);
  const openPrReport = aggregateOpenPrs_(githubRepos_(), Date.now());

  const previousLabel = previousMonthLabel_(target);
  const previousMetrics = fetchPreviousMonthRawMetrics_(kpiFrameworkPageId_(), previousLabel);

  const report = {
    target: target,
    previousLabel: previousLabel,
    previousMetrics: previousMetrics,
    timeEvents: { truncated: timeEvents.truncated, agg: timeAgg, byProduct: timeByProduct },
    tasks: { truncated: completedTasks.truncated || createdTasks.truncated || closedTasks.truncated || wipTasks.truncated, agg: taskAgg },
    taskFlow: taskFlow,
    valueTypeCoverage: valueTypeCoverage,
    aiAutonomy: aiAutonomy,
    blocked: blockedSnapshot,
    humanQueue: humanQueueSnapshot,
    humanCompleted: humanCompletedInMonth,
    github: githubReport,
    openPr: openPrReport,
    generatedAtIso: new Date().toISOString(),
  };

  const title = REPORT_TITLE_PREFIX + target.label;
  const found = findExistingReportPageWithFallback_(kpiFrameworkPageId_(), target.label);
  // Read back any Final Review content already sitting in §5/§6 BEFORE
  // replacePageContent_ deletes it, so buildReportBlocks_ can re-embed it
  // into the freshly generated page instead of silently discarding it.
  const preserved = found.pageId ? extractPreservedSections_(found.pageId) : { section5: [], section6: [] };
  const blocks = buildReportBlocks_(report, preserved);

  if (found.pageId) {
    if (found.legacyTitle) {
      renameReportPage_(found.pageId, title);
      Logger.log('Migrated report page ' + found.pageId + ' from the legacy title to ' + title);
    }
    replacePageContent_(found.pageId, blocks);
    Logger.log('Updated existing report page ' + found.pageId + ' for ' + target.label);
    return { pageId: found.pageId, action: 'updated', label: target.label, migratedFromLegacyTitle: found.legacyTitle };
  }

  const pageId = createReportPage_(kpiFrameworkPageId_(), title, blocks);
  Logger.log('Created new report page ' + pageId + ' for ' + target.label);
  return { pageId: pageId, action: 'created', label: target.label };
}

// ---------------------------------------------------------------------------
// JST month math (pure)
// ---------------------------------------------------------------------------

// Returns the JST wall-clock {y, m, d} for a given instant, via fixed
// UTC+9 arithmetic (Japan has no DST, so this is exact, unlike relying on
// the Apps Script project's own default timezone setting).
function jstDateParts_(date) {
  const shifted = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth() + 1,
    d: shifted.getUTCDate(),
  };
}

// ISO instant (UTC, 'Z') corresponding to JST 00:00:00 on (y, m, 1).
function jstMonthStartIso_(y, m) {
  const utcMillisAtJstMidnight = Date.UTC(y, m - 1, 1, 0, 0, 0) - 9 * 60 * 60 * 1000;
  return new Date(utcMillisAtJstMidnight).toISOString();
}

function previousYearMonth_(y, m) {
  return m === 1 ? { y: y - 1, m: 12 } : { y: y, m: m - 1 };
}

function nextYearMonth_(y, m) {
  return m === 12 ? { y: y + 1, m: 1 } : { y: y, m: m + 1 };
}

function pad2_(n) {
  return n < 10 ? '0' + n : String(n);
}

// Number of days in JST calendar month (y, m) [m is 1-indexed]. `Date.UTC`'s
// month argument is 0-indexed, so passing `m` directly and day `0` yields
// "the day before month m (0-indexed) day 1" = the last day of month m
// (1-indexed) — exactly what's needed here, with no DST to account for.
function daysInJstMonth_(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function targetMonthFromYearMonth_(y, m) {
  const next = nextYearMonth_(y, m);
  return {
    year: y,
    month: m,
    label: y + '-' + pad2_(m),
    startIso: jstMonthStartIso_(y, m),
    endIsoExclusive: jstMonthStartIso_(next.y, next.m),
  };
}

// The month this report targets is always the JST calendar month strictly
// before the one `now` currently falls in — run on 2026-10-01 (any time that
// day), this returns 2026-09 regardless of the trigger's exact fire minute.
function computeTargetMonth_(now) {
  const current = jstDateParts_(now);
  const prev = previousYearMonth_(current.y, current.m);
  return targetMonthFromYearMonth_(prev.y, prev.m);
}

// ---------------------------------------------------------------------------
// Task Time Events aggregation
// ---------------------------------------------------------------------------

function queryTimeEventsForRange_(startIso, endIsoExclusive) {
  return paginateNotionQuery_(
    '/v1/data_sources/' + encodeURIComponent(timeEventsDataSourceId_()) + '/query',
    {
      page_size: MAX_PAGE_SIZE,
      filter: {
        and: [
          { property: 'Started At', date: { on_or_after: startIso } },
          { property: 'Started At', date: { before: endIsoExclusive } },
        ],
      },
    }
  );
}

function formulaNumber_(property) {
  if (!property || property.type !== 'formula' || !property.formula) return 0;
  const f = property.formula;
  return f.type === 'number' && typeof f.number === 'number' ? f.number : 0;
}

function selectName_(property) {
  return property && property.select && property.select.name ? property.select.name : '';
}

function relationIds_(property) {
  if (!property || !Array.isArray(property.relation)) return [];
  return property.relation.map(function (r) { return r.id; });
}

// Pure aggregation over a list of already-fetched Task Time Event pages.
// Active/Waiting hours are read from Notion's own `Active Hours`/`Waiting
// Hours` formula properties (the same authoritative computation Stories &
// Tasks' own rollups use), never recomputed independently.
function aggregateTimeEvents_(events) {
  const byActor = {};
  const byWorkType = { 'Initial Work': 0, 'Review Fix': 0 };
  byWorkType[UNKNOWN_LABEL] = 0;
  let totalActive = 0;
  let totalWaiting = 0;

  events.forEach(function (event) {
    const props = event.properties;
    const active = formulaNumber_(props['Active Hours']);
    const waiting = formulaNumber_(props['Waiting Hours']);
    const actor = selectName_(props.Actor) || UNKNOWN_LABEL;
    const workType = selectName_(props['Work Type']) || UNKNOWN_LABEL;

    totalActive += active;
    totalWaiting += waiting;

    if (!byActor[actor]) byActor[actor] = { active: 0, waiting: 0 };
    byActor[actor].active += active;
    byActor[actor].waiting += waiting;

    if (byWorkType[workType] === undefined) byWorkType[workType] = 0;
    byWorkType[workType] += active;
  });

  const reviewFixActive = byWorkType['Review Fix'] || 0;
  return {
    totalActive: totalActive,
    totalWaiting: totalWaiting,
    flowEfficiency: percentage_(totalActive, totalActive + totalWaiting),
    byActor: byActor,
    byWorkType: byWorkType,
    reviewFixRatio: percentage_(reviewFixActive, totalActive),
    eventCount: events.length,
  };
}

// Resolves each event's Task -> Product (via a cache keyed by Task page id,
// so a Task with many events in the month costs one page fetch, not one per
// event), then sums Active/Waiting hours by Product name. A Task with no
// Product set, or an event whose Task relation is empty/unresolvable, is
// attributed to UNKNOWN_LABEL — never guessed.
function aggregateTimeEventsByProduct_(events, productMap, taskProductCache) {
  const byProduct = {};

  function ensure(name) {
    if (!byProduct[name]) byProduct[name] = { active: 0, waiting: 0 };
    return byProduct[name];
  }

  events.forEach(function (event) {
    const props = event.properties;
    const active = formulaNumber_(props['Active Hours']);
    const waiting = formulaNumber_(props['Waiting Hours']);
    const taskIds = relationIds_(props.Task);

    if (taskIds.length === 0) {
      const bucket = ensure(UNKNOWN_LABEL);
      bucket.active += active;
      bucket.waiting += waiting;
      return;
    }

    // A Time Event relates to exactly one Task in normal operation; guard
    // against an unexpected multi-relation by splitting evenly rather than
    // double-counting the full duration into every related Task's Product.
    const share = 1 / taskIds.length;
    taskIds.forEach(function (taskId) {
      const productNames = resolveTaskProducts_(taskId, productMap, taskProductCache);
      const names = productNames.length > 0 ? productNames : [UNKNOWN_LABEL];
      const perProductShare = share / names.length;
      names.forEach(function (name) {
        const bucket = ensure(name);
        bucket.active += active * perProductShare;
        bucket.waiting += waiting * perProductShare;
      });
    });
  });

  return byProduct;
}

function resolveTaskProducts_(taskId, productMap, cache) {
  if (cache[taskId] !== undefined) return cache[taskId];
  let names = [];
  try {
    const page = retrieveNotionPage_(taskId);
    const ids = relationIds_(page.properties && page.properties.Product);
    names = ids.map(function (id) { return productMap[id] || UNKNOWN_LABEL; });
  } catch (err) {
    Logger.log('resolveTaskProducts_ failed for Task ' + taskId + ': ' + err);
    names = [UNKNOWN_LABEL];
  }
  cache[taskId] = names;
  return names;
}

// ---------------------------------------------------------------------------
// Stories & Tasks aggregation
// ---------------------------------------------------------------------------

function queryCompletedTasksForRange_(startIso, endIsoExclusive) {
  return paginateNotionQuery_(
    '/v1/data_sources/' + encodeURIComponent(tasksDataSourceId_()) + '/query',
    {
      page_size: MAX_PAGE_SIZE,
      filter: {
        and: [
          { property: 'Completed At', date: { on_or_after: startIso } },
          { property: 'Completed At', date: { before: endIsoExclusive } },
          { property: 'Status', select: { equals: 'Done' } },
        ],
      },
    }
  );
}

function queryCurrentBlockedTasks_() {
  return paginateNotionQuery_(
    '/v1/data_sources/' + encodeURIComponent(tasksDataSourceId_()) + '/query',
    { page_size: MAX_PAGE_SIZE, filter: { property: 'Status', select: { equals: 'Blocked' } } }
  );
}

// Governed Actionable Human Queue definition (governance/ai-execution-constraints.md
// "Human Queue WIP constraint", matching the Notion "Human Queue｜Actionable"
// view): Assigned Agent = Human, Status in Ready/In Progress/Review. Note this
// is by assignee, not Type=Human Request — a Human-assigned Bug/Task counts,
// and Backlog is excluded (not yet Actionable).
function queryCurrentOpenHumanRequests_() {
  return paginateNotionQuery_(
    '/v1/data_sources/' + encodeURIComponent(tasksDataSourceId_()) + '/query',
    {
      page_size: MAX_PAGE_SIZE,
      filter: {
        and: [
          { property: 'Assigned Agent', select: { equals: 'Human' } },
          {
            or: ['Ready', 'In Progress', 'Review'].map(function (s) {
              return { property: 'Status', select: { equals: s } };
            }),
          },
        ],
      },
    }
  );
}

// Task Flow KPI/KMI (AI Organization KPI / KMI Framework §3.1, Management
// Point ① row): Task新規作成数 — every Stories & Tasks record (Task / Story /
// Request, any Type, any Status) whose built-in `Created` timestamp falls in
// the target month. No Status/Type restriction: Framework §3.1 defines this
// as unconditional intake volume, separately from how many of those are ever
// completed.
function queryCreatedTasksForRange_(startIso, endIsoExclusive) {
  return paginateNotionQuery_(
    '/v1/data_sources/' + encodeURIComponent(tasksDataSourceId_()) + '/query',
    {
      page_size: MAX_PAGE_SIZE,
      filter: {
        and: [
          { property: 'Created', created_time: { on_or_after: startIso } },
          { property: 'Created', created_time: { before: endIsoExclusive } },
        ],
      },
    }
  );
}

// Task Close数 (Framework §3.1): every record whose `Closed At` falls in the
// target month AND whose current `Status` is a terminal one (`Done` or
// `Superseded` — both write `Closed At`, see integrations/notion-time-events
// README on Reopen/Superseded). Unlike queryCompletedTasksForRange_ (used
// for the Done-only Delivery/Human-completed metrics), this one intentionally
// admits `Superseded` too, because Task Close is a Flow/throughput count of
// the intake pipeline draining, not a quality/outcome count — but it must
// still require a terminal Status, not `Closed At` alone. A Task can have
// `Closed At` written while `Status` is still `Ready`/`In Progress`/
// `Review`/`Blocked` — an explicitly documented real partial-write/Reopen
// failure mode (integrations/notion-time-events/README.md, "Reopen guard
// does not clear a prior Completed At/Closed At automatically"). Without the
// Status condition, such a Task would be double-counted: once here as
// "closed", and again by queryCurrentWipTasks_ as still-open WIP, corrupting
// Close, Task純増 (net), and Close/Create ratio (Codex review, PR #74).
function queryClosedTasksForRange_(startIso, endIsoExclusive) {
  return paginateNotionQuery_(
    '/v1/data_sources/' + encodeURIComponent(tasksDataSourceId_()) + '/query',
    {
      page_size: MAX_PAGE_SIZE,
      filter: {
        and: [
          { property: 'Closed At', date: { on_or_after: startIso } },
          { property: 'Closed At', date: { before: endIsoExclusive } },
          {
            or: ['Done', 'Superseded'].map(function (s) {
              return { property: 'Status', select: { equals: s } };
            }),
          },
        ],
      },
    }
  );
}

// WIP (Framework §3.1 KMI): a snapshot at report-generation time of every
// record that has left Backlog but not yet reached a terminal Status —
// Ready / In Progress / Review / Blocked. Backlog is excluded (not yet
// Actionable, same boundary the governed Human Queue definition already
// uses); Done/Superseded are excluded (terminal).
function queryCurrentWipTasks_() {
  return paginateNotionQuery_(
    '/v1/data_sources/' + encodeURIComponent(tasksDataSourceId_()) + '/query',
    {
      page_size: MAX_PAGE_SIZE,
      filter: {
        or: ['Ready', 'In Progress', 'Review', 'Blocked'].map(function (s) {
          return { property: 'Status', select: { equals: s } };
        }),
      },
    }
  );
}

// Pure aggregation of the three Task Flow queries above into the Management
// Point ① KPI/KMI pair: Task新規作成数 / Task Close数 (KPI) and Task純増数 /
// Close-Create比 / WIP数 (KMI). Type breakdown is kept (README "Task Flow")
// so the report can show intake/drain composition without re-querying.
function aggregateTaskFlow_(createdTasks, closedTasks, wipTasks) {
  function byType(tasks) {
    const counts = {};
    tasks.forEach(function (task) {
      const type = selectName_(task.properties.Type) || UNKNOWN_LABEL;
      counts[type] = (counts[type] || 0) + 1;
    });
    return counts;
  }

  const createdCount = createdTasks.length;
  const closedCount = closedTasks.length;

  return {
    createdCount: createdCount,
    closedCount: closedCount,
    net: createdCount - closedCount,
    closeCreateRatioPercent: percentage_(closedCount, createdCount),
    wipCount: wipTasks.length,
    byTypeCreated: byType(createdTasks),
    byTypeClosed: byType(closedTasks),
  };
}

// Measurement-quality metric backing Acceptance Criterion 8 ("実測・Proxy・
// 未計測は推測補完しない"): what share of this month's completed (Status =
// Done) Tasks even carry a `Value Type`, the axis §4 of the Framework needs
// for Product別・Value Conversion analysis. A low percentage here is itself
// the KMI-relevant signal (the Framework's own 2026-09 Baseline flagged
// 3.1%), not something to interpolate around.
function aggregateValueTypeCoverage_(doneTasks) {
  const byValueType = {};
  let withValueType = 0;
  doneTasks.forEach(function (task) {
    const name = selectName_(task.properties['Value Type']);
    if (name) {
      withValueType += 1;
      byValueType[name] = (byValueType[name] || 0) + 1;
    }
  });
  return {
    total: doneTasks.length,
    withValueType: withValueType,
    coveragePercent: percentage_(withValueType, doneTasks.length),
    byValueType: byValueType,
  };
}

// AI自律完遂率 / Human依存率 (Framework Management Point ① / ② KPI): among
// this month's Done Tasks whose `Assigned Agent` is set at all (denominator
// excludes tasks where it was never recorded — never guessed as either AI or
// Human), what share resolved to an AI actor vs. exactly `Human`. Any
// non-empty, non-"Human" Assigned Agent (Claude, Claude Sonnet, Codex, ...)
// counts as AI; this mirrors the Framework's own manual 2026-09 calculation
// ("担当Agent判明済み完了TaskのうちAI完了127/156=81.4%").
function aggregateAiAutonomy_(doneTasks) {
  let aiCompleted = 0;
  let humanCompleted = 0;
  let unknown = 0;
  doneTasks.forEach(function (task) {
    const agent = selectName_(task.properties['Assigned Agent']);
    if (!agent) {
      unknown += 1;
    } else if (agent === 'Human') {
      humanCompleted += 1;
    } else {
      aiCompleted += 1;
    }
  });
  const known = aiCompleted + humanCompleted;
  return {
    total: doneTasks.length,
    known: known,
    unknown: unknown,
    aiCompleted: aiCompleted,
    humanCompleted: humanCompleted,
    aiAutonomyPercent: percentage_(aiCompleted, known),
    humanDependencyPercent: percentage_(humanCompleted, known),
  };
}

function productNamesForTask_(task, productMap) {
  const ids = relationIds_(task.properties.Product);
  const names = ids.map(function (id) { return productMap[id] || UNKNOWN_LABEL; });
  return names.length > 0 ? names : [UNKNOWN_LABEL];
}

// Groups completed Tasks by Product, counting them and averaging
// `Lead Time (h)`. Membership requires Status = Done, not just Completed At
// being set in range: a Task that was Done, Reopened, and later closed as
// Superseded can keep its earlier Completed At (Notion's Reopen guard does
// not clear it automatically — see integrations/notion-time-events/README.md),
// so Completed-At-in-range alone would wrongly count a Superseded Task as a
// Done completion.
function aggregateTasksByProduct_(tasks, productMap) {
  const byProduct = {};

  function ensure(name) {
    if (!byProduct[name]) byProduct[name] = { completedCount: 0, leadTimeSum: 0, leadTimeCount: 0 };
    return byProduct[name];
  }

  const doneTasks = tasks.filter(function (task) { return selectName_(task.properties.Status) === 'Done'; });

  doneTasks.forEach(function (task) {
    const names = productNamesForTask_(task, productMap);
    const leadTime = formulaNumber_(task.properties['Lead Time (h)']);
    const hasLeadTime = task.properties['Lead Time (h)'] &&
      task.properties['Lead Time (h)'].formula &&
      task.properties['Lead Time (h)'].formula.type === 'number' &&
      typeof task.properties['Lead Time (h)'].formula.number === 'number';

    names.forEach(function (name) {
      const bucket = ensure(name);
      bucket.completedCount += 1 / names.length;
      if (hasLeadTime) {
        bucket.leadTimeSum += leadTime / names.length;
        bucket.leadTimeCount += 1 / names.length;
      }
    });
  });

  Object.keys(byProduct).forEach(function (name) {
    const bucket = byProduct[name];
    bucket.avgLeadTimeH = bucket.leadTimeCount > 0 ? bucket.leadTimeSum / bucket.leadTimeCount : null;
  });

  return byProduct;
}

function aggregateBlockedSnapshot_(tasks, productMap) {
  const byProduct = {};
  tasks.forEach(function (task) {
    productNamesForTask_(task, productMap).forEach(function (name) {
      byProduct[name] = (byProduct[name] || 0) + 1;
    });
  });
  return { total: tasks.length, byProduct: byProduct };
}

function aggregateHumanQueueSnapshot_(tasks, productMap) {
  const byProduct = {};
  tasks.forEach(function (task) {
    productNamesForTask_(task, productMap).forEach(function (name) {
      byProduct[name] = (byProduct[name] || 0) + 1;
    });
  });
  return { total: tasks.length, byProduct: byProduct };
}

// completedTasks is queryCompletedTasksForRange_'s result, so Status = Done
// is already enforced upstream (see that function's Notion filter) — a
// Human Request Reopened and later closed as Superseded is excluded the
// same way a non-Human-Request Task is, not just filtered by Type here.
function aggregateHumanCompletedInMonth_(completedTasks, productMap) {
  const humanRequests = completedTasks.filter(function (task) {
    return selectName_(task.properties.Type) === 'Human Request';
  });
  const byProduct = {};
  humanRequests.forEach(function (task) {
    productNamesForTask_(task, productMap).forEach(function (name) {
      byProduct[name] = (byProduct[name] || 0) + 1;
    });
  });
  return { total: humanRequests.length, byProduct: byProduct };
}

function fetchProductMap_() {
  const result = paginateNotionQuery_(
    '/v1/data_sources/' + encodeURIComponent(productsDataSourceId_()) + '/query',
    { page_size: MAX_PAGE_SIZE }
  );
  const map = {};
  result.results.forEach(function (page) {
    const title = pageTitle_(page);
    if (title) map[page.id] = title;
  });
  return map;
}

function pageTitle_(page) {
  const props = page.properties || {};
  const titleKey = Object.keys(props).filter(function (key) { return props[key].type === 'title'; })[0];
  if (!titleKey) return '';
  const richText = props[titleKey].title || [];
  return richText.map(function (t) { return t.plain_text || (t.text && t.text.content) || ''; }).join('');
}

// ---------------------------------------------------------------------------
// GitHub aggregation
// ---------------------------------------------------------------------------

function aggregateGitHub_(target) {
  const repos = githubRepos_();
  const byRepo = {};
  const byProduct = {};
  let anyTruncated = false;
  let totalCreated = 0;
  let totalMerged = 0;

  function ensureProduct(name) {
    if (!byProduct[name]) byProduct[name] = { created: 0, merged: 0 };
    return byProduct[name];
  }

  repos.forEach(function (repo) {
    const created = githubSearchPRs_(repo, 'created', target);
    const merged = githubSearchPRs_(repo, 'merged', target);
    anyTruncated = anyTruncated || created.truncated || merged.truncated;

    byRepo[repo] = { created: created.totalCount, merged: merged.totalCount };
    totalCreated += created.totalCount;
    totalMerged += merged.totalCount;

    created.items.forEach(function (item) {
      const product = lookupProductForPr_(repo, item.number) || UNKNOWN_LABEL;
      ensureProduct(product).created += 1;
    });
    merged.items.forEach(function (item) {
      const product = lookupProductForPr_(repo, item.number) || UNKNOWN_LABEL;
      ensureProduct(product).merged += 1;
    });
  });

  return { byRepo: byRepo, byProduct: byProduct, truncated: anyTruncated, totalCreated: totalCreated, totalMerged: totalMerged };
}

// field: 'created' or 'merged'. Uses GitHub's Search Issues API, scoped to
// pull requests only. GitHub's date qualifiers accept a full ISO-8601
// datetime with a UTC offset, so the JST month boundary is expressed
// exactly (+09:00) instead of approximating it with UTC calendar dates.
// The range's end is inclusive, so it is JST 23:59:59 on the target month's
// own last calendar day, not the exclusive next-month boundary.
function githubSearchPRs_(repo, field, target) {
  const startDateTime = target.year + '-' + pad2_(target.month) + '-01T00:00:00+09:00';
  const lastDay = daysInJstMonth_(target.year, target.month);
  const endDateTime = target.year + '-' + pad2_(target.month) + '-' + pad2_(lastDay) + 'T23:59:59+09:00';
  const qualifier = field === 'merged' ? 'is:merged merged' : 'created';
  const query = 'repo:' + repo + ' is:pr ' + qualifier + ':' + startDateTime + '..' + endDateTime;

  let items = [];
  let totalCount = 0;
  let truncated = false;

  for (let page = 1; page <= GITHUB_SEARCH_MAX_PAGES; page++) {
    const result = githubRequest_(
      '/search/issues?q=' + encodeURIComponent(query) + '&per_page=' + MAX_PAGE_SIZE + '&page=' + page
    );
    totalCount = result.total_count || 0;
    items = items.concat(result.items || []);
    if (!result.items || result.items.length < MAX_PAGE_SIZE) break;
    if (page === GITHUB_SEARCH_MAX_PAGES && items.length < totalCount) truncated = true;
  }
  if (totalCount > GITHUB_SEARCH_HARD_CAP) truncated = true;

  return { totalCount: totalCount, items: items, truncated: truncated };
}

// Open PR Age / 48h超率 (Framework Management Point ① KMI, Acceptance
// Criterion 5): a separate, current-time snapshot search (`is:open`), not
// part of githubSearchPRs_'s created/merged-in-month query. `created_at` on
// each Search API issue item is used directly — never recomputed from a
// separately fetched PR object — to compute Age at report-generation time.
function githubSearchOpenPRs_(repo) {
  const query = 'repo:' + repo + ' is:pr is:open';

  let items = [];
  let totalCount = 0;
  let truncated = false;

  for (let page = 1; page <= GITHUB_SEARCH_MAX_PAGES; page++) {
    const result = githubRequest_(
      '/search/issues?q=' + encodeURIComponent(query) + '&per_page=' + MAX_PAGE_SIZE + '&page=' + page
    );
    totalCount = result.total_count || 0;
    items = items.concat(result.items || []);
    if (!result.items || result.items.length < MAX_PAGE_SIZE) break;
    if (page === GITHUB_SEARCH_MAX_PAGES && items.length < totalCount) truncated = true;
  }
  if (totalCount > GITHUB_SEARCH_HARD_CAP) truncated = true;

  return { totalCount: totalCount, items: items, truncated: truncated };
}

// Aggregates currently-open PRs (across the configured repos) into the Open
// PR count / average Age / 48h超率 KMI, split by repo and — via the same
// lookupProductForPr_ attribution the created/merged aggregation already
// uses — by Product. `nowMs` is threaded through explicitly (not read from
// `new Date()` inside) so the pure Age arithmetic stays independently
// testable.
function aggregateOpenPrs_(repos, nowMs) {
  const byRepo = {};
  const byProduct = {};
  let allAges = [];
  let over48h = 0;
  let anyTruncated = false;

  function ensureProduct(name) {
    if (!byProduct[name]) byProduct[name] = { count: 0, ages: [], over48h: 0 };
    return byProduct[name];
  }

  repos.forEach(function (repo) {
    const open = githubSearchOpenPRs_(repo);
    anyTruncated = anyTruncated || open.truncated;

    const ages = open.items.map(function (item) {
      return (nowMs - new Date(item.created_at).getTime()) / (60 * 60 * 1000);
    });
    const repoOver48h = ages.filter(function (h) { return h > OPEN_PR_AGE_ALERT_HOURS; }).length;
    byRepo[repo] = {
      count: open.items.length,
      avgAgeH: ages.length > 0 ? round1_(ages.reduce(function (a, b) { return a + b; }, 0) / ages.length) : null,
      over48h: repoOver48h,
    };
    allAges = allAges.concat(ages);
    over48h += repoOver48h;

    open.items.forEach(function (item, i) {
      const product = lookupProductForPr_(repo, item.number) || UNKNOWN_LABEL;
      const bucket = ensureProduct(product);
      bucket.count += 1;
      bucket.ages.push(ages[i]);
      if (ages[i] > OPEN_PR_AGE_ALERT_HOURS) bucket.over48h += 1;
    });
  });

  Object.keys(byProduct).forEach(function (name) {
    const bucket = byProduct[name];
    bucket.avgAgeH = bucket.ages.length > 0
      ? round1_(bucket.ages.reduce(function (a, b) { return a + b; }, 0) / bucket.ages.length)
      : null;
    delete bucket.ages;
  });

  return {
    total: allAges.length,
    avgAgeH: allAges.length > 0 ? round1_(allAges.reduce(function (a, b) { return a + b; }, 0) / allAges.length) : null,
    over48h: over48h,
    over48hPercent: percentage_(over48h, allAges.length),
    byRepo: byRepo,
    byProduct: byProduct,
    truncated: anyTruncated,
  };
}

// Attributes one GitHub PR to a Product by matching its URL against Stories
// & Tasks' `Pull Request` property. Returns null (caller maps to
// UNKNOWN_LABEL) if no Task references this PR, or the matching Task has no
// Product set, or more than one Task references it ambiguously.
function lookupProductForPr_(repo, number) {
  const needle = repo + '/pull/' + number;
  // `contains` is a coarse pre-filter only (e.g. PR #4 also matches a URL
  // containing /pull/42) — pullRequestUrlMatches_ below re-checks with a
  // path boundary so a numeric prefix never misattributes the Product. Must
  // paginate the candidate set (not just take a first small page): with a
  // short-numbered PR, the exact match can sort past the first few
  // coarse-matched Tasks (e.g. #4 alongside Tasks for #40-#49), which would
  // otherwise drop a real match — or hide a real ambiguity — off-page.
  const result = paginateNotionQuery_('/v1/data_sources/' + encodeURIComponent(tasksDataSourceId_()) + '/query', {
    page_size: MAX_PAGE_SIZE,
    filter: { property: 'Pull Request', url: { contains: needle } },
  });
  const matches = (result.results || []).filter(function (task) {
    const url = task.properties['Pull Request'] && task.properties['Pull Request'].url;
    return pullRequestUrlMatches_(url, needle);
  });
  if (matches.length !== 1) return null;
  const ids = relationIds_(matches[0].properties.Product);
  if (ids.length !== 1) return null;
  // Product name resolution here is a single extra page fetch per matched
  // PR; acceptable at monthly-batch volume. Cached at the process level via
  // a plain object keyed by product id to avoid re-fetching the same
  // Product repeatedly within one run.
  return resolveProductNameCached_(ids[0]);
}

// Requires `needle` (owner/repo/pull/NUMBER) to end at a path boundary in
// `url`, so PR #4 cannot be matched by a Task URL for PR #42, #423, etc.
function pullRequestUrlMatches_(url, needle) {
  if (typeof url !== 'string') return false;
  const idx = url.indexOf(needle);
  if (idx === -1) return false;
  const after = url.charAt(idx + needle.length);
  return after === '' || after === '/' || after === '?' || after === '#';
}

const PRODUCT_NAME_CACHE_ = {};
function resolveProductNameCached_(productId) {
  if (PRODUCT_NAME_CACHE_[productId] !== undefined) return PRODUCT_NAME_CACHE_[productId];
  let name = null;
  try {
    name = pageTitle_(retrieveNotionPage_(productId)) || null;
  } catch (err) {
    Logger.log('resolveProductNameCached_ failed for ' + productId + ': ' + err);
  }
  PRODUCT_NAME_CACHE_[productId] = name;
  return name;
}

// ---------------------------------------------------------------------------
// Pure formatting helpers
// ---------------------------------------------------------------------------

function round1_(n) {
  return Math.round(n * 10) / 10;
}

function percentage_(numerator, denominator) {
  if (!denominator) return null;
  return round1_((numerator / denominator) * 100);
}

function formatHours_(n) {
  return round1_(n || 0) + 'h';
}

function formatPercent_(p) {
  return p === null || p === undefined ? 'N/A' : p + '%';
}

function formatMaybeHours_(n) {
  return n === null || n === undefined ? 'N/A' : round1_(n) + 'h';
}

// ---------------------------------------------------------------------------
// Report -> Notion blocks
// ---------------------------------------------------------------------------

function textBlock_(type, content, extra) {
  const block = { object: 'block', type: type };
  block[type] = Object.assign({ rich_text: [{ type: 'text', text: { content: content } }] }, extra || {});
  return block;
}

function calloutBlock_(content, emoji) {
  return {
    object: 'block',
    type: 'callout',
    callout: {
      rich_text: [{ type: 'text', text: { content: content } }],
      icon: { type: 'emoji', emoji: emoji || 'ℹ️' },
    },
  };
}

function tableCell_(text) {
  return [{ type: 'text', text: { content: String(text) } }];
}

function tableRow_(cells) {
  return { object: 'block', type: 'table_row', table_row: { cells: cells.map(tableCell_) } };
}

function tableBlock_(header, rows) {
  return {
    object: 'block',
    type: 'table',
    table: {
      table_width: header.length,
      has_column_header: true,
      has_row_header: false,
      children: [tableRow_(header)].concat(rows.map(tableRow_)),
    },
  };
}

function sortedProductNames_(maps) {
  const names = {};
  maps.forEach(function (m) { Object.keys(m || {}).forEach(function (k) { names[k] = true; }); });
  const list = Object.keys(names);
  list.sort(function (a, b) {
    if (a === UNKNOWN_LABEL) return 1;
    if (b === UNKNOWN_LABEL) return -1;
    return a.localeCompare(b);
  });
  return list;
}

// ---------------------------------------------------------------------------
// Month-over-month raw metrics (Acceptance Criterion 12)
// ---------------------------------------------------------------------------

// The prior JST calendar month's report title, for looking up its page under
// the same Framework parent findExistingReportPage_ already searches.
function previousMonthLabel_(target) {
  const prev = previousYearMonth_(target.year, target.month);
  return prev.y + '-' + pad2_(prev.m);
}

// Fetches every top-level child block of a page (shared by
// findExistingReportPage_/replacePageContent_'s own inline loops and this
// module — kept as its own function here rather than refactoring those two
// callers, to avoid changing already-tested control flow that isn't part of
// this change).
function fetchPageChildren_(pageId) {
  let cursor = null;
  const blocks = [];
  for (let i = 0; i < 20; i++) {
    const query = cursor ? '?start_cursor=' + encodeURIComponent(cursor) + '&page_size=100' : '?page_size=100';
    const result = notionRequest_('get', '/v1/blocks/' + encodeURIComponent(pageId) + '/children' + query);
    (result.results || []).forEach(function (block) { blocks.push(block); });
    if (!result.has_more) return blocks;
    cursor = result.next_cursor;
  }
  throw new Error('fetchPageChildren_ did not terminate after 20 pages under ' + pageId);
}

// Reads back the JSON metrics snapshot a prior run of this file appended via
// buildRawMetricsBlock_ (see RAW_METRICS_MARKER). Returns null on any miss —
// no page found, no tagged block found, or unparseable JSON — so a missing
// or corrupt snapshot degrades to "no month-over-month comparison available"
// rather than throwing and blocking the current month's report entirely.
function fetchPreviousMonthRawMetrics_(parentPageId, previousLabel) {
  try {
    // A previous month spanning the ADP-055-KMI rename may still carry the
    // legacy title if it was never re-generated since — fall back the same
    // way findExistingReportPageWithFallback_ does for the current month, so
    // month-over-month comparison isn't silently lost across the rename.
    const pageId = findExistingReportPageWithFallback_(parentPageId, previousLabel).pageId;
    if (!pageId) return null;
    const blocks = fetchPageChildren_(pageId);
    function richTextPlain_(rt) { return rt.plain_text || (rt.text && rt.text.content) || ''; }
    const marked = blocks.filter(function (block) {
      return block.type === 'code' && block.code && Array.isArray(block.code.rich_text) &&
        block.code.rich_text.some(function (rt) { return richTextPlain_(rt).indexOf(RAW_METRICS_MARKER) === 0; });
    })[0];
    if (!marked) return null;
    const text = marked.code.rich_text.map(richTextPlain_).join('');
    const jsonText = text.slice(text.indexOf('\n') + 1);
    return JSON.parse(jsonText);
  } catch (err) {
    Logger.log('fetchPreviousMonthRawMetrics_ failed for ' + previousLabel + ': ' + err);
    return null;
  }
}

// Builds this month's own machine-readable snapshot block, appended at the
// end of every generated report so the FOLLOWING month's run can read it
// back via fetchPreviousMonthRawMetrics_. Kept intentionally small (only the
// headline Flow numbers the Framework's §3 Flow KPI/KMI section defines) —
// this is a comparison aid, not a duplicate of the full report.
function buildRawMetricsBlock_(metrics) {
  const marker = RAW_METRICS_MARKER + '\n' + JSON.stringify(metrics, null, 2);
  return {
    object: 'block',
    type: 'code',
    code: {
      rich_text: [{ type: 'text', text: { content: marker } }],
      language: 'json',
    },
  };
}

// Percentage-point-safe delta formatter for the month-over-month callout:
// null when either side is missing (never guessed), otherwise a signed
// integer/one-decimal difference with an explicit +/- sign so a reader can't
// misread a negative delta as the current value.
function formatDelta_(current, previous) {
  if (current === null || current === undefined || previous === null || previous === undefined) return 'N/A';
  const delta = round1_(current - previous);
  return (delta > 0 ? '+' : '') + delta;
}

// Builds one Management Point row for the §1 table. `kpi`/`kmi` are
// already-formatted strings (built by the caller from real aggregates, with
// MISSING_DATA_LABEL substituted per metric where no data source exists) —
// this function only lays out the row, it never decides what counts as
// measured.
function managementPointRow_(area, point, kpi, kmi) {
  return [area, point, kpi, kmi];
}

function joinMetrics_(parts) {
  return parts.join(' ／ ');
}

function buildManagementPointRows_(report) {
  const timeAgg = report.timeEvents.agg;
  const humanActive = timeAgg.byActor.Human || { active: 0, waiting: 0 };
  const totalActive = timeAgg.totalActive;
  const humanActiveRatio = percentage_(humanActive.active, totalActive);
  const humanWaitingRatio = percentage_(humanActive.waiting, humanActive.active + humanActive.waiting);

  return [
    managementPointRow_(
      'AI-Human協働実行', '① タスク自律完遂率の最大化',
      joinMetrics_([
        'Task新規作成数: ' + report.taskFlow.createdCount,
        'Task Close数: ' + report.taskFlow.closedCount,
        '完了Task数: ' + report.aiAutonomy.total,
        'PR作成: ' + report.github.totalCreated,
        'PR Merge: ' + report.github.totalMerged,
        'AI自律完遂率: ' + formatPercent_(report.aiAutonomy.aiAutonomyPercent) + '（担当Agent判明' + report.aiAutonomy.known + '件中）',
        '初回完了率: ' + MISSING_DATA_LABEL,
      ]),
      joinMetrics_([
        'Task純増数: ' + report.taskFlow.net,
        'Close/Create比: ' + formatPercent_(report.taskFlow.closeCreateRatioPercent),
        'WIP: ' + report.taskFlow.wipCount,
        'Retry率: ' + MISSING_DATA_LABEL,
        'Review Fix率: ' + formatPercent_(timeAgg.reviewFixRatio),
        'Open PR: ' + report.openPr.total + '件 平均Age ' + formatMaybeHours_(report.openPr.avgAgeH) +
          ' 48h超: ' + report.openPr.over48h + '件（' + formatPercent_(report.openPr.over48hPercent) + '）',
      ])
    ),
    managementPointRow_(
      'AI-Human協働実行', '② Humanレビュー工数比率の抑制',
      joinMetrics_([
        'Humanレビュー工数比率（Proxy: Human Actor Active/全体Active）: ' + formatPercent_(humanActiveRatio),
        'Review処理件数: ' + MISSING_DATA_LABEL,
        '承認Lead Time: ' + MISSING_DATA_LABEL,
      ]),
      joinMetrics_([
        'Review待ち件数（Actionable Human Queue）: ' + report.humanQueue.total + '件',
        'Review Queue Age: ' + MISSING_DATA_LABEL,
        'Human Waiting Ratio（Proxy）: ' + formatPercent_(humanWaitingRatio),
        'Human Escalation率: ' + MISSING_DATA_LABEL,
      ])
    ),
    managementPointRow_(
      '知見蓄積・成果物変換', '③ 実験ログから成果化への変換速度',
      '実験→成果化率 / 実証完了→公開Lead Time / 成果物数: ' + MISSING_DATA_LABEL,
      '未成果化ログ残高 / 形式知化待ちAge / 成果化停滞件数: ' + MISSING_DATA_LABEL
    ),
    managementPointRow_(
      '知見蓄積・成果物変換', '④ 形式知化可能なプロジェクト並列数',
      '同時実験数 / 形式知化完了数 / 並列Project数: ' + MISSING_DATA_LABEL,
      '未整理ログ残高 / 並列過多率 / 形式知化Backlog Age: ' + MISSING_DATA_LABEL
    ),
    managementPointRow_(
      'システム・データ', '⑤ コンテキスト記憶保持精度',
      'Context保持精度 / 誤参照率の逆指標 / 正答率: ' + MISSING_DATA_LABEL,
      'Error率 / 再入力回数 / 前提知識再投入頻度: ' + MISSING_DATA_LABEL
    ),
    managementPointRow_(
      'システム・データ', '⑥ 同時実行エージェント上限',
      '同時稼働Agent数 / 処理Throughput: ' + MISSING_DATA_LABEL,
      'Rate Limit到達率 / Queue待ち時間 / 処理遅延率: ' + MISSING_DATA_LABEL
    ),
    managementPointRow_(
      '財務', '⑦ 収益化変換効率',
      '商用化件数 / 売上・収益 / 商用化率 / 投資回収率: ' + MISSING_DATA_LABEL,
      '商用化待ち件数 / 投資回収Lead Time / API・人件費増加率: ' + MISSING_DATA_LABEL
    ),
    managementPointRow_(
      '組織', '⑧ Humanの認知負荷の定量化',
      joinMetrics_([
        'Human Attention時間: ' + MISSING_DATA_LABEL,
        '意思決定Lead Time: ' + MISSING_DATA_LABEL,
        'Human処理件数（Proxy: Human Request完了数）: ' + report.humanCompleted.total + '件',
      ]),
      joinMetrics_([
        '割込み数 / 滞留Task数 / 疲弊兆候: ' + MISSING_DATA_LABEL,
        'Human Queue Age: ' + MISSING_DATA_LABEL + '（件数は②のActionable Human Queue: ' + report.humanQueue.total + '件を参照）',
      ])
    ),
    managementPointRow_(
      '組織', '⑨ タスク評価基準の標準化',
      '評価基準適用率 / 再現性ある判定率 / Review一致率: ' + MISSING_DATA_LABEL,
      '同一失敗再発率 / 評価ブレ率 / 差戻し率 / Context漏れ率 / 例外処理件数: ' + MISSING_DATA_LABEL +
        '（Postmortemの再発分類は週次Sprint Retrospectiveの人手判断領域であり本自動集計の対象外）'
    ),
  ];
}

// `preserved` carries any human/Final-Review content a previous run of this
// report already had in §5/§6 (see extractPreservedSections_) — {section5:
// [block,...], section6: [block,...]}, both empty on first generation or
// when nothing was ever added. Reinserting it here, right after each
// section's placeholder callout, is what makes a rerun (replacePageContent_,
// which deletes and rebuilds every top-level block) preserve that content
// instead of silently discarding it (Codex review, PR #74).
function buildReportBlocks_(report, preserved) {
  const preservedSections = preserved || { section5: [], section6: [] };
  const t = report.target;
  const blocks = [];
  const anyTruncated = report.timeEvents.truncated || report.tasks.truncated || report.github.truncated || report.openPr.truncated;

  blocks.push(calloutBlock_(
    '対象期間: JST ' + t.year + '-' + pad2_(t.month) + '-01 00:00 〜 翌月01日 00:00（' + t.startIso + ' 〜 ' + t.endIsoExclusive + ', UTC表記）。' +
    '生成時刻: ' + report.generatedAtIso + '。定義は AI Organization KPI / KMI Framework を正本とする。KPI/KMIは同Frameworkの' +
    '9 Management Pointsへ主帰属させて表示する（推測補完はしない）。' +
    (anyTruncated
      ? ' ⚠️ 一部集計がページング上限に達し切り捨てられている可能性があります（Known limitationsを参照）。'
      : ''),
    '🎯'
  ));

  blocks.push(textBlock_('heading_2', 'Executive Summary'));
  const prevM = report.previousMetrics;
  blocks.push(textBlock_('paragraph', joinMetrics_([
    'Task新規作成: ' + report.taskFlow.createdCount + (prevM ? '（前月比 ' + formatDelta_(report.taskFlow.createdCount, prevM.createdCount) + '）' : ''),
    'Task Close: ' + report.taskFlow.closedCount + (prevM ? '（前月比 ' + formatDelta_(report.taskFlow.closedCount, prevM.closedCount) + '）' : ''),
    'WIP: ' + report.taskFlow.wipCount + (prevM ? '（前月比 ' + formatDelta_(report.taskFlow.wipCount, prevM.wipCount) + '）' : ''),
    'AI自律完遂率: ' + formatPercent_(report.aiAutonomy.aiAutonomyPercent) + (prevM ? '（前月比pt ' + formatDelta_(report.aiAutonomy.aiAutonomyPercent, prevM.aiAutonomyPercent) + '）' : ''),
    'PR作成/Merge: ' + report.github.totalCreated + '/' + report.github.totalMerged +
      (prevM ? '（前月比 ' + formatDelta_(report.github.totalCreated, prevM.prCreated) + '/' + formatDelta_(report.github.totalMerged, prevM.prMerged) + '）' : ''),
    'Open PR: ' + report.openPr.total + '件（48h超 ' + report.openPr.over48h + '件）' +
      (prevM ? '（前月比 ' + formatDelta_(report.openPr.total, prevM.openPrTotal) + '）' : ''),
    'Value Type付与率: ' + formatPercent_(report.valueTypeCoverage.coveragePercent) + '（' + report.valueTypeCoverage.withValueType + '/' + report.valueTypeCoverage.total + '）',
  ])));
  blocks.push(calloutBlock_(
    prevM
      ? '前月（' + report.previousLabel + '）の機械可読スナップショットと比較した月次推移を上記括弧内に表示。'
      : '前月（' + report.previousLabel + '）のレポート、または前月分の機械可読スナップショットが見つからないため、月次推移は表示していません' +
        '（2026-09を本Frameworkの初回Baselineとする ADP-055-KMI Acceptance Criterion 12 のとおり、10月分以降で比較が有効になります）。',
    prevM ? '📈' : '📌'
  ));

  blocks.push(textBlock_('heading_2', '1. 事業統制ツリー別 9 Management Points KPI / KMI'));
  blocks.push(calloutBlock_(
    '各指標の定義・主帰属Management Pointは AI Organization KPI / KMI Framework｜事業統制ツリー連動 を正本とする。' +
    '「' + MISSING_DATA_LABEL + '」はTelemetry未整備で実測できない項目であり、推測値では埋めていない。',
    '📋'
  ));
  blocks.push(tableBlock_(
    ['領域', 'Management Point', 'KPI｜成果・状態', 'KMI｜先行警戒'],
    buildManagementPointRows_(report)
  ));

  blocks.push(textBlock_('heading_2', '2. Task Flow（Create / Close / 純増 / WIP / Age）'));
  blocks.push(textBlock_('paragraph', joinMetrics_([
    'Task新規作成数: ' + report.taskFlow.createdCount,
    'Task Close数: ' + report.taskFlow.closedCount,
    'Task純増数: ' + report.taskFlow.net,
    'Close/Create比: ' + formatPercent_(report.taskFlow.closeCreateRatioPercent),
    '現在WIP: ' + report.taskFlow.wipCount,
  ])));
  const typeNames = sortedProductNames_([report.taskFlow.byTypeCreated, report.taskFlow.byTypeClosed]);
  blocks.push(tableBlock_(['Type', 'Create', 'Close'], typeNames.map(function (name) {
    return [name, report.taskFlow.byTypeCreated[name] || 0, report.taskFlow.byTypeClosed[name] || 0];
  })));
  blocks.push(calloutBlock_(
    'Task単位のAge分布: ' + MISSING_DATA_LABEL + '。Notionに「Blocked/WIPへ遷移した時刻」を記録する専用プロパティが無く、' +
    '既存のStarted At/Closed Atだけでは状態別滞留時間を算出できない（README Known limitations「Blocked "Age" is not reported」を参照）。',
    '⚠️'
  ));

  blocks.push(textBlock_('heading_2', '3. Delivery Flow（PR Create / Merge / Open PR Age）'));
  blocks.push(textBlock_('heading_3', '3.1 PR Flow（Create / Merge）'));
  blocks.push(textBlock_('paragraph', 'PR作成: ' + report.github.totalCreated + ' ／ PR Merge: ' + report.github.totalMerged +
    ' ／ Merge/Create比: ' + formatPercent_(percentage_(report.github.totalMerged, report.github.totalCreated))));
  const repoNames = Object.keys(report.github.byRepo).sort();
  blocks.push(tableBlock_(['Repository', 'PR作成', 'PR Merge'], repoNames.map(function (name) {
    const r = report.github.byRepo[name];
    return [name, r.created, r.merged];
  })));
  const ghProductNames = sortedProductNames_([report.github.byProduct]);
  blocks.push(tableBlock_(['Product', 'PR作成', 'PR Merge'], ghProductNames.map(function (name) {
    const p = report.github.byProduct[name];
    return [name, p.created, p.merged];
  })));

  blocks.push(textBlock_('heading_3', '3.2 Open PR Age（現在スナップショット）'));
  blocks.push(textBlock_('paragraph', 'Open PR: ' + report.openPr.total + '件 ／ 平均Age: ' + formatMaybeHours_(report.openPr.avgAgeH) +
    ' ／ ' + OPEN_PR_AGE_ALERT_HOURS + 'h超: ' + report.openPr.over48h + '件（' + formatPercent_(report.openPr.over48hPercent) + '）'));
  const openRepoNames = Object.keys(report.openPr.byRepo).sort();
  blocks.push(tableBlock_(['Repository', 'Open PR', '平均Age(h)', '48h超'], openRepoNames.map(function (name) {
    const r = report.openPr.byRepo[name];
    return [name, r.count, formatMaybeHours_(r.avgAgeH), r.over48h];
  })));
  const openProductNames = sortedProductNames_([report.openPr.byProduct]);
  blocks.push(tableBlock_(['Product', 'Open PR', '平均Age(h)', '48h超'], openProductNames.map(function (name) {
    const p = report.openPr.byProduct[name];
    return [name, p.count, formatMaybeHours_(p.avgAgeH), p.over48h];
  })));

  blocks.push(textBlock_('heading_2', '4. Product別・Value Conversion横断分析'));
  const productNames = sortedProductNames_([
    report.timeEvents.byProduct,
    report.tasks.agg,
    report.blocked.byProduct,
    report.humanQueue.byProduct,
    report.humanCompleted.byProduct,
    report.github.byProduct,
  ]);
  const header = ['Product', 'Active(h)', 'Waiting(h)', 'Flow Eff.', '完了Task', '平均Lead Time(h)', 'PR作成', 'PR Merge', 'Blocked(現在)', 'Human Queue(現在)', 'Human Request完了'];
  const rows = productNames.map(function (name) {
    const time = report.timeEvents.byProduct[name] || { active: 0, waiting: 0 };
    const task = report.tasks.agg[name] || { completedCount: 0, avgLeadTimeH: null };
    const gh = report.github.byProduct[name] || { created: 0, merged: 0 };
    return [
      name,
      round1_(time.active),
      round1_(time.waiting),
      formatPercent_(percentage_(time.active, time.active + time.waiting)),
      round1_(task.completedCount),
      formatMaybeHours_(task.avgLeadTimeH),
      gh.created,
      gh.merged,
      report.blocked.byProduct[name] || 0,
      report.humanQueue.byProduct[name] || 0,
      report.humanCompleted.byProduct[name] || 0,
    ];
  });
  blocks.push(tableBlock_(header, rows));
  blocks.push(textBlock_('paragraph', 'Value Type付与率（完了Task, Secondary Axis）: ' + formatPercent_(report.valueTypeCoverage.coveragePercent) +
    '（' + report.valueTypeCoverage.withValueType + '/' + report.valueTypeCoverage.total + '件）'));
  const valueTypeNames = Object.keys(report.valueTypeCoverage.byValueType).sort();
  if (valueTypeNames.length > 0) {
    blocks.push(tableBlock_(['Value Type', '完了Task数'], valueTypeNames.map(function (name) {
      return [name, report.valueTypeCoverage.byValueType[name]];
    })));
  }

  blocks.push(textBlock_('heading_2', SECTION5_HEADING));
  blocks.push(calloutBlock_(SECTION5_PLACEHOLDER_TEXT, '🧭'));
  preservedSections.section5.forEach(function (block) { blocks.push(block); });

  blocks.push(textBlock_('heading_2', SECTION6_HEADING));
  blocks.push(calloutBlock_(SECTION6_PLACEHOLDER_TEXT, '🛠️'));
  preservedSections.section6.forEach(function (block) { blocks.push(block); });

  blocks.push(textBlock_('heading_2', DATA_QUALITY_HEADING));
  blocks.push(textBlock_('paragraph',
    'Task Time EventsのTaskリレーションが無い、対応するTaskにProductが未設定、またはGitHub PRに対応するNotion Task（Pull Request URL一致）が' +
    '見つからない場合は "' + UNKNOWN_LABEL + '" として明示している。「' + MISSING_DATA_LABEL + '」はTelemetryが未整備で計測自体ができない項目を示す。' +
    'いずれも値を推測して埋めることはしていない（Measurement Debtとして Framework 側に記録済み）。'));

  blocks.push(buildRawMetricsBlock_({
    label: t.label,
    createdCount: report.taskFlow.createdCount,
    closedCount: report.taskFlow.closedCount,
    wipCount: report.taskFlow.wipCount,
    prCreated: report.github.totalCreated,
    prMerged: report.github.totalMerged,
    openPrTotal: report.openPr.total,
    openPrOver48h: report.openPr.over48h,
    aiAutonomyPercent: report.aiAutonomy.aiAutonomyPercent,
    humanQueueTotal: report.humanQueue.total,
    valueTypeCoveragePercent: report.valueTypeCoverage.coveragePercent,
  }));

  return blocks;
}

// ---------------------------------------------------------------------------
// Idempotent Notion page create-or-update
// ---------------------------------------------------------------------------

function findExistingReportPage_(parentPageId, title) {
  let cursor = null;
  for (let i = 0; i < 20; i++) {
    const query = cursor ? '?start_cursor=' + encodeURIComponent(cursor) + '&page_size=100' : '?page_size=100';
    const result = notionRequest_('get', '/v1/blocks/' + encodeURIComponent(parentPageId) + '/children' + query);
    const match = (result.results || []).filter(function (block) {
      return block.type === 'child_page' && block.child_page && block.child_page.title === title;
    })[0];
    if (match) return match.id;
    if (!result.has_more) return null;
    cursor = result.next_cursor;
  }
  throw new Error('findExistingReportPage_ did not terminate after 20 pages under ' + parentPageId);
}

// Finds a month's existing report page under EITHER its current title
// (REPORT_TITLE_PREFIX) or the pre-ADP-055-KMI legacy one
// (LEGACY_REPORT_TITLE_PREFIX), preferring the current title. Backfilling or
// rerunning an older month whose page was created before this rename and
// never manually renamed must still update that existing page, not create a
// second one under the new title (Codex review, PR #74; Acceptance
// Criterion 11) — `generateMonthlyKpiReportFor`'s own README explicitly
// supports rerunning any past month, not only ones already migrated.
function findExistingReportPageWithFallback_(parentPageId, label) {
  const currentId = findExistingReportPage_(parentPageId, REPORT_TITLE_PREFIX + label);
  if (currentId) return { pageId: currentId, legacyTitle: false };
  const legacyId = findExistingReportPage_(parentPageId, LEGACY_REPORT_TITLE_PREFIX + label);
  if (legacyId) return { pageId: legacyId, legacyTitle: true };
  return { pageId: null, legacyTitle: false };
}

// Migrates a page found under the legacy title to the current one, so a
// FUTURE lookup for the same month finds it on the (cheaper, first-checked)
// current-title path and this integration converges on one title scheme
// instead of permanently carrying two.
function renameReportPage_(pageId, newTitle) {
  notionRequest_('patch', '/v1/pages/' + encodeURIComponent(pageId), {
    properties: { title: { title: [{ type: 'text', text: { content: newTitle } }] } },
  });
}

function createReportPage_(parentPageId, title, blocks) {
  const firstChunk = blocks.slice(0, MAX_PAGE_SIZE);
  const rest = blocks.slice(MAX_PAGE_SIZE);
  const created = notionRequest_('post', '/v1/pages', {
    parent: { type: 'page_id', page_id: parentPageId },
    properties: { title: { title: [{ type: 'text', text: { content: title } }] } },
    children: firstChunk,
  });
  appendBlocksChunked_(created.id, rest);
  return created.id;
}

// Replaces a page's content by archiving every existing top-level child
// block, then appending the freshly built blocks. This is the update half
// of idempotency: a re-run for the same month never accumulates duplicate
// sections, it always leaves exactly the latest aggregation behind.
function replacePageContent_(pageId, blocks) {
  let cursor = null;
  const existingIds = [];
  for (let i = 0; i < 20; i++) {
    const query = cursor ? '?start_cursor=' + encodeURIComponent(cursor) + '&page_size=100' : '?page_size=100';
    const result = notionRequest_('get', '/v1/blocks/' + encodeURIComponent(pageId) + '/children' + query);
    (result.results || []).forEach(function (block) { existingIds.push(block.id); });
    if (!result.has_more) break;
    cursor = result.next_cursor;
  }
  existingIds.forEach(function (blockId) {
    notionRequest_('delete', '/v1/blocks/' + encodeURIComponent(blockId));
  });
  appendBlocksChunked_(pageId, blocks);
}

// ---------------------------------------------------------------------------
// Preserving Final Review content across reruns (Codex review, PR #74)
// ---------------------------------------------------------------------------
//
// replacePageContent_ above deletes EVERY top-level block before rebuilding
// a page from scratch. The report's own §5/§6 instruct a monthly Final
// Review to append structural-problem/countermeasure content directly onto
// this page (see SECTION5_PLACEHOLDER_TEXT/SECTION6_PLACEHOLDER_TEXT) — a
// rerun (the trigger firing again, or a manual generateMonthlyKpiReportFor
// backfill for an already-reported month) must not silently destroy that
// content. Rather than special-casing replacePageContent_ itself (which
// would need to know which blocks are "ours" vs. "theirs" mid-delete), this
// integration reads the existing page's §5/§6 content BEFORE
// replacePageContent_ runs, and buildReportBlocks_ re-embeds it into the
// freshly generated page at the same position — so the rebuilt page's
// content is a strict superset of the previous one plus this month's fresh
// aggregates, never a regression to the empty placeholder.

// Returns the plain text of any block type that carries `rich_text` under
// its type-keyed data (heading_1/2/3, paragraph, callout, quote, ...); ''
// for a block with no rich_text (table, divider, image, ...).
function blockPlainText_(block) {
  if (!block || !block.type) return '';
  const data = block[block.type];
  if (!data || !Array.isArray(data.rich_text)) return '';
  return data.rich_text.map(function (rt) { return rt.plain_text || (rt.text && rt.text.content) || ''; }).join('');
}

// Strips a block fetched FROM the Notion API (id, created_time,
// created_by, last_edited_*, parent, has_children, ...) down to the shape
// the API accepts when appended back as new content, recursing into any
// nested children (a table's rows, a toggle's/bulleted item's nested
// blocks, ...) the same way tableBlock_ already embeds table_row children
// inline. Known gap: a block whose type-data itself contains a
// short-lived reference (e.g. an uploaded `image`/`file` block's expiring
// internal S3 URL) cannot be faithfully re-posted this way — realistic
// Final Review content (headings, paragraphs, lists, callouts, quotes,
// tables, to-dos, code, dividers) has no such field, so this is treated as
// an accepted, documented limitation (README) rather than solved here.
function sanitizeBlockForAppend_(block) {
  const type = block.type;
  const data = Object.assign({}, block[type]);
  if (block.has_children) {
    data.children = fetchPageChildren_(block.id).map(sanitizeBlockForAppend_);
  }
  const sanitized = { object: 'block', type: type };
  sanitized[type] = data;
  return sanitized;
}

// Slices out whatever sits between `startHeadingText` and the next
// recognized boundary heading (`endHeadingTexts`, or end-of-page if none of
// them appear), drops this file's own regenerated placeholder callout when
// it is the very first block there (it is always re-added by
// buildReportBlocks_ itself), and sanitizes everything else for re-append.
// Returns [] when the heading itself is not found (first-ever generation,
// or a page whose structure predates this feature) — never throws, so a
// missing/unexpected page shape degrades to "nothing to preserve" rather
// than blocking the current month's report.
function extractSectionHumanContent_(blocks, startHeadingText, endHeadingTexts, placeholderText) {
  const startIdx = blocks.findIndex(function (b) { return b.type === 'heading_2' && blockPlainText_(b) === startHeadingText; });
  if (startIdx === -1) return [];
  let endIdx = blocks.length;
  for (let i = startIdx + 1; i < blocks.length; i++) {
    if (blocks[i].type === 'heading_2' && endHeadingTexts.indexOf(blockPlainText_(blocks[i])) !== -1) {
      endIdx = i;
      break;
    }
  }
  const body = blocks.slice(startIdx + 1, endIdx);
  const withoutOwnPlaceholder = body.filter(function (block, i) {
    return !(i === 0 && block.type === 'callout' && blockPlainText_(block) === placeholderText);
  });
  return withoutOwnPlaceholder.map(sanitizeBlockForAppend_);
}

// Reads back an existing report page's §5/§6 content (see
// extractSectionHumanContent_) for buildReportBlocks_ to re-embed. Never
// throws: any failure (page deleted mid-run, unexpected block shape,
// transient API error) degrades to "nothing to preserve" via the same
// pattern fetchPreviousMonthRawMetrics_ already uses, rather than blocking
// the current month's report generation over a best-effort preservation
// feature.
function extractPreservedSections_(pageId) {
  try {
    const blocks = fetchPageChildren_(pageId);
    return {
      section5: extractSectionHumanContent_(blocks, SECTION5_HEADING, [SECTION6_HEADING], SECTION5_PLACEHOLDER_TEXT),
      section6: extractSectionHumanContent_(blocks, SECTION6_HEADING, [DATA_QUALITY_HEADING], SECTION6_PLACEHOLDER_TEXT),
    };
  } catch (err) {
    Logger.log('extractPreservedSections_ failed for ' + pageId + ': ' + err);
    return { section5: [], section6: [] };
  }
}

function appendBlocksChunked_(pageId, blocks) {
  for (let i = 0; i < blocks.length; i += MAX_PAGE_SIZE) {
    const chunk = blocks.slice(i, i + MAX_PAGE_SIZE);
    if (chunk.length === 0) continue;
    notionRequest_('patch', '/v1/blocks/' + encodeURIComponent(pageId) + '/children', { children: chunk });
  }
}

// ---------------------------------------------------------------------------
// Notion I/O primitives (mirrors integrations/notion-time-events/Code.gs)
// ---------------------------------------------------------------------------

function retrieveNotionPage_(pageId) {
  return notionRequest_('get', '/v1/pages/' + encodeURIComponent(pageId));
}

const NOTION_RATE_LIMIT_MAX_RETRIES = 5;

function notionRequest_(method, path, body) {
  const token = PropertiesService.getScriptProperties().getProperty('NOTION_TOKEN');
  if (!token) throw new Error('NOTION_TOKEN is not configured in Apps Script Script Properties.');

  const options = {
    method: method,
    headers: {
      Authorization: 'Bearer ' + token,
      'Notion-Version': DEFAULTS.NOTION_VERSION,
    },
    muteHttpExceptions: true,
  };
  if (body !== undefined) {
    options.contentType = 'application/json';
    options.payload = JSON.stringify(body);
  }

  // Notion rate-limits at ~3 req/s; at this integration's monthly PR/attribution
  // volume (200+ per-PR lookups) a 429 is expected, not exceptional. Honor
  // Retry-After (falling back to exponential backoff if absent) instead of
  // treating the first 429 as fatal and aborting the whole monthly run.
  for (let attempt = 0; attempt <= NOTION_RATE_LIMIT_MAX_RETRIES; attempt++) {
    const response = UrlFetchApp.fetch('https://api.notion.com' + path, options);
    const code = response.getResponseCode();
    const text = response.getContentText();
    if (code === 429 && attempt < NOTION_RATE_LIMIT_MAX_RETRIES) {
      const retryAfterHeader = response.getHeaders()['Retry-After'] || response.getHeaders()['retry-after'];
      const retryAfterSec = parseInt(retryAfterHeader, 10);
      const waitMs = (isNaN(retryAfterSec) ? Math.pow(2, attempt) : retryAfterSec) * 1000;
      Logger.log('notionRequest_ got 429 for ' + method.toUpperCase() + ' ' + path + ', retrying in ' + waitMs + 'ms (attempt ' + (attempt + 1) + '/' + NOTION_RATE_LIMIT_MAX_RETRIES + ')');
      Utilities.sleep(waitMs);
      continue;
    }
    if (code < 200 || code >= 300) {
      throw new Error('Notion API failed: ' + method.toUpperCase() + ' ' + path + ' HTTP ' + code + ' ' + text);
    }
    return text ? JSON.parse(text) : {};
  }
  throw new Error('Notion API failed: ' + method.toUpperCase() + ' ' + path + ' — exhausted retries on HTTP 429');
}

const QUERY_PAGE_SAFETY_LIMIT = 50;

function paginateNotionQuery_(path, baseBody) {
  let cursor = null;
  let results = [];
  let truncated = false;
  for (let page = 0; page < QUERY_PAGE_SAFETY_LIMIT; page++) {
    const body = Object.assign({}, baseBody, cursor ? { start_cursor: cursor } : {});
    const response = notionRequest_('post', path, body);
    results = results.concat(response.results || []);
    if (!response.has_more) return { results: results, truncated: false };
    cursor = response.next_cursor;
  }
  truncated = true;
  Logger.log('paginateNotionQuery_ hit QUERY_PAGE_SAFETY_LIMIT for ' + path + ' — result set truncated.');
  return { results: results, truncated: truncated };
}

// ---------------------------------------------------------------------------
// GitHub I/O primitive
// ---------------------------------------------------------------------------

function githubRequest_(path) {
  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) throw new Error('GITHUB_TOKEN is not configured in Apps Script Script Properties.');

  const options = {
    method: 'get',
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    muteHttpExceptions: true,
  };
  const response = UrlFetchApp.fetch('https://api.github.com' + path, options);
  const code = response.getResponseCode();
  const text = response.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error('GitHub API failed: GET ' + path + ' HTTP ' + code + ' ' + text);
  }
  return text ? JSON.parse(text) : {};
}

// ---------------------------------------------------------------------------
// Script property accessors
// ---------------------------------------------------------------------------

function tasksDataSourceId_() {
  return PropertiesService.getScriptProperties().getProperty('TASKS_DATA_SOURCE_ID') || DEFAULTS.TASKS_DATA_SOURCE_ID;
}

function timeEventsDataSourceId_() {
  return PropertiesService.getScriptProperties().getProperty('TIME_EVENTS_DATA_SOURCE_ID') || DEFAULTS.TIME_EVENTS_DATA_SOURCE_ID;
}

function productsDataSourceId_() {
  return PropertiesService.getScriptProperties().getProperty('PRODUCTS_DATA_SOURCE_ID') || DEFAULTS.PRODUCTS_DATA_SOURCE_ID;
}

function kpiFrameworkPageId_() {
  return PropertiesService.getScriptProperties().getProperty('KPI_FRAMEWORK_PAGE_ID') || DEFAULTS.KPI_FRAMEWORK_PAGE_ID;
}

function githubRepos_() {
  const raw = PropertiesService.getScriptProperties().getProperty('GITHUB_REPOS');
  if (!raw) return DEFAULTS.GITHUB_REPOS;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : DEFAULTS.GITHUB_REPOS;
  } catch (err) {
    return DEFAULTS.GITHUB_REPOS;
  }
}

// ---------------------------------------------------------------------------
// Concurrency guard
// ---------------------------------------------------------------------------

function withRunLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) {
    Logger.log('generateMonthlyKpiReport: another run holds the lock, skipping this invocation.');
    return { skipped: true, reason: 'locked' };
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}
