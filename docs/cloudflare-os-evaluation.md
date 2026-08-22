# Cloudflare OS Evaluation for ADP

Date: 2026-08-22 (JST)
Status: **Provisional decision-support report — final adoption decision pending comparative PoC**
Scope: Cloudflare OS as an architecture option for ADP, with emphasis on Gatekeepers, agent authority, sandboxed execution, reusable application patterns, and the recurring Claude→Notion approval-stall problem.

## Executive summary

Cloudflare OS is not a single authorization product. It is an AI productivity environment built around an agent workspace with company context, sandboxed user/agent-created applications called Gadgets, and a capability-based security framework called Gatekeepers.

The current document-level assessment suggests that ADP may only need part of this architecture, especially runtime authorization and policy enforcement. **That assessment is not yet the final adoption decision.**

Before ADP chooses among full Cloudflare OS adoption, Gatekeeper-inspired partial adoption, or an ADP-native Policy Checker, ADP must run a practical comparative PoC using the same autonomy scenario. The primary scenario is the problem already observed in Claude: repeated Notion operations can trigger approval prompts and stop autonomous execution.

The final decision must therefore be based on measured behavior, not architectural preference.

## 1. What Cloudflare OS actually is

Cloudflare describes Cloudflare OS as an AI productivity environment originally built for internal use. It is not a conventional desktop OS. It provides:

1. An agent chat/workspace UI preloaded with company context.
2. Sandboxed application development where agents create small applications called Gadgets.
3. Gatekeepers, a security framework that applies guardrails to agents and Gadgets when they access external systems.

Cloudflare explicitly frames the open-source project as something organizations can copy and customize into their own "Company OS", rather than only a hosted SaaS to consume unchanged.

### OS analogy used by Cloudflare

| Traditional OS concept | Cloudflare OS |
|---|---|
| Kernel | workshop-backend |
| Device driver | Gatekeeper |
| Shell | workshop-frontend |
| Process | Gadget |
| Executable/template | Blueprint |
| User | User |
| ACL/access control | Shared permissions |
| New first-class entity | AI Agent |

The central architectural point is that Cloudflare treats AI agents as neither ordinary users nor unrestricted arbitrary code. Agents receive restricted capabilities and remain accountable to humans.

## 2. Gatekeepers

Gatekeepers are the component most directly relevant to ADP.

A Gatekeeper is placed between an Agent/Gadget and an external resource. According to Cloudflare's official architecture, it can:

- wrap the native service API behind a controlled interface;
- handle authorization such as OAuth;
- narrow access to specific resources;
- log actions for later review;
- provide a human approval point for operations with side effects.

This is more than an instruction file. It is an **enforcement point between the agent and the external system**.

### Simulated approval / deferred commit

A particularly relevant design is the treatment of side-effecting actions. Instead of always blocking the agent synchronously while waiting for a human, a Gatekeeper can simulate an action locally and return the simulated result to the agent. The agent can continue reasoning and queue additional actions while a human later approves or rejects side effects.

This directly targets an autonomy failure mode that ADP experiences today: one write approval can halt an otherwise autonomous task.

### Important distinction

Service credentials and native IAM remain necessary. Gatekeeper is an additional policy/enforcement layer, not a replacement for GitHub, Notion, Cloudflare, or their native authorization systems.

## 3. Gadgets

Gadgets are dynamically-created applications that run in isolated execution environments. Cloudflare OS uses Workers primitives including Durable Objects and Dynamic Workers.

The relevant lesson for ADP is not that every task should become a Gadget. It is that agent-created software can execute in an isolated environment without receiving unrestricted access to company resources.

Current ADP workloads are primarily task orchestration, research, coding, review, documentation, and connected-system operations, so Gadget-style execution is not yet obviously a core requirement.

## 4. Blueprints

Blueprints are reusable Gadget definitions. They capture source code and required bindings while excluding live data and credentials.

A Blueprint contains reusable executable structure, not simply agent instructions. This makes it adjacent to ADP Skills and templates, but not equivalent to them.

- Skill: how an agent should perform work.
- Blueprint: reusable executable application structure plus required bindings.

## 5. Deployment and maturity

