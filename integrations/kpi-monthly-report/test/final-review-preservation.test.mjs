import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCodeGsSandbox, fetchStub } from './support/gas-sandbox.mjs';

// Regression (Codex review, PR #74): replacePageContent_ deletes every
// top-level block on a rerun. §5/§6 explicitly invite a monthly Final
// Review to append structural-problem/countermeasure content directly onto
// the page — a rerun must not silently destroy that content.

const SCRIPT_PROPS = { NOTION_TOKEN: 't', GITHUB_TOKEN: 't' };

const SECTION5_HEADING = '5. 構造的問題';
const SECTION6_HEADING = '6. 対策・Backlog / Sprint / 正本更新';
const DATA_QUALITY_HEADING = 'データ品質・Unknown/未分類の扱い';

function heading2(text) {
  return { type: 'heading_2', heading_2: { rich_text: [{ plain_text: text }] } };
}
function calloutWithText(text) {
  return { type: 'callout', callout: { rich_text: [{ plain_text: text }] } };
}
function paragraph(text, id) {
  return { id: id || 'p-' + text, type: 'paragraph', paragraph: { rich_text: [{ plain_text: text }] }, has_children: false };
}
// sanitizeBlockForAppend_ passes rich_text through unchanged, so a block
// built with the `plain_text`-only fixtures above keeps `plain_text`, not
// `.text.content` (that shape only comes from this file's own
// textBlock_/calloutBlock_). Read either, like blockPlainText_ itself does.
function richText(rt) { return rt.plain_text || (rt.text && rt.text.content) || ''; }

test('extractSectionHumanContent_ drops the regenerated placeholder callout but keeps human content after it', () => {
  const { sandbox } = loadCodeGsSandbox({ scriptProperties: SCRIPT_PROPS, fetch: fetchStub({}) });
  const placeholder = 'THIS IS THE PLACEHOLDER';
  const blocks = [
    heading2(SECTION5_HEADING),
    calloutWithText(placeholder),
    paragraph('構造的問題1: Open PR Agingが残存'),
    paragraph('構造的問題2: Human Queueが滞留'),
    heading2(SECTION6_HEADING),
  ];

  const result = sandbox.extractSectionHumanContent_(blocks, SECTION5_HEADING, [SECTION6_HEADING], placeholder);

  assert.equal(result.length, 2);
  assert.equal(richText(result[0].paragraph.rich_text[0]), '構造的問題1: Open PR Agingが残存');
  assert.equal(richText(result[1].paragraph.rich_text[0]), '構造的問題2: Human Queueが滞留');
});

test('extractSectionHumanContent_ returns [] when the heading itself is not found (first-ever generation)', () => {
  const { sandbox } = loadCodeGsSandbox({ scriptProperties: SCRIPT_PROPS, fetch: fetchStub({}) });
  const result = sandbox.extractSectionHumanContent_([heading2('unrelated')], SECTION5_HEADING, [SECTION6_HEADING], 'placeholder');
  assert.equal(result.length, 0);
});

test('extractSectionHumanContent_ keeps everything when no human content was ever added (only the placeholder present)', () => {
  const { sandbox } = loadCodeGsSandbox({ scriptProperties: SCRIPT_PROPS, fetch: fetchStub({}) });
  const placeholder = 'placeholder text';
  const blocks = [heading2(SECTION5_HEADING), calloutWithText(placeholder), heading2(SECTION6_HEADING)];
  const result = sandbox.extractSectionHumanContent_(blocks, SECTION5_HEADING, [SECTION6_HEADING], placeholder);
  assert.equal(result.length, 0);
});

test('extractSectionHumanContent_ stops at whichever boundary heading comes first, and runs to page end if none is found', () => {
  const { sandbox } = loadCodeGsSandbox({ scriptProperties: SCRIPT_PROPS, fetch: fetchStub({}) });
  const placeholder = 'placeholder';
  const blocks = [heading2(SECTION6_HEADING), calloutWithText(placeholder), paragraph('対策A')];
  const result = sandbox.extractSectionHumanContent_(blocks, SECTION6_HEADING, [DATA_QUALITY_HEADING], placeholder);
  assert.equal(result.length, 1);
  assert.equal(richText(result[0].paragraph.rich_text[0]), '対策A');
});

