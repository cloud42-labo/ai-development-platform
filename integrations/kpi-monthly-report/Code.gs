// AI Organization KPI — monthly report generator (ADP-055)
//
// Purpose: on the 1st of each month (JST), aggregate the PRIOR JST calendar
// month from Notion `Task Time Events` + `Stories & Tasks` and from GitHub
// PR activity, and create-or-update one Notion page titled
// `AI Organization KPI｜YYYY-MM` under the existing
// `AI Organization KPI Framework｜週次・月次の能力配分とフロー管理` page.
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
  // "AI Organization KPI Framework｜週次・月次の能力配分とフロー管理"
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
const REPORT_TITLE_PREFIX = 'AI Organization KPI｜';

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

  const blockedSnapshot = aggregateBlockedSnapshot_(queryCurrentBlockedTasks_().results, productMap);
  const humanQueueSnapshot = aggregateHumanQueueSnapshot_(queryCurrentOpenHumanRequests_().results, productMap);
  const humanCompletedInMonth = aggregateHumanCompletedInMonth_(completedTasks.results, productMap);

  const githubReport = aggregateGitHub_(target);

  const report = {
    target: target,
    timeEvents: { truncated: timeEvents.truncated, agg: timeAgg, byProduct: timeByProduct },
    tasks: { truncated: completedTasks.truncated, agg: taskAgg },
    blocked: blockedSnapshot,
    humanQueue: humanQueueSnapshot,
    humanCompleted: humanCompletedInMonth,
    github: githubReport,
    generatedAtIso: new Date().toISOString(),
  };

  const blocks = buildReportBlocks_(report);
  const title = REPORT_TITLE_PREFIX + target.label;
  const existingPageId = findExistingReportPage_(kpiFrameworkPageId_(), title);

  if (existingPageId) {
    replacePageContent_(existingPageId, blocks);
    Logger.log('Updated existing report page ' + existingPageId + ' for ' + target.label);
    return { pageId: existingPageId, action: 'updated', label: target.label };
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

function queryCurrentOpenHumanRequests_() {
  return paginateNotionQuery_(
    '/v1/data_sources/' + encodeURIComponent(tasksDataSourceId_()) + '/query',
    {
      page_size: MAX_PAGE_SIZE,
      filter: {
        and: [
          { property: 'Type', select: { equals: 'Human Request' } },
          {
            or: ['Ready', 'In Progress', 'Review', 'Backlog'].map(function (s) {
              return { property: 'Status', select: { equals: s } };
            }),
          },
        ],
      },
    }
  );
}

function productNamesForTask_(task, productMap) {
  const ids = relationIds_(task.properties.Product);
  const names = ids.map(function (id) { return productMap[id] || UNKNOWN_LABEL; });
  return names.length > 0 ? names : [UNKNOWN_LABEL];
}

// Groups completed Tasks (Status left unfiltered on purpose: Completed At
// being set in range is the membership test, matching what Done-gate
// evidence rules already treat as authoritative) by Product, counting them
// and averaging `Lead Time (h)`.
function aggregateTasksByProduct_(tasks, productMap) {
  const byProduct = {};

  function ensure(name) {
    if (!byProduct[name]) byProduct[name] = { completedCount: 0, leadTimeSum: 0, leadTimeCount: 0 };
    return byProduct[name];
  }

  tasks.forEach(function (task) {
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

  function ensureProduct(name) {
    if (!byProduct[name]) byProduct[name] = { created: 0, merged: 0 };
    return byProduct[name];
  }

  repos.forEach(function (repo) {
    const created = githubSearchPRs_(repo, 'created', target);
    const merged = githubSearchPRs_(repo, 'merged', target);
    anyTruncated = anyTruncated || created.truncated || merged.truncated;

    byRepo[repo] = { created: created.totalCount, merged: merged.totalCount };

    created.items.forEach(function (item) {
      const product = lookupProductForPr_(repo, item.number) || UNKNOWN_LABEL;
      ensureProduct(product).created += 1;
    });
    merged.items.forEach(function (item) {
      const product = lookupProductForPr_(repo, item.number) || UNKNOWN_LABEL;
      ensureProduct(product).merged += 1;
    });
  });

  return { byRepo: byRepo, byProduct: byProduct, truncated: anyTruncated };
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

// Attributes one GitHub PR to a Product by matching its URL against Stories
// & Tasks' `Pull Request` property. Returns null (caller maps to
// UNKNOWN_LABEL) if no Task references this PR, or the matching Task has no
// Product set, or more than one Task references it ambiguously.
function lookupProductForPr_(repo, number) {
  const needle = repo + '/pull/' + number;
  const result = notionRequest_('post', '/v1/data_sources/' + encodeURIComponent(tasksDataSourceId_()) + '/query', {
    page_size: 5,
    filter: { property: 'Pull Request', url: { contains: needle } },
  });
  const matches = (result.results || []).filter(function (task) {
    const url = task.properties['Pull Request'] && task.properties['Pull Request'].url;
    return typeof url === 'string' && url.indexOf(needle) !== -1;
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

function buildReportBlocks_(report) {
  const t = report.target;
  const blocks = [];

  blocks.push(calloutBlock_(
    '対象期間: JST ' + t.year + '-' + pad2_(t.month) + '-01 00:00 〜 翌月01日 00:00（' + t.startIso + ' 〜 ' + t.endIsoExclusive + ', UTC表記）。' +
    '生成時刻: ' + report.generatedAtIso + '。定義は AI Organization KPI Framework を正本とする。' +
    (report.timeEvents.truncated || report.tasks.truncated || report.github.truncated
      ? ' ⚠️ 一部集計がページング上限に達し切り捨てられている可能性があります（Known limitationsを参照）。'
      : ''),
    '🎯'
  ));

  blocks.push(textBlock_('heading_2', '1. Product別 Capacity Allocation & Outcome'));

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

  blocks.push(textBlock_('heading_2', '2. 組織全体サマリー（Task Time Events）'));
  blocks.push(textBlock_('paragraph', 'Active延べ時間: ' + formatHours_(report.timeEvents.agg.totalActive) +
    ' ／ Waiting延べ時間: ' + formatHours_(report.timeEvents.agg.totalWaiting) +
    ' ／ Flow Efficiency: ' + formatPercent_(report.timeEvents.agg.flowEfficiency) +
    ' ／ Review Fix Ratio: ' + formatPercent_(report.timeEvents.agg.reviewFixRatio) +
    ' ／ 対象Time Event件数: ' + report.timeEvents.agg.eventCount));

  const actorHeader = ['Actor', 'Active(h)', 'Waiting(h)'];
  const actorNames = Object.keys(report.timeEvents.agg.byActor).sort();
  blocks.push(tableBlock_(actorHeader, actorNames.map(function (name) {
    const a = report.timeEvents.agg.byActor[name];
    return [name, round1_(a.active), round1_(a.waiting)];
  })));

  const workTypeHeader = ['Work Type', 'Active(h)'];
  const workTypeNames = Object.keys(report.timeEvents.agg.byWorkType).sort();
  blocks.push(tableBlock_(workTypeHeader, workTypeNames.map(function (name) {
    return [name, round1_(report.timeEvents.agg.byWorkType[name])];
  })));

  blocks.push(textBlock_('heading_2', '3. Repository別 PR実績（補助軸）'));
  const repoHeader = ['Repository', 'PR作成', 'PR Merge'];
  const repoNames = Object.keys(report.github.byRepo).sort();
  blocks.push(tableBlock_(repoHeader, repoNames.map(function (name) {
    const r = report.github.byRepo[name];
    return [name, r.created, r.merged];
  })));

  blocks.push(textBlock_('heading_2', '4. Blocked / Human Gate（現在スナップショット）'));
  blocks.push(calloutBlock_(
    'ここでの「Blocked」「Human Queue」は本レポート生成時点のスナップショットであり、対象月中の推移ではありません。' +
    'また Blocked理由（AI Dependency / True Human Gate / External Condition / Stale Blocker）の分類は行っていません — ' +
    'この分類は週次Sprint ReviewでのHuman/AI判断を要するため、本自動集計の対象外です（推測分類はしません）。' +
    '「Human Request完了」は対象月中にCompleted Atが入ったType=Human Requestの件数です。',
    '⚠️'
  ));
  blocks.push(textBlock_('paragraph', '現在Blocked件数（全Product合計）: ' + report.blocked.total +
    ' ／ 現在Human Queue件数（全Product合計、Ready/In Progress/Review/Backlog）: ' + report.humanQueue.total));

  blocks.push(textBlock_('heading_2', '5. データ欠損・Unknown/未分類の扱い'));
  blocks.push(textBlock_('paragraph',
    'Task Time EventsのTaskリレーションが無い、対応するTaskにProductが未設定、またはGitHub PRに対応するNotion Task（Pull Request URL一致）が' +
    '見つからない場合は "' + UNKNOWN_LABEL + '" として明示しています。値を推測して埋めることはしていません。'));

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

  const response = UrlFetchApp.fetch('https://api.notion.com' + path, options);
  const code = response.getResponseCode();
  const text = response.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error('Notion API failed: ' + method.toUpperCase() + ' ' + path + ' HTTP ' + code + ' ' + text);
  }
  return text ? JSON.parse(text) : {};
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
