# Cloudflare OS Notion Gatekeeper PoC — ADP-045-B

Date: 2026-08-22 (JST)
Status: **Step 1 complete: implementation-level verification. Runtime integration test still pending.**

## Purpose

Test whether Cloudflare OS can solve the recurring autonomy problem in ADP where Claude is repeatedly stopped by approval prompts during routine Notion operations. The priority is to reuse an existing implementation before building a new authorization system.

## Current result

Cloudflare OS is a serious candidate, but the result is more specific than “install it and approvals disappear.”

1. Cloudflare OS includes an official `gatekeeper-notion` implementation.
2. It provides OAuth credential mediation, narrow Notion resource access, read authorization, action auditing/approval, and pending-write simulation.
3. Pending Notion writes are simulated so the agent can continue working without waiting synchronously for each Human decision.
4. **The current Notion Gatekeeper does not mark any Notion write as auto-approvable.** Its `getAutoApprovableActions()` returns an empty list, and current Notion `ActionDescription`s do not supply `actionKind` / `autoApprovable` metadata.
5. Cloudflare OS itself already contains a generic auto-approval engine. Auto-apply requires both a Gatekeeper-authored `autoApprovable: true` verdict and a user-enabled rule for the action kind. All actions still pass through the ApprovalQueue and remain auditable.
6. Therefore, the likely smallest Cloudflare-OS-based solution is **not** to recreate Gatekeeper. It is to evaluate a narrow customization of `gatekeeper-notion` that marks explicitly low-risk Notion actions as eligible for user pre-approval while keeping destructive/high-risk actions manual.

## What the official Notion Gatekeeper already provides

### Authentication and credentials

`packages/gatekeeper-notion/README.md` documents a Notion OAuth 2.0 public integration. For local development, `NOTION_CLIENT_ID` and `NOTION_CLIENT_SECRET` are mapped into the Gatekeeper Worker. Tokens are held by the Gatekeeper's `UserAccount` Durable Object rather than exposed as ordinary agent context.

The local redirect URI is:

`http://localhost:8787/gatekeeper/notion/oauth`

The official recommended capabilities are read/insert/update content, read/insert comments, and read user info.

### Resource scope

The Gatekeeper can bind either:

- the connected workspace; or
- a specific Notion page/database.

Only resources shared with the integration through the Notion OAuth page picker are reachable. This provides a stronger resource boundary than simply giving an agent a workspace-wide credential.

### Read path

Every read is submitted to `authorizeObservation()` before protected data is returned. This gives Cloudflare OS a common authorization/audit point for observations.

### Write path

Notion writes such as:

- append page content;
- rename page;
- set page/database-row properties;
- change icon;
- archive/restore;
- add comment;
- create page;

are first stored as pending actions and submitted through `submitAction()`. The actual Notion API call is performed only later from `applyAction()`.

### Deferred approval and simulation

The Notion Gatekeeper keeps pending actions in Durable Object storage and overlays them on subsequent reads. This means an unapproved Status/Result/property update can appear in the agent's simulated Notion state, allowing later reasoning to proceed against the intended state rather than blocking on the first approval.

This directly addresses the “agent stopped on the first approval and did no more work” failure mode.

## Important gap: routine Notion writes are not auto-approved out of the box

Cloudflare OS supports auto-approval at the platform level, but the current Notion Gatekeeper opts into none of it.

The generic Gatekeeper contract supports:

- `ActionDescription.actionKind`
- `ActionDescription.autoApprovable`
- `Gatekeeper.getAutoApprovableActions()`

The Workshop auto-approval engine requires **both**:

1. the specific action to be marked `autoApprovable: true`; and
2. the Human user to have enabled auto-approval for that action kind.

It stops at the first manual gate and does not silently skip ahead, preserving action order.

Current `gatekeeper-notion` action descriptions only define the approval display and revert support. They do not currently define `actionKind` or `autoApprovable`, and the Notion Gatekeepers return `[]` from `getAutoApprovableActions()`.

### Consequence for ADP

Out of the box, Cloudflare OS can improve autonomy by making approval **asynchronous**, but it does not currently eliminate Human review for routine Notion writes.

A Cloud42-Labo customization could potentially make selected actions pre-approvable, for example:

- `setProperties` restricted to approved task fields such as Status/Result;
- possibly append-only content changes in explicitly scoped test/operational pages.

The following should remain manual by default:

- archive/delete-like operations;
- workspace-wide page creation without a narrow parent scope;
- permission/auth/credential changes;
- any action whose scope or target is not confidently classified.

This customization must be tested rather than assumed safe. Property-level constraints matter: “setProperties” is too broad by itself because the same method can modify different fields with different risk.

## Claude Code compatibility finding

Cloudflare OS Gatekeepers are designed as capabilities for the Cloudflare OS Agent and Gadgets. The official `gatekeeper-mcp` works in the direction **MCP server -> Cloudflare OS capability**: it lets Cloudflare OS connect to arbitrary MCP servers and wraps their tools in the Gatekeeper approval model.

