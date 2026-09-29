// ADP-051-C: regression tests for the independent Review Source resolver —
// docs/review-fix-state-model.md §5 (+ §6 churn inheritance, reusing the
// already-tested ADP-051-B6 helpers unmodified). Named after the
// failure-matrix row each test regression-tests, from
// docs/review-fix-state-model.md §7's §5-tagged rows: #1 (pagination),
// #13 (reuse the exact Work Type evidence instant), #17/#21/#23/#25/#30/#34
// (no rounding either bound; minute-ambiguity degrade), #37/#43/#44/#47/#49
// (asymmetric lower/upper-bound degrade-to-Other rules), #50/#52/#53
// (backlog-dependent widening), plus §5 step 4's explicit degrade-to-Other
// gates (missing PR/token/API failure/unexpected shape).
//
// This file tests the resolver functions directly, in isolation — see
// test/review-source-wiring.test.mjs for the end-to-end
// reconcileAuthoritativeTimeEvents_/pollTaskChanges wiring tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCodeGsSandbox } from './support/gas-sandbox.mjs';

function dateProp(iso) {
  return iso ? { type: 'date', date: { start: iso } } : { type: 'date', date: null };
}

function textProp(value) {
  return { type: 'rich_text', rich_text: value ? [{ plain_text: value }] : [] };
}

function selectProp(value) {
  return { type: 'select', select: value ? { name: value } : null };
}

function note(...segments) {
  return segments.join(' | ');
}

function eventPage(id, { startedAt, endedAt, note: noteText = '', reviewSource } = {}) {
  const properties = {
    'Started At': dateProp(startedAt),
    'Ended At': dateProp(endedAt),
    Note: textProp(noteText),
  };
  if (reviewSource !== undefined) properties['Review Source'] = selectProp(reviewSource);
  return { id, properties };
}

function harness(fetchImpl) {
  return loadCodeGsSandbox({
    scriptProperties: { NOTION_TOKEN: 'test-notion-token', SPREADSHEET_ID: 'test-sheet', GITHUB_TOKEN: 'test-gh-token' },
    fetch: fetchImpl || (() => ({ getResponseCode: () => 200, getContentText: () => '[]' })),
  });
}

function review(login, submittedAtIso) {
  return { user: { login }, submitted_at: submittedAtIso, state: 'COMMENTED' };
}

const LOWER = { timestamp: new Date('2026-08-01T12:00:00.000Z') };
const UPPER = { timestamp: new Date('2026-08-01T13:00:00.000Z') };

// ---------------------------------------------------------------------------
// parsePullRequestUrl_ / classifyReviewerLogin_
// ---------------------------------------------------------------------------

test('parsePullRequestUrl_: parses a plain PR URL', () => {
  const { sandbox } = harness();
  const parsed = sandbox.parsePullRequestUrl_('https://github.com/cloud42-labo/widgets/pull/42');
  assert.equal(parsed.owner, 'cloud42-labo');
  assert.equal(parsed.repo, 'widgets');
  assert.equal(parsed.number, 42);
});

test('parsePullRequestUrl_: parses a PR URL with a trailing fragment', () => {
  const { sandbox } = harness();
  const parsed = sandbox.parsePullRequestUrl_('https://github.com/acme/widgets/pull/7#pullrequestreview-1');
  assert.equal(parsed.owner, 'acme');
  assert.equal(parsed.repo, 'widgets');
  assert.equal(parsed.number, 7);
});

test('parsePullRequestUrl_: returns null for a blank/missing URL', () => {
  const { sandbox } = harness();
  assert.equal(sandbox.parsePullRequestUrl_(''), null);
  assert.equal(sandbox.parsePullRequestUrl_(null), null);
});

test('parsePullRequestUrl_: returns null for a non-PR GitHub URL', () => {
  const { sandbox } = harness();
  assert.equal(sandbox.parsePullRequestUrl_('https://github.com/acme/widgets/issues/7'), null);
});

test('classifyReviewerLogin_: maps a Codex connector login', () => {
  const { sandbox } = harness();
  assert.equal(sandbox.classifyReviewerLogin_('chatgpt-codex-connector[bot]'), 'Codex');
});

test('classifyReviewerLogin_: maps a Claude bot login', () => {
  const { sandbox } = harness();
  assert.equal(sandbox.classifyReviewerLogin_('claude[bot]'), 'Claude');
});

