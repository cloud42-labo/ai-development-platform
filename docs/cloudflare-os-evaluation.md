# Cloudflare OS Evaluation for ADP

Date: 2026-08-22 (JST)
Status: **Provisional — final adoption decision pending runtime PoC**

## Executive summary

Cloudflare OS is an open-source AI productivity environment built around an Agent workspace, sandboxed applications called Gadgets, reusable Blueprints, and a capability-based security layer called Gatekeepers.

For ADP, the most important immediate question is concrete: **can Cloudflare OS reduce the repeated Human approval stalls that currently interrupt Claude's routine Notion operations without giving the agent unrestricted credentials or permissions?**

The evaluation policy is therefore:

1. **Try Cloudflare OS first.**
2. If the stock implementation is close but incomplete, try the smallest safe customization of its existing Gatekeeper mechanisms.
3. Build an ADP-native authorization service only for gaps that Cloudflare OS demonstrably cannot solve at acceptable cost/complexity.

This avoids rebuilding credential mediation, resource scoping, approval queues, simulated pending writes, audit behavior, and other security machinery that Cloudflare OS already implements.

No final adoption/rejection decision is recorded until the runtime PoC is complete or a specific technical blocker is demonstrated.

## 1. What Cloudflare OS is

Cloudflare describes Cloudflare OS as an AI productivity environment, not a conventional computer operating system. The open-source project provides three main things:

1. An Agent chat/workspace preloaded with company context.
2. Sandboxed application development using personal AI-created applications called Gadgets.
3. Gatekeepers, a capability-based security framework that mediates Agent/Gadget access to external systems.

Cloudflare explicitly presents the project as a base that organizations can copy and customize into their own Company OS.

The official OS analogy is roughly:

| Traditional OS | Cloudflare OS |
|---|---|
| Kernel | `workshop-backend` |
| Device driver | Gatekeeper |
| Shell | `workshop-frontend` |
| Process | Gadget |
| Executable/template | Blueprint |
| User | User |
| Access control | Shared permissions / capabilities |
| New principal | AI Agent |

The key architectural idea is that an Agent is not simply an unrestricted copy of a Human user. It is a separate principal operating under restricted capabilities while remaining accountable to a Human.

## 2. Why Gatekeeper matters to ADP

A Gatekeeper sits between an Agent/Gadget and an external resource. It can:

- wrap the service API behind a controlled interface;
- handle OAuth/credentials;
- narrow access to specific resources;
- authorize and record reads;
- queue and audit side-effecting actions;
- let Humans approve/reject actions;
- where supported, simulate pending actions so the Agent can continue before approval is committed.

This directly addresses ADP's present failure mode:

```text
Claude -> routine Notion write -> approval prompt -> entire autonomous run stops
```

Cloudflare OS is designed to support a different flow:

```text
Agent -> Gatekeeper -> queue write -> simulate result -> Agent continues
                              |
                              +-> Human approves/rejects later
```

The hard security boundary at the underlying service still remains. Gatekeeper complements Notion/GitHub IAM rather than replacing it.

## 3. Official Notion Gatekeeper: implementation findings

Cloudflare OS already contains an official `packages/gatekeeper-notion` implementation. This is materially important: ADP does not need to invent a Notion authorization proxy from scratch merely to test the architecture.

### Authentication and credential isolation

The Notion Gatekeeper uses a Notion OAuth 2.0 public integration. For local development, the root environment provides `NOTION_CLIENT_ID` / `NOTION_CLIENT_SECRET`, which are mapped to the Gatekeeper Worker.

OAuth tokens are stored in a `UserAccount` Durable Object and are refreshed by the Gatekeeper. They are not ordinary text passed into the Agent prompt/context.

The default local redirect is:

`http://localhost:8787/gatekeeper/notion/oauth`

### Resource scoping

The Gatekeeper supports either workspace-level access or a specific Notion page/database binding. Only pages/databases shared through the Notion OAuth page picker are reachable.

This means the PoC can expose a dedicated test database rather than granting broad ambient access to the workspace.

### Reads

Notion reads are authorized through the Gatekeeper observation path before data is returned.

### Writes

Notion writes including page content append, title/property/icon changes, archive/restore, comments, and page creation are staged as pending actions. The real Notion API mutation occurs only when the Gatekeeper's `applyAction()` path executes.

### Simulation

The Notion Gatekeeper has explicit machinery for pending-action storage, provisional page IDs, and overlays that make pending writes visible to later reads. For example, a queued `setProperties` action can be reflected in a subsequent simulated read before the real Notion mutation is approved/applied.

This is the strongest evidence so far that Cloudflare OS can address the **synchronous approval-stall** problem without simply disabling safety checks.

## 4. Important limitation: stock Notion writes are not auto-approved

The current official Notion Gatekeeper does **not** mark routine Notion writes as auto-approvable.