Cloudflare OS is open source and can be run locally. Its architecture is strongly aligned with Cloudflare Workers primitives. The documented production path is currently most mature on Cloudflare infrastructure, and the official starter is explicitly early-access software.

A customized deployment can require Cloudflare platform capabilities such as Workers, KV, R2, Browser Rendering and Dynamic Worker Loaders. AI provider usage can add separate cost depending on configuration.

This does not mean Cloudflare OS is too expensive or unsuitable. It means its runtime/platform dependency must be evaluated against the value it provides.

## 6. Current ADP architecture relevant to this decision

ADP already separates systems of record and durable artifacts:

- Notion: operational work state.
- `cloud42-labo/ai-development-platform`: durable architecture, policy, governance and reusable artifacts.
- `cloud42-labo/brain`: organizational memory.

`AGENTS.md` and `governance/ai-execution-constraints.md` already define managed-work pre-flight/post-flight controls and Human/AI authority boundaries.

Therefore ADP does **not** lack governance rules. The important gap is that these rules are not yet enforced through one uniform runtime authorization point before every connected-system side effect.

## 7. Same-axis comparison

| Evaluation axis | Current ADP | Cloudflare OS |
|---|---|---|
| Work/task source of truth | Notion | OS workspace/context; not inherently a Notion replacement |
| Durable design artifacts | GitHub | OS/Gadgets/Blueprints source |
| Organizational memory | Separate `brain` | Company context supplied to agents |
| Agent work instructions | AGENTS / Skills / guides | Agent instructions/context |
| Runtime authorization | Distributed across agent/tool/service controls | Gatekeeper as explicit enforcement layer |
| Credential mediation | Connector/service specific | Gatekeeper-mediated service auth |
| Human approval | Workflow/tool specific | First-class Gatekeeper action approval |
| Approval without stopping reasoning | Not uniformly available | Simulated actions + deferred approval |
| Audit | Notion/GitHub/tool logs | Gatekeeper action logging |
| Sandboxed dynamic apps | Not core today | First-class Gadget model |
| Runtime dependency | Existing heterogeneous tools | Cloudflare Workers stack |
| Maturity risk | Custom/evolving | Cloudflare OS early access |

## 8. Candidate options

### Option A — Adopt Cloudflare OS as the primary ADP runtime/workspace

**Potential benefits**

- Coherent Gatekeeper, Gadget, Blueprint and agent-runtime architecture.
- Capability-security design is built in.
- Deferred approval is directly relevant to autonomous execution.
- Sandboxed agent-created applications are available if ADP grows into that model.

**Potential costs / risks**

- Introduces a new central workspace/runtime model.
- May duplicate or displace existing Notion/GitHub/brain responsibilities.
- Makes Cloudflare Workers primitives central dependencies.
- Cloudflare OS is still early access.

**Current status:** must be tested, not rejected by assumption.

### Option B — Keep ADP systems of record and adopt Gatekeeper-style enforcement selectively

**Potential benefits**

- Targets the immediate authorization gap while preserving Notion, GitHub, Skills and brain.
- Standardizes `allow / require_approval / deny` across agents.
- Can be intentionally smaller than a full Gatekeeper clone.

**Potential costs / risks**

- ADP must implement and maintain a trusted enforcement adapter.
- A policy YAML alone is not security enforcement.
- Credential isolation and deferred action simulation are difficult to reproduce correctly.

**Current status:** plausible candidate, but must be compared against actual Cloudflare OS behavior.

### Option C — Keep current ADP controls only

**Benefits**

- No new component.

**Costs / risks**

- Approval behavior remains tool-dependent.
- Rules remain distributed.
- No common runtime decision/audit model.
- Does not solve synchronous approval stalls consistently.

**Current status:** unlikely to satisfy the autonomy goal unless existing Claude/MCP permission settings alone eliminate the problem.

## 9. Required comparative PoC before final decision

The adoption decision is blocked on a practical comparison.

### Scenario

Use the same representative managed-work sequence in each environment:

1. Read a Notion task/resource.
2. Update a reversible field such as Status or Result.
3. Read back the result.
4. Repeat multiple times in one autonomous run.
5. Include one intentionally approval-worthy action in a safe test context if possible.