test('classifyReviewerLogin_: an unrecognized bot login is Other, not Human', () => {
  const { sandbox } = harness();
  assert.equal(sandbox.classifyReviewerLogin_('dependabot[bot]'), 'Other');
});

test('classifyReviewerLogin_: an ordinary (non-bot) login is Human', () => {
  const { sandbox } = harness();
  assert.equal(sandbox.classifyReviewerLogin_('komaba'), 'Human');
});

test('classifyReviewerLogin_: a blank login is Other', () => {
  const { sandbox } = harness();
  assert.equal(sandbox.classifyReviewerLogin_(''), 'Other');
  assert.equal(sandbox.classifyReviewerLogin_(undefined), 'Other');
});

// ---------------------------------------------------------------------------
// failure #1: pagination walks every page, not just the first
// ---------------------------------------------------------------------------

test('failure #1: paginateGithubReviews_ walks every page of the GitHub Reviews API', () => {
  const pages = {
    1: Array.from({ length: 100 }, (_, i) => review('human-' + i, '2026-08-01T12:0' + (i % 6) + ':00.000Z')),
    2: [review('the-real-latest-reviewer', '2026-08-01T12:59:59.000Z')],
  };
  const { sandbox, fetchLog } = harness((url) => {
    const pageMatch = /[?&]page=(\d+)/.exec(url);
    const page = pageMatch ? Number(pageMatch[1]) : 1;
    return { getResponseCode: () => 200, getContentText: () => JSON.stringify(pages[page] || []) };
  });
  const reviews = sandbox.paginateGithubReviews_('acme', 'widgets', 42);
  assert.equal(reviews.length, 101);
  assert.equal(reviews[100].user.login, 'the-real-latest-reviewer');
  // Exactly 2 requests: the full first page forces a second fetch, and the
  // second page (below the page size) stops pagination there.
  assert.equal(fetchLog.length, 2);
});

test('failure #1: a PR with fewer reviews than one page stops after the first request', () => {
  const { sandbox, fetchLog } = harness(() => ({
    getResponseCode: () => 200,
    getContentText: () => JSON.stringify([review('solo-reviewer', '2026-08-01T12:00:00.000Z')]),
  }));
  const reviews = sandbox.paginateGithubReviews_('acme', 'widgets', 42);
  assert.equal(reviews.length, 1);
  assert.equal(fetchLog.length, 1);
});

test('failure #1: hitting the page-20 safety cap with a still-full last page throws instead of returning a silently truncated history', () => {
  // Every page returns exactly 100 reviews (a full page), so the loop never
  // sees a short page to stop on and runs out the safety valve at page 20 —
  // there could be a page 21+ this call never saw. Returning `results` here
  // would let the caller classify Review Source from an incomplete history
  // (Codex review comment on PR #76, cloud42-labo/ai-development-platform).
  const { sandbox, fetchLog } = harness((url) => {
    const pageMatch = /[?&]page=(\d+)/.exec(url);
    const page = pageMatch ? Number(pageMatch[1]) : 1;
    return {
      getResponseCode: () => 200,
      getContentText: () => JSON.stringify(Array.from({ length: 100 }, (_, i) => review('r' + page + '-' + i, '2026-08-01T12:00:00.000Z'))),
    };
  });
  assert.throws(() => sandbox.paginateGithubReviews_('acme', 'widgets', 42), /page.*limit|truncat/i);
  assert.equal(fetchLog.length, 20);
});

test('failure #1: resolveReviewSource_ degrades to Other when pagination is truncated at the safety cap', () => {
  const { sandbox } = harness(() => ({
    getResponseCode: () => 200,
    getContentText: () => JSON.stringify(Array.from({ length: 100 }, (_, i) => review('r-' + i, '2026-08-01T12:00:00.000Z'))),
  }));
  const result = sandbox.resolveReviewSource_({
    workType: 'Review Fix', prUrl: 'https://github.com/acme/widgets/pull/42', lowerBound: LOWER, upperBound: UPPER,
  });
  assert.equal(result.reviewSource, 'Other');
  assert.match(result.reason, /^github_api_failure:/);
});

// ---------------------------------------------------------------------------
// classifyReviewSourceFromReviews_ — §5 steps 2-3
// ---------------------------------------------------------------------------