Both item-level and workspace-level Notion Gatekeepers currently return an empty list from `getAutoApprovableActions()`. The current Notion action descriptions define approval text and revert behavior but do not supply an `actionKind` or `autoApprovable` verdict.

Therefore:

- **Cloudflare OS can prevent every pending write from stopping Agent reasoning by simulating it.**
- **Cloudflare OS does not currently mean “routine Notion writes require zero Human approval” out of the box.**

Those are different properties and must not be confused.

## 5. Cloudflare OS already has a generic auto-approval engine

This limitation does not imply ADP should build its own Policy Checker immediately.

Cloudflare OS's shared Gatekeeper contract already defines:

- `actionKind` — a stable type/tag for an action;
- `autoApprovable` — the Gatekeeper author's assertion that a specific action is eligible for automatic application;
- `getAutoApprovableActions()` — which action kinds the resource exposes as pre-approvable.

The Workshop backend already includes an auto-approval drainer. Auto-application requires **both**:

1. the Gatekeeper marks the concrete action `autoApprovable: true`; and
2. the Human has explicitly enabled an auto-approval rule for that action kind.

If either condition is absent, the action remains a manual gate. The drainer also preserves action order and stops at the first manual gate rather than silently applying later actions past it.

Cloudflare OS's MCP Gatekeeper provides an example of conservative classification: a write is auto-approvable only for a vetted endpoint and when server annotations explicitly identify it as non-destructive and idempotent.

### Implication for ADP

The first implementation experiment should be a **small extension of the official Notion Gatekeeper**, not a new authorization platform.

Candidate low-risk action kinds might include a narrowly constrained task-property update. However, `setProperties` cannot simply be declared safe in all cases: the same API can modify many different Notion fields. The PoC must verify whether the action can be classified based on resource + property set, e.g. allowing only ADP operational fields such as Status/Result under a specifically granted database while leaving destructive or broader writes manual.

## 6. Claude Code compatibility is a separate question

Cloudflare OS Gatekeepers are native capabilities for the Cloudflare OS Agent and Gadgets.

Cloudflare OS also includes `gatekeeper-mcp`, but its documented direction is:

```text
external MCP server -> Cloudflare OS Gatekeeper -> Cloudflare OS Agent/Gadget
```

It lets Cloudflare OS consume arbitrary MCP tools and wrap them in its approval/security model.

In the inspected official sources, no documented drop-in route was found that exposes a Cloudflare Gatekeeper as an MCP server directly to an existing external Claude Code process.

Therefore two adoption models must be distinguished:

### Model A — Run autonomous work inside Cloudflare OS

Use the Cloudflare OS Agent and its Gatekeepers directly. This reuses the architecture most completely but changes the Agent harness/runtime.

### Model B — Keep Claude Code as the existing autonomous harness

For Claude Code to inherit Gatekeeper behavior without migration, an adapter/integration boundary may be necessary. That integration cost must be measured before claiming Cloudflare OS solves the current Claude Code permission prompts directly.

This is now one of the main runtime PoC questions.

## 7. Model cost and no-new-metered-API constraint

Cloudflare OS supports several model routes, including Anthropic, OpenAI, Google, Workers AI, and Ollama.

The Ollama direct path defaults to a local server (`http://localhost:11434`) and is represented with zero model cost. Therefore the Cloudflare OS Agent/Gatekeeper behavior can be exercised without introducing a new metered external AI API if a suitable local Ollama model is available in the PoC environment.

Using Anthropic directly through Cloudflare OS is a provider API path. It must **not** be silently substituted for the existing Claude subscription because ADP explicitly disallows introducing a new metered external AI API merely to run this PoC.

## 8. Current ADP architecture

ADP already separates responsibilities:

- **Notion** — operational work state, task state, decisions and evidence.
- **`cloud42-labo/ai-development-platform`** — durable architecture, governance and reusable artifacts.
- **`cloud42-labo/brain`** — organizational memory.
- **Skills / AGENTS / guides** — how Agents should perform work.
- **Native service permissions** — final access boundaries at Notion/GitHub/etc.

ADP also already has managed-work pre-flight/post-flight governance in `governance/ai-execution-constraints.md`.

The missing capability is not “write more rules.” The gap is a trusted runtime enforcement mechanism that can apply authority decisions consistently without making every safe action block synchronously.

## 9. Adoption options

### Option A — Use Cloudflare OS / Gatekeepers with minimal customization

Potential strengths:

- reuses credential mediation;
- reuses resource scoping;
- reuses audit/approval queue;
- reuses pending-write simulation;
- reuses generic auto-approval infrastructure;
- avoids recreating difficult deferred-approval semantics.

Open questions:

- exact Notion action classification needed for safe pre-approval;
- whether existing Claude Code can use it without changing harness;
- operational fit of Workers/workerd;
- practical setup/maintenance cost.

**This is the option to test first.**

