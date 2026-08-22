# ADP-045-B — Cloudflare OS Notion runtime PoC

## Goal

Verify whether Cloudflare OS can eliminate the recurring Claude/Notion synchronous approval stall without weakening the Human-on-the-Loop boundary.

The test order is intentionally:

1. Official Cloudflare OS + official Notion Gatekeeper.
2. Official Cloudflare OS + the minimal safe-property auto-approval PoC in this directory.
3. Only if those fail the ADP requirements, consider a separate ADP-native runtime policy checker.

## Safety boundary

Use a dedicated PoC Notion database only. Do not connect a broad production workspace for this experiment.

The optional auto-approval modifier permits only:

- `Status` when the Notion property input type is `status`;
- `Result` when the Notion property input type is `rich_text`.

Everything else remains manual, including archive/trash, page creation, comments, title changes, icons, and unrelated properties.

Cloudflare OS still requires the Human user to explicitly enable the returned `notion.task.safe-properties` auto-approval action kind. The Gatekeeper continues to submit every write to the ApprovalQueue; the modifier does not bypass the queue.

## Human prerequisite

Create a Notion Public Integration for the PoC.

Local redirect URI:

```text
http://localhost:8787/gatekeeper/notion/oauth
```

Recommended capabilities from the official Gatekeeper README:

- read content;
- insert content;
- update content;
- read comments;
- insert comments;
- read user info;
- email access is not required.

Store the client credentials only in the local Cloudflare OS checkout's root `.dev.vars`:

```text
NOTION_CLIENT_ID=...
NOTION_CLIENT_SECRET=...
```

Do not commit `.dev.vars` and do not paste either secret into Notion, GitHub, task Result, or chat logs.

## Prepare Cloudflare OS

```bash
git clone https://github.com/cloudflare/cloudflare-os.git
cd cloudflare-os
corepack enable
pnpm run-local
```

The official local server is expected at:

```text
http://localhost:8787
```

For the initial baseline, do not apply the modifier yet.

## Baseline scenario — official Notion Gatekeeper

Connect only the dedicated PoC Notion database/page through the Notion OAuth picker.

Execute one autonomous sequence:

1. Read the test row.
2. Set `Status` to `In Progress`.
3. Read it back immediately.
4. Set `Result` to a short PoC string.
5. Read it back immediately.
6. Queue an intentionally manual action such as archive, but do not approve it immediately.
7. Observe whether the Agent can continue reasoning against the simulated pending state.
8. Approve/reject queued writes and verify the real Notion state.

Record:

- Human prompts generated;
- whether the Agent turn blocks synchronously;
- whether pending writes are visible in simulated reads;
- real Notion state after approval/rejection;
- credentials visible to the Agent: expected no;
- resource scope: expected dedicated shared resource only;
- audit evidence available.

## Apply the safe-property modifier

Copy `apply-notion-safe-auto-approval.mjs` from this ADP branch into the Cloudflare OS checkout, or run it by absolute path while the current directory is the Cloudflare OS repository root.

Example:

```bash
node /path/to/ai-development-platform/poc/cloudflare-os/apply-notion-safe-auto-approval.mjs
```

The script fails closed if the expected upstream source anchors do not match. It modifies:

- `packages/gatekeeper-notion/src/notion-actions.ts`;
- `packages/gatekeeper-notion/src/notion.ts`;
- adds `packages/gatekeeper-notion/__tests__/notion-auto-approval.test.ts`.

Run tests:

```bash
pnpm --filter @gadgets/notion-gatekeeper test:run
```

Then restart local Cloudflare OS.

## Auto-approval scenario

On the dedicated PoC Notion binding, enable the `Update safe task properties` auto-approval action kind in Cloudflare OS.

Repeat:

1. Read row.
2. Set `Status`.
3. Read back.
4. Set `Result`.
5. Read back.
6. Attempt an unrelated property update or archive action.

Expected result:

- `Status` / `Result` updates are eligible for auto-apply once the Human has pre-approved that action kind;
- unrelated updates still queue for manual approval;
- archive remains manual;
- all actions remain in the Gatekeeper audit path.

## Pass criteria

Cloudflare OS passes ADP-045-B if all of the following hold:

1. Routine `Status` / `Result` operations can run without per-operation Human interruption after explicit pre-approval.
2. High-risk or unrelated operations still require manual approval.
3. The Agent can continue through pending simulated state where approval is deferred.
4. Notion credentials are mediated by Gatekeeper and not exposed to Agent context.
5. Resource scope can be constrained to the dedicated Notion test resource.
6. Audit evidence is available for reads/writes.
7. No new metered external AI API is required for the PoC.

If the official Cloudflare OS Agent requires a metered provider for the chosen runtime, use an available local/non-metered model path for the product-mechanics test rather than silently consuming a new external API.

## Decision after test

- **Pass with official Gatekeeper:** adopt without customization.
- **Pass only with this small modifier:** prefer Cloudflare OS + maintained narrow Gatekeeper customization.
- **Fail because the existing Claude Code harness cannot practically use the Gatekeeper and moving the workload into Cloudflare OS is unacceptable:** document that integration blocker before considering an ADP-native enforcement service.
- **Do not build a second policy engine merely because the official Notion Gatekeeper defaults to manual writes.** The platform already has the approval queue and auto-approval engine; first test the smallest extension.