test('exact vs. non-exact matching: a review clearly inside the window (no ambiguity) resolves normally', () => {
  const { sandbox } = harness();
  const reviews = [{ login: 'claude[bot]', submittedAt: new Date('2026-08-01T12:30:00.000Z') }];
  const result = sandbox.classifyReviewSourceFromReviews_(reviews, LOWER, null, UPPER, null);
  assert.equal(result.reviewSource, 'Claude');
});

test('a review before the lower bound (even widened) is excluded entirely', () => {
  const { sandbox } = harness();
  const reviews = [{ login: 'claude[bot]', submittedAt: new Date('2026-08-01T11:00:00.000Z') }];
  const result = sandbox.classifyReviewSourceFromReviews_(reviews, LOWER, null, UPPER, null);
  assert.equal(result.reviewSource, 'Other');
  assert.equal(result.reason, 'no_reviews_in_window');
});

test('a review after the upper bound (even its ambiguous minute) is excluded entirely', () => {
  const { sandbox } = harness();
  const reviews = [{ login: 'claude[bot]', submittedAt: new Date('2026-08-01T13:01:00.000Z') }];
  const result = sandbox.classifyReviewSourceFromReviews_(reviews, LOWER, null, UPPER, null);
  assert.equal(result.reviewSource, 'Other');
  assert.equal(result.reason, 'no_reviews_in_window');
});

test('failure #30: the ONLY candidate falling inside the lower-bound ambiguous minute degrades to Other, never asserts it', () => {
  const { sandbox } = harness();
  const reviews = [{ login: 'claude[bot]', submittedAt: new Date('2026-08-01T12:00:30.000Z') }];
  const result = sandbox.classifyReviewSourceFromReviews_(reviews, LOWER, null, UPPER, null);
  assert.equal(result.reviewSource, 'Other');
  assert.equal(result.reason, 'lower_bound_no_definite_candidate');
});

test('failure #17/#21: a lower-bound-ambiguous review never blocks a later, definite reviewer from winning', () => {
  const { sandbox } = harness();
  const reviews = [
    { login: 'human-account', submittedAt: new Date('2026-08-01T12:00:20.000Z') }, // ambiguous minute, non-causal
    { login: 'claude[bot]', submittedAt: new Date('2026-08-01T12:05:00.000Z') }, // clearly outside/after
  ];
  const result = sandbox.classifyReviewSourceFromReviews_(reviews, LOWER, null, UPPER, null);
  assert.equal(result.reviewSource, 'Claude');
});

test('failure #25/#34: the upper bound is never rounded up to end-of-minute — a review just after the recorded minute is excluded outright, not admitted', () => {
  const { sandbox } = harness();
  const reviews = [
    { login: 'claude[bot]', submittedAt: new Date('2026-08-01T12:30:00.000Z') },
    { login: 'human-account', submittedAt: new Date('2026-08-01T13:01:00.000Z') }, // 1ms past the recorded minute's own end
  ];
  const result = sandbox.classifyReviewSourceFromReviews_(reviews, LOWER, null, UPPER, null);
  // A naive "round up to end-of-minute-and-beyond" bound would treat 13:01
  // as still inside the window and re-open the upper-bound ambiguity check
  // against it; the correct behavior excludes it outright (it postdates the
  // recorded minute entirely), leaving the earlier, unambiguous Claude
  // review as the sole, safe answer.
  assert.equal(result.reviewSource, 'Claude');
});

test('failure #34: an ambiguous-minute review can still change the outcome — a same-category one is safe, a different-category one is not', () => {
  const { sandbox } = harness();
  const reviews = [
    { login: 'claude[bot]', submittedAt: new Date('2026-08-01T12:30:00.000Z') },
    { login: 'human-account', submittedAt: new Date('2026-08-01T13:00:40.000Z') }, // inside the recorded minute itself
  ];
  const result = sandbox.classifyReviewSourceFromReviews_(reviews, LOWER, null, UPPER, null);
  // The 13:00:40 review falls inside UPPER's own ambiguous minute (13:00:xx),
  // not after it, so it is a legitimate ambiguous candidate to check — not
  // excluded outright. It conflicts in category with the definite winner,
  // so this degrades rather than silently keeping the definite candidate.
  assert.equal(result.reviewSource, 'Other');
  assert.equal(result.reason, 'upper_bound_ambiguous_category_conflict');
});