### Option B — Use Cloudflare OS Agent as the autonomous execution runtime

Potential strength: maximizes reuse and obtains Gatekeeper semantics natively.

Cost: may require moving some autonomous Claude workloads from the current Claude Code harness into Cloudflare OS's Agent model and model-routing approach.

This is viable only if the runtime and model-cost constraints fit ADP.

### Option C — ADP-native authorization service

This remains possible but is now explicitly the fallback.

It would be justified only if the Cloudflare OS PoC demonstrates a material gap such as:

- Gatekeepers cannot be integrated with the required Claude workflow;
- resource/action rules cannot be expressed safely;
- operating the Cloudflare runtime is materially more expensive/complex than the reused capability warrants;
- a required ADP behavior is structurally incompatible with the Gatekeeper model.

“ADP could build it” is not sufficient justification. The engineering cost of recreating proven security/control machinery must count against this option.

## 10. Runtime PoC plan

The target scenario is deliberately narrow and mirrors the real problem.

Use a dedicated Notion test page/database and execute:

1. Read an ADP-task-like row.
2. Update a reversible Status/Result-like field.
3. Read the result immediately.
4. Perform multiple low-risk writes in one autonomous run.
5. Include one intentionally approval-worthy action in a safe test context.
6. Observe whether the Agent continues against simulated pending state.
7. Approve/reject queued writes and compare simulated vs real Notion state.

Measure:

- Human approval count;
- synchronous Agent stops;
- which safe actions can be pre-approved;
- Credential exposure;
- resource scope;
- audit evidence;
- setup/maintenance effort;
- fixed/metered cost;
- compatibility with current Claude Code / Notion / Skills.

### Runtime prerequisite

A real Notion test requires a Notion Public Integration. This account/secret work is tracked separately as:

`HUMAN-ADP-045-B-1｜Cloudflare OS PoC用Notion Public Integrationを作成する`

Secrets must remain in the execution environment and must not be committed to GitHub or written into Notion.

## 11. Runtime attempt status

The Chris execution environment has Node.js 22 and Git, but not pnpm. A source checkout attempt was blocked because the container could not resolve `github.com` over DNS. This prevents dependency installation and `pnpm run-local` in this specific environment.

This is an execution-environment network restriction, not a Cloudflare OS product failure. It must not be scored as a failed product PoC.

The full runtime test must run in an environment with ordinary Git/npm network access and the Notion OAuth integration configured.

Detailed current findings are recorded in:

`docs/cloudflare-os-notion-gatekeeper-poc.md`

## 12. Decision rule

The final adoption decision follows this order:

1. **Stock Cloudflare OS/Gatekeeper runtime PoC.**
2. **Minimal Cloudflare OS customization**, especially conservative pre-approval of selected Notion actions.
3. **ADP-native implementation only for demonstrated gaps.**

If Cloudflare OS satisfies ADP's autonomy and security requirements at reasonable operating cost, ADP should reuse it rather than rebuild equivalent machinery.

## 13. Current decision status

**Final decision: pending runtime PoC.**

Confirmed so far:

- Cloudflare OS has a real Notion Gatekeeper, not merely an architectural concept.
- It implements OAuth credential mediation and resource scoping.
- It stages side effects through an approval queue.
- It simulates pending Notion writes so later reads can reflect them.
- Its platform already contains generic opt-in auto-approval machinery.
- Stock Notion writes are not auto-approvable today.
- Existing Claude Code integration is not yet proven to be drop-in.

Accordingly, **do not start an ADP-native Policy Checker implementation before the Cloudflare OS runtime PoC answers the remaining questions.**

## Primary sources

- Cloudflare OS repository / README: https://github.com/cloudflare/cloudflare-os
- Notion Gatekeeper README: https://github.com/cloudflare/cloudflare-os/blob/main/packages/gatekeeper-notion/README.md
- Notion Gatekeeper implementation: https://github.com/cloudflare/cloudflare-os/blob/main/packages/gatekeeper-notion/src/notion.ts
- Notion action/simulation implementation: https://github.com/cloudflare/cloudflare-os/blob/main/packages/gatekeeper-notion/src/notion-actions.ts
- Gatekeeper contract: https://github.com/cloudflare/cloudflare-os/blob/main/packages/workshop-shared/src/gatekeeper.ts
- Auto-approval engine: https://github.com/cloudflare/cloudflare-os/blob/main/packages/workshop-backend/src/auto-approval.ts
- MCP Gatekeeper: https://github.com/cloudflare/cloudflare-os/blob/main/packages/gatekeeper-mcp/README.md
- Model routing/Ollama support: https://github.com/cloudflare/cloudflare-os/blob/main/packages/workshop-backend/src/ai-models.ts
- ADP `AGENTS.md`
- ADP `governance/ai-execution-constraints.md`
- ADP `docs/capability-map.md`