No documented drop-in path was found in the inspected official source that exposes Cloudflare Gatekeepers directly as an MCP server for an external Claude Code process.

Therefore these are different questions:

1. **Can Cloudflare OS run the autonomous job safely?** — likely yes; this is what its Agent/Gatekeeper architecture is designed for.
2. **Can the existing Claude Code process keep its current harness and transparently inherit Cloudflare Gatekeeper policy?** — not proven and likely requires an adapter/integration boundary.

This must be included in the adoption decision. A platform that solves approval stalls only after replacing the existing Claude Code harness has a larger migration cost than a drop-in authorization layer.

## Model-cost finding

Cloudflare OS's built-in Agent supports direct model-provider paths including Anthropic/OpenAI/Google/Workers AI and also supports Ollama. The Ollama path defaults to `http://localhost:11434`, has zero model cost metadata, and can operate without an API key.

Therefore the Cloudflare OS runtime/Gatekeeper behavior can be tested without introducing a new metered external AI API **if a suitable local Ollama model is available in the PoC environment**. Using Anthropic through Cloudflare OS would be a provider API path and must not be silently substituted for the existing Claude subscription under ADP's no-new-metered-API rule.

## Runtime attempt in Chris execution environment

Prerequisites observed locally:

- Node.js 22.16.0: available.
- Git 2.47.3: available.
- pnpm: not currently installed.

The official Cloudflare OS quick-start is `pnpm run-local`; its script installs dependencies, builds the required packages, and launches the local stack on wrangler/workerd at `http://localhost:8787`.

The runtime attempt in the current Chris execution container is blocked before install because outbound DNS to `github.com` is unavailable (`Could not resolve host: github.com`). This is an execution-environment network limitation, not a Cloudflare OS failure, and must not be counted as a failed product PoC.

A real runtime PoC must therefore run in an environment with normal package/Git network access.

## Human prerequisite for real Notion test

The real Notion connection requires a Notion Public Integration and its OAuth client credentials. This is an account/secret operation and has been split into Human task:

`HUMAN-ADP-045-B-1｜Cloudflare OS PoC用Notion Public Integrationを作成する`

Secrets must not be stored in Notion or GitHub. The PoC should share only a dedicated test page/database through the OAuth page picker.

## Runtime test to execute next

Use one dedicated Notion test database/page and run the following sequence:

1. Read the task row.
2. Change a reversible Status/Result-like property.
3. Read back the property immediately.
4. Perform a second low-risk update without Human interaction.
5. Queue one intentionally manual-gate action.
6. Verify that the agent continues through simulated state where supported.
7. Approve/reject pending actions and verify the real Notion state.

Record:

- number of manual approvals;
- whether the agent run stops synchronously;
- whether pending state is simulated correctly;
- whether safe actions can be pre-approved after a minimal Notion Gatekeeper customization;
- credential exposure;
- resource scope;
- audit evidence;
- setup/maintenance cost.

## Decision implications so far

### Stronger case for Cloudflare OS

- Credential mediation, resource scoping, action queue, simulation, audit, and Human approval are already implemented.
- The difficult deferred-approval state machinery does not need to be reinvented.
- The generic auto-approval engine already exists.

### Remaining adoption questions

- Can safe Notion task updates be expressed narrowly enough as auto-approvable actions?
- Does ADP move autonomous execution into the Cloudflare OS Agent, or is a Claude Code adapter practical?
- Can the runtime be operated without creating new metered model cost?
- Is the Workers/workerd operational dependency acceptable relative to the saved engineering effort?

## Provisional direction

**Do not build an ADP-native Policy Checker yet.** Complete the Cloudflare OS runtime PoC first. If the Notion auto-approval gap can be solved with a small Gatekeeper customization, reuse Cloudflare OS. Only design a separate ADP enforcement service if the runtime/Claude integration cost proves larger than the functionality being reused.

## Primary implementation sources

- Cloudflare OS README: https://github.com/cloudflare/cloudflare-os/blob/main/README.md
- Notion Gatekeeper README: https://github.com/cloudflare/cloudflare-os/blob/main/packages/gatekeeper-notion/README.md
- Notion Gatekeeper implementation: https://github.com/cloudflare/cloudflare-os/blob/main/packages/gatekeeper-notion/src/notion.ts
- Notion action/simulation implementation: https://github.com/cloudflare/cloudflare-os/blob/main/packages/gatekeeper-notion/src/notion-actions.ts
- Gatekeeper contract: https://github.com/cloudflare/cloudflare-os/blob/main/packages/workshop-shared/src/gatekeeper.ts
- Auto-approval engine: https://github.com/cloudflare/cloudflare-os/blob/main/packages/workshop-backend/src/auto-approval.ts
- MCP Gatekeeper: https://github.com/cloudflare/cloudflare-os/blob/main/packages/gatekeeper-mcp/README.md
- Model routing/Ollama support: https://github.com/cloudflare/cloudflare-os/blob/main/packages/workshop-backend/src/ai-models.ts