test('sanitizeBlockForAppend_ strips API-only metadata (id, has_children, ...) down to an appendable block', () => {
  const { sandbox } = loadCodeGsSandbox({ scriptProperties: SCRIPT_PROPS, fetch: fetchStub({}) });
  const raw = {
    object: 'block',
    id: 'abc-123',
    created_time: '2026-09-01T00:00:00.000Z',
    last_edited_by: { id: 'user-1' },
    type: 'paragraph',
    has_children: false,
    paragraph: { rich_text: [{ type: 'text', plain_text: 'hello', text: { content: 'hello' } }], color: 'default' },
  };
  const sanitized = sandbox.sanitizeBlockForAppend_(raw);
  assert.equal(sanitized.object, 'block');
  assert.equal(sanitized.type, 'paragraph');
  assert.equal(sanitized.paragraph.rich_text[0].plain_text, 'hello');
  assert.equal(sanitized.id, undefined);
  assert.equal(sanitized.created_time, undefined);
});

test('sanitizeBlockForAppend_ recurses into a block with children (e.g. a toggle/bulleted item with nested content)', () => {
  const routes = {
    'GET /v1/blocks/parent-id/children': () => ({
      results: [{ id: 'child-1', type: 'paragraph', has_children: false, paragraph: { rich_text: [{ plain_text: 'nested' }] } }],
      has_more: false,
    }),
  };
  const { sandbox } = loadCodeGsSandbox({ scriptProperties: SCRIPT_PROPS, fetch: fetchStub(routes) });
  const raw = { id: 'parent-id', type: 'bulleted_list_item', has_children: true, bulleted_list_item: { rich_text: [{ plain_text: 'top' }] } };

  const sanitized = sandbox.sanitizeBlockForAppend_(raw);

  assert.equal(sanitized.bulleted_list_item.children.length, 1);
  assert.equal(sanitized.bulleted_list_item.children[0].paragraph.rich_text[0].plain_text, 'nested');
});

test('extractPreservedSections_ returns empty sections (never throws) when the page/blocks are unreadable', () => {
  const routes = {
    'GET /v1/blocks/broken-page/children': () => { throw new Error('simulated transient failure'); },
  };
  const { sandbox } = loadCodeGsSandbox({ scriptProperties: SCRIPT_PROPS, fetch: fetchStub(routes) });
  const result = sandbox.extractPreservedSections_('broken-page');
  assert.equal(result.section5.length, 0);
  assert.equal(result.section6.length, 0);
});

// Exact literals from Code.gs's SECTION5_PLACEHOLDER_TEXT /
// SECTION6_PLACEHOLDER_TEXT. Top-level `const` bindings in the vm-sandboxed
// Code.gs are not exposed as properties on the returned sandbox object (only
// `var`/function declarations are — see the other test files' comments on
// this), so this test hardcodes the real strings rather than reading them
// back, the same way full-report-smoke.test.mjs hardcodes RAW_METRICS_MARKER.
const REAL_SECTION5_PLACEHOLDER_TEXT =
  '本セクションは自動集計の対象外。上記KPI/KMIから構造的問題を判断する作業（Management Point → KPI → KMI → 構造的問題という因果解釈）は、' +
  'Framework §5 Review Cadenceが定める毎月1日の前月Final Review（Human/AI判断）でこのページへ直接追記する。' +
  '推測分類を自動生成しないという本統合の一貫した方針（README Scope decisions）に従い、空欄のまま生成する。';
const REAL_SECTION6_PLACEHOLDER_TEXT =
  '同じく前月Final Reviewで、セクション5の構造的問題ごとに対策と担当Skill（例: pr-review-convergence / human-gate-preflight / ' +
  'backlog-refinement / sprint-planning / sprint-retrospective）を追記し、必要な変更をBacklog・Sprint・正本ドキュメントへ反映する。';