test('failure #47: every candidate falling inside the upper-bound ambiguous minute (none clearly before it) degrades to Other', () => {
  const { sandbox } = harness();
  const reviews = [{ login: 'claude[bot]', submittedAt: new Date('2026-08-01T13:00:10.000Z') }];
  const result = sandbox.classifyReviewSourceFromReviews_(reviews, LOWER, null, UPPER, null);
  assert.equal(result.reviewSource, 'Other');
  assert.equal(result.reason, 'upper_bound_no_definite_candidate');
});

test('failure #37/#43: an ambiguous-minute review of a DIFFERENT category than the definite candidate degrades to Other, even though a definite candidate exists', () => {
  const { sandbox } = harness();
  const reviews = [
    { login: 'human-bob', submittedAt: new Date('2026-08-01T12:30:00.000Z') }, // definite
    { login: 'claude[bot]', submittedAt: new Date('2026-08-01T13:00:40.000Z') }, // ambiguous, later, different category
  ];
  const result = sandbox.classifyReviewSourceFromReviews_(reviews, LOWER, null, UPPER, null);
  assert.equal(result.reviewSource, 'Other');
  assert.equal(result.reason, 'upper_bound_ambiguous_category_conflict');
});

test('failure #44: two reviewers in the SAME category (definite + ambiguous) never need degradation', () => {
  const { sandbox } = harness();
  const reviews = [
    { login: 'human-bob', submittedAt: new Date('2026-08-01T12:30:00.000Z') }, // definite, Human
    { login: 'human-alice', submittedAt: new Date('2026-08-01T13:00:40.000Z') }, // ambiguous, later, also Human
  ];
  const result = sandbox.classifyReviewSourceFromReviews_(reviews, LOWER, null, UPPER, null);
  assert.equal(result.reviewSource, 'Human');
  assert.equal(result.reason, 'resolved');
});

test('failure #49: every later ambiguous-minute review is checked, not only the single overall-latest one', () => {
  const { sandbox } = harness();
  const reviews = [
    { login: 'human-bob', submittedAt: new Date('2026-08-01T12:30:00.000Z') }, // definite, Human
    { login: 'chatgpt-codex-connector[bot]', submittedAt: new Date('2026-08-01T13:00:20.000Z') }, // ambiguous, Codex
    { login: 'human-alice', submittedAt: new Date('2026-08-01T13:00:50.000Z') }, // ambiguous, overall-latest, Human (matches definite)
  ];
  const result = sandbox.classifyReviewSourceFromReviews_(reviews, LOWER, null, UPPER, null);
  // Inspecting only the overall-latest ambiguous review (Human, matching the
  // definite candidate) would wrongly call this safe — the earlier
  // ambiguous Codex review is also a possible "latest eligible reviewer"
  // under some sub-minute reopen ordering and must independently degrade
  // this to Other.
  assert.equal(result.reviewSource, 'Other');
  assert.equal(result.reason, 'upper_bound_ambiguous_category_conflict');
});

test('failure #50: a widened lower-bound floor recovers a causal review that predates the recorded (inflated) boundary minute', () => {
  const { sandbox } = harness();
  // A genuine close's own `Ended At` is inflated by a deferred, backlog-
  // dependent reconciliation cycle: the true transition to Review happened
  // around 12:00, but an unrelated edit lands and Ended At is only recorded
  // as 12:15. A review at 12:05 is genuinely causal (submitted after the
  // true transition, before the reopen) but predates the RECORDED 12:15
  // minute entirely — without widening it is wrongly excluded outright, not
  // merely treated as ambiguous. `floor` is the last independently
  // corroborated point before this close (e.g. the event's own Started At).
  const inflatedLower = { timestamp: new Date('2026-08-01T12:15:00.000Z') };
  const floor = new Date('2026-08-01T11:50:00.000Z');
  const reviews = [{ login: 'claude[bot]', submittedAt: new Date('2026-08-01T12:05:00.000Z') }];
  const withoutFloor = sandbox.classifyReviewSourceFromReviews_(reviews, inflatedLower, null, UPPER, null);
  const withFloor = sandbox.classifyReviewSourceFromReviews_(reviews, inflatedLower, floor, UPPER, null);
  assert.equal(withoutFloor.reviewSource, 'Other');
  assert.equal(withoutFloor.reason, 'no_reviews_in_window', 'without widening the causal review is wrongly excluded outright, treated as predating the window entirely');
  assert.equal(withFloor.reviewSource, 'Other');
  assert.equal(withFloor.reason, 'lower_bound_no_definite_candidate', 'widened, the review correctly enters the window but remains genuinely ambiguous (the sole candidate) rather than being silently admitted');
});