### Variant A — Current Claude environment

Measure the baseline approval-stall behavior using current Claude permissions/MCP configuration.

### Variant B — Cloudflare OS / Gatekeeper practical PoC

Run the equivalent sequence through Cloudflare OS Gatekeeper or the closest supported Notion-capable Gatekeeper path.

### Variant C — ADP-native Policy Checker PoC

Run the same logical sequence with a fail-closed runtime decision function:

`decision = evaluate(actor, service, action, resource, environment, task_context)`

Decisions:

- `allow`
- `require_approval`
- `deny`

### Required measurements

For every variant, record:

- number of Human approval prompts;
- whether approval blocks the entire agent run;
- which actions can safely execute without approval;
- credential exposure to the agent;
- resource-scope isolation;
- audit-log availability;
- setup and maintenance complexity;
- additional fixed or metered cost;
- compatibility with existing Notion/GitHub/Skills operations.

### Decision rule

**No final Cloudflare OS adoption decision may be recorded until the comparative PoC is complete or a specific technical blocker makes one variant impossible.** If a variant cannot be run, the blocker must be documented rather than guessed away.

## 10. Provisional architecture hypothesis

Until the PoC is complete, the following is a hypothesis only:

- **Notion** — what work exists, state, priority, decisions and operational evidence.
- **Skills / AGENTS** — how work should be performed.
- **Runtime authorization layer** — whether an action is allowed, requires approval, or is denied in the current context.
- **Service IAM / credentials** — final technical security boundary.

The key question is not whether this separation is sensible. It is **whether Cloudflare OS should provide the runtime authorization layer or ADP should implement a smaller one itself**.

## 11. Correction to the initial ADP policy draft

The current experimental `governance/agent-policy.yaml` uses `default_decision: approve`. This must not be treated as a final authorization model.

A capability-oriented policy should fail closed. Unknown actions should resolve to `deny` or `require_approval`, not automatic permission.

Likewise, a YAML document alone is not a security control. It becomes an enforceable control only when relevant external actions are forced through a trusted evaluator that the acting agent cannot bypass or freely modify.

## 12. Conditions that strengthen the case for full Cloudflare OS

Cloudflare OS becomes more attractive if one or more of the following is demonstrated:

1. It materially reduces approval stalls in the Claude→Notion scenario.
2. Deferred approval keeps agent reasoning/work progressing safely.
3. Credential mediation and per-resource isolation are significantly stronger than the practical ADP-native alternative.
4. ADP begins to need many agent-created sandboxed applications.
5. The number of external service integrations makes custom adapters expensive.
6. Cloudflare OS operational maturity and cost are acceptable for ADP production use.

## 13. Conditions that strengthen the case for ADP-native enforcement

An ADP-native layer becomes more attractive if the PoC shows that:

1. Most approval stalls are actually solved by Claude/MCP permission configuration.
2. Only a small number of reversible Notion/GitHub actions need common policy enforcement.
3. Cloudflare OS introduces materially more platform complexity without corresponding autonomy gains.
4. Existing connectors already provide sufficient credential isolation and resource scoping.
5. Deferred simulation is not required for normal ADP throughput.

## 14. Decision status

**Final decision: pending comparative practical PoC.**

The previous recommendation for selective adoption should be read as an architectural hypothesis, not an approved implementation decision.

The next required milestone is the Cloudflare OS practical PoC focused on the real Claude→Notion approval-stall problem, followed by the same-axis ADP Policy Checker comparison. Only then should ADP choose full adoption, partial adoption, or native implementation.

## Primary sources

- Cloudflare OS official repository and README: https://github.com/cloudflare/cloudflare-os
- Cloudflare OS Blueprints documentation: https://github.com/cloudflare/cloudflare-os/blob/main/docs/blueprints.md
- Cloudflare OS Starter: https://github.com/cloudflare/cloudflare-os-starter
- Cloudflare OS Starter customization guide: https://github.com/cloudflare/cloudflare-os-starter/blob/main/docs/customization.md
- ADP `AGENTS.md`
- ADP `governance/ai-execution-constraints.md`
- ADP `docs/capability-map.md`