test('end-to-end: generateMonthlyKpiReportFor preserves existing §5/§6 human content through a full rerun (replacePageContent_)', () => {
  let patchedChildren = [];
  const routes = {
    'POST /v1/data_sources/tasks-ds/query': () => ({ results: [], has_more: false }),
    'POST /v1/data_sources/events-ds/query': () => ({ results: [], has_more: false }),
    'POST /v1/data_sources/products-ds/query': () => ({ results: [], has_more: false }),
    'GET /search/issues': () => ({ total_count: 0, items: [] }),
    'GET /v1/blocks/framework-page-id/children': () => ({
      results: [{ id: 'existing-page-id', type: 'child_page', child_page: { title: 'AI Organization KPI / KMI｜2026-09' } }],
      has_more: false,
    }),
    'GET /v1/blocks/existing-page-id/children': () => ({
      results: [
        { id: 'h5', type: 'heading_2', heading_2: { rich_text: [{ plain_text: '5. 構造的問題' }] } },
        { id: 'c5', type: 'callout', has_children: false, callout: { rich_text: [{ plain_text: REAL_SECTION5_PLACEHOLDER_TEXT }] } },
        { id: 'human-1', type: 'paragraph', has_children: false, paragraph: { rich_text: [{ plain_text: '先月Final Reviewが書いた構造的問題メモ' }] } },
        { id: 'h6', type: 'heading_2', heading_2: { rich_text: [{ plain_text: '6. 対策・Backlog / Sprint / 正本更新' }] } },
        { id: 'c6', type: 'callout', has_children: false, callout: { rich_text: [{ plain_text: REAL_SECTION6_PLACEHOLDER_TEXT }] } },
        { id: 'human-2', type: 'paragraph', has_children: false, paragraph: { rich_text: [{ plain_text: '先月Final Reviewが書いた対策メモ' }] } },
        { id: 'hdq', type: 'heading_2', heading_2: { rich_text: [{ plain_text: 'データ品質・Unknown/未分類の扱い' }] } },
      ],
      has_more: false,
    }),
    'DELETE *': () => ({}),
    'PATCH /v1/blocks/existing-page-id/children': (body) => {
      patchedChildren = patchedChildren.concat(body.children);
      return {};
    },
  };

  const { sandbox } = loadCodeGsSandbox({
    scriptProperties: Object.assign({}, SCRIPT_PROPS, {
      TASKS_DATA_SOURCE_ID: 'tasks-ds',
      TIME_EVENTS_DATA_SOURCE_ID: 'events-ds',
      PRODUCTS_DATA_SOURCE_ID: 'products-ds',
      KPI_FRAMEWORK_PAGE_ID: 'framework-page-id',
      GITHUB_REPOS: JSON.stringify(['acme/widgets']),
    }),
    fetch: fetchStub(routes),
  });

  const result = sandbox.generateMonthlyKpiReportFor('2026-09');
  assert.equal(result.action, 'updated');

  // Generated blocks (textBlock_/calloutBlock_) only set `.text.content`;
  // preserved/sanitized blocks carry through whatever the mocked GET
  // response had (`.plain_text` here, mirroring a real Notion API read) —
  // read either, the same fallback pageTitle_ and blockPlainText_ already use.
  function richText(rt) { return rt.plain_text || (rt.text && rt.text.content) || ''; }

  const paragraphTexts = patchedChildren
    .filter((b) => b.type === 'paragraph')
    .map((b) => richText(b.paragraph.rich_text[0]));

  assert.ok(paragraphTexts.includes('先月Final Reviewが書いた構造的問題メモ'), 'expected §5 human content to survive the rerun');
  assert.ok(paragraphTexts.includes('先月Final Reviewが書いた対策メモ'), 'expected §6 human content to survive the rerun');

  // And the regenerated placeholder callouts must still be present exactly
  // once each — the human content is preserved ALONGSIDE the fresh
  // placeholder, not instead of it.
  const calloutTexts = patchedChildren.filter((b) => b.type === 'callout').map((b) => richText(b.callout.rich_text[0]));
  assert.equal(calloutTexts.filter((t) => t === REAL_SECTION5_PLACEHOLDER_TEXT).length, 1);
  assert.equal(calloutTexts.filter((t) => t === REAL_SECTION6_PLACEHOLDER_TEXT).length, 1);
});