test('failure #52: a widened upper-bound floor stops a genuinely non-causal review from being wrongly credited', () => {
  const { sandbox } = harness();
  // Work resumes at 12:00 (true), but an unrelated edit inflates the
  // recorded reopen to 13:00 (UPPER). A review at 12:05 postdates the true
  // reopen (non-causal) but predates the recorded, inflated value. Without
  // widening it reads as safely "before" the upper bound; widened back to
  // the last corroborated point (here, the lower bound's own instant, 12:00
  // — mirroring the real wiring's choice), it becomes ambiguous instead,
  // and since it is the only candidate, this degrades to Other rather than
  // wrongly crediting it.
  const upperFloor = LOWER.timestamp;
  const reviews = [{ login: 'claude[bot]', submittedAt: new Date('2026-08-01T12:05:00.000Z') }];
  const withoutFloor = sandbox.classifyReviewSourceFromReviews_(reviews, LOWER, null, UPPER, null);
  const withFloor = sandbox.classifyReviewSourceFromReviews_(reviews, LOWER, null, UPPER, upperFloor);
  assert.equal(withoutFloor.reviewSource, 'Claude', 'sanity check: without widening this reads as a definite candidate');
  assert.equal(withFloor.reviewSource, 'Other');
  assert.equal(withFloor.reason, 'upper_bound_no_definite_candidate');
});

test('a trusted, second-precision ("exact") lower bound applies with no ambiguity window at all', () => {
  const { sandbox } = harness();
  const exactLower = { timestamp: new Date('2026-08-01T12:00:50.000Z'), exact: true };
  const reviews = [
    { login: 'human-account', submittedAt: new Date('2026-08-01T12:00:20.000Z') }, // before the exact instant — excluded
    { login: 'claude[bot]', submittedAt: new Date('2026-08-01T12:00:55.000Z') }, // at/after the exact instant — admitted, no ambiguity
  ];
  const result = sandbox.classifyReviewSourceFromReviews_(reviews, exactLower, null, UPPER, null);
  assert.equal(result.reviewSource, 'Claude');
});

test('a trusted, second-precision ("exact") upper bound applies with no ambiguity window at all', () => {
  const { sandbox } = harness();
  const exactUpper = { timestamp: new Date('2026-08-01T13:00:10.000Z'), exact: true };
  const reviews = [{ login: 'claude[bot]', submittedAt: new Date('2026-08-01T13:00:05.000Z') }];
  const result = sandbox.classifyReviewSourceFromReviews_(reviews, LOWER, null, exactUpper, null);
  assert.equal(result.reviewSource, 'Claude');
});

// ---------------------------------------------------------------------------
// resolveReviewSource_ — §5 step 4 degrade-to-Other gates + §6 wiring
// ---------------------------------------------------------------------------

test('resolveReviewSource_: not a Review Fix execution -> no classification at all (empty, not Other)', () => {
  const { sandbox } = harness();
  const result = sandbox.resolveReviewSource_({ workType: 'Initial Work', prUrl: 'https://github.com/acme/widgets/pull/1', lowerBound: LOWER, upperBound: UPPER });
  assert.equal(result.reviewSource, '');
  assert.equal(result.reason, 'not_review_fix');
});

test('resolveReviewSource_: missing Pull Request URL degrades to Other', () => {
  const { sandbox } = harness();
  const result = sandbox.resolveReviewSource_({ workType: 'Review Fix', prUrl: '', lowerBound: LOWER, upperBound: UPPER });
  assert.equal(result.reviewSource, 'Other');
  assert.equal(result.reason, 'missing_or_unparseable_pull_request_url');
});

test('resolveReviewSource_: missing GITHUB_TOKEN degrades to Other, never throws', () => {
  const { sandbox } = loadCodeGsSandbox({
    scriptProperties: { NOTION_TOKEN: 'test-notion-token', SPREADSHEET_ID: 'test-sheet' }, // no GITHUB_TOKEN
    fetch: () => ({ getResponseCode: () => 200, getContentText: () => '[]' }),
  });
  const result = sandbox.resolveReviewSource_({
    workType: 'Review Fix', prUrl: 'https://github.com/acme/widgets/pull/1', lowerBound: LOWER, upperBound: UPPER,
  });
  assert.equal(result.reviewSource, 'Other');
  assert.match(result.reason, /^github_api_failure:/);
});

test('resolveReviewSource_: a GitHub API failure (HTTP 500) degrades to Other, never throws', () => {
  const { sandbox } = harness(() => ({ getResponseCode: () => 500, getContentText: () => 'boom' }));
  const result = sandbox.resolveReviewSource_({
    workType: 'Review Fix', prUrl: 'https://github.com/acme/widgets/pull/1', lowerBound: LOWER, upperBound: UPPER,
  });
  assert.equal(result.reviewSource, 'Other');
  assert.match(result.reason, /^github_api_failure:/);
});

test('resolveReviewSource_: an unexpected response shape (not an array) degrades to Other, never throws', () => {
  const { sandbox } = harness(() => ({ getResponseCode: () => 200, getContentText: () => '{"message":"not found"}' }));
  const result = sandbox.resolveReviewSource_({
    workType: 'Review Fix', prUrl: 'https://github.com/acme/widgets/pull/1', lowerBound: LOWER, upperBound: UPPER,
  });
  assert.equal(result.reviewSource, 'Other');
  assert.match(result.reason, /^github_api_failure:/);
});

test('resolveReviewSource_: missing lower bound (Work Type unresolved or churn-inherited with nothing to check first) degrades to Other', () => {
  const { sandbox } = harness();
  const result = sandbox.resolveReviewSource_({
    workType: 'Review Fix', prUrl: 'https://github.com/acme/widgets/pull/1', lowerBound: null, upperBound: UPPER,
  });
  assert.equal(result.reviewSource, 'Other');
  assert.equal(result.reason, 'missing_lower_bound');
});

test('resolveReviewSource_: end-to-end pagination + classification against a real GitHub response shape', () => {
  const pages = {
    1: Array.from({ length: 100 }, (_, i) => review('human-' + i, '2026-08-01T11:00:00.000Z')), // all before LOWER, excluded
    2: [review('claude[bot]', '2026-08-01T12:30:00.000Z')],
  };
  const { sandbox } = harness((url) => {
    const pageMatch = /[?&]page=(\d+)/.exec(url);
    const page = pageMatch ? Number(pageMatch[1]) : 1;
    return { getResponseCode: () => 200, getContentText: () => JSON.stringify(pages[page] || []) };
  });
  const result = sandbox.resolveReviewSource_({
    workType: 'Review Fix', prUrl: 'https://github.com/acme/widgets/pull/42', lowerBound: LOWER, upperBound: UPPER,
  });
  assert.equal(result.reviewSource, 'Claude');
});

test('resolveReviewSource_ (§6): a same-call churn replacement inherits Review Source from the outgoing sub-interval, never re-resolved fresh', () => {
  const { sandbox, fetchLog } = harness();
  const outgoing = eventPage('evt-outgoing', {
    startedAt: '2026-08-01T05:00:00.000Z',
    note: note('Reason=reassignment'),
    reviewSource: 'Codex',
  });
  const result = sandbox.resolveReviewSource_({
    workType: 'Review Fix',
    prUrl: 'https://github.com/acme/widgets/pull/1', // present, but must be ignored — no fresh GitHub call
    lowerBound: LOWER,
    upperBound: UPPER,
    allEvents: [],
    sameCallOutgoingChurnEvents: [{ event: outgoing, closeReason: 'reassignment' }],
  });
  assert.equal(result.reviewSource, 'Codex');
  assert.equal(result.reason, 'churn_same_call');
  assert.equal(fetchLog.length, 0, 'expected no GitHub call at all when Review Source is inherited via churn');
});

test('resolveReviewSource_ (§6): a cross-poll churn replacement inherits Review Source from the most recently closed event', () => {
  const { sandbox, fetchLog } = harness();
  const outgoing = eventPage('evt-outgoing', {
    startedAt: '2026-08-01T05:00:00.000Z',
    endedAt: '2026-08-01T06:00:00.000Z',
    note: note('Reason=reassignment'),
    reviewSource: 'Human',
  });
  const result = sandbox.resolveReviewSource_({
    workType: 'Review Fix',
    prUrl: 'https://github.com/acme/widgets/pull/1',
    lowerBound: LOWER,
    upperBound: UPPER,
    allEvents: [outgoing],
    sameCallOutgoingChurnEvents: [],
  });
  assert.equal(result.reviewSource, 'Human');
  assert.equal(result.reason, 'churn_cross_poll');
  assert.equal(fetchLog.length, 0);
});

test('resolveReviewSource_ (§6, failure #26): ambiguous_provenance_restart never inherits — falls through to fresh resolution', () => {
  const outgoing = eventPage('evt-restart', {
    startedAt: '2026-08-01T05:00:00.000Z',
    endedAt: '2026-08-01T06:00:00.000Z',
    note: note('Reason=ambiguous_provenance_restart'),
    reviewSource: 'Codex',
  });
  const { sandbox } = harness(() => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify([review('claude[bot]', '2026-08-01T12:30:00.000Z')]) }));
  const result = sandbox.resolveReviewSource_({
    workType: 'Review Fix',
    prUrl: 'https://github.com/acme/widgets/pull/1',
    lowerBound: LOWER,
    upperBound: UPPER,
    allEvents: [outgoing],
    sameCallOutgoingChurnEvents: [],
  });
  assert.equal(result.reviewSource, 'Claude', 'expected a fresh §5 resolution, never the restarted event\'s own stale Review Source');
});

// ---------------------------------------------------------------------------
// resolveNewTimeEventReviewSourceSafely_ — non-blocking defense in depth
// ---------------------------------------------------------------------------

test('resolveNewTimeEventReviewSourceSafely_: a resolver exception never throws — leaves Review Source unset', () => {
  const { sandbox } = harness();
  sandbox.mostRecentlyClosedEvent_ = function () {
    throw new Error('simulated resolver crash');
  };
  const result = sandbox.resolveNewTimeEventReviewSourceSafely_({
    workType: 'Review Fix', prUrl: 'https://github.com/acme/widgets/pull/1', lowerBound: LOWER, upperBound: UPPER,
    allEvents: [], sameCallOutgoingChurnEvents: [],
  });
  assert.equal(result.reviewSource, '');
  assert.match(result.reason, /^resolver_error:/);
});

// ---------------------------------------------------------------------------
// reviewSourceLowerBoundFloor_
// ---------------------------------------------------------------------------

test('reviewSourceLowerBoundFloor_: returns the genuine boundary event\'s own Started At when Work Type won via a genuine boundary', () => {
  const { sandbox } = harness();
  const boundaryEvent = eventPage('evt-boundary', {
    startedAt: '2026-08-01T07:00:00.000Z',
    endedAt: '2026-08-01T12:00:00.000Z',
    note: note('End Status=Review', 'Reason=left_in_progress', 'Boundary=left_in_progress'),
  });
  const workTypeResult = { unresolved: false, workType: 'Review Fix', resolvedAt: { timestamp: new Date('2026-08-01T12:00:00.000Z') }, source: 'genuine_boundary' };
  const floor = sandbox.reviewSourceLowerBoundFloor_(workTypeResult, [boundaryEvent]);
  assert.equal(floor.toISOString(), '2026-08-01T07:00:00.000Z');
});

test('reviewSourceLowerBoundFloor_: returns null when Work Type resolved via the Sync Log side, not a genuine boundary', () => {
  const { sandbox } = harness();
  const workTypeResult = { unresolved: false, workType: 'Review Fix', resolvedAt: { timestamp: new Date('2026-08-01T12:00:00.000Z') }, source: 'sync_log' };
  const floor = sandbox.reviewSourceLowerBoundFloor_(workTypeResult, []);
  assert.equal(floor, null);
});

test('reviewSourceLowerBoundFloor_: returns null when Work Type is unresolved', () => {
  const { sandbox } = harness();
  const floor = sandbox.reviewSourceLowerBoundFloor_({ unresolved: true }, []);
  assert.equal(floor, null);
});
