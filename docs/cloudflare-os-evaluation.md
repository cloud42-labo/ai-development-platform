# Cloudflare OS Evaluation for ADP

Date: 2026-08-22 (JST)
Status: Decision-support report
Scope: Cloudflare OS as an architecture option for ADP, with emphasis on Gatekeepers, agent authority, sandboxed execution, and reusable application patterns.

## Executive summary

Cloudflare OS is not a single authorization product. It is an AI productivity environment built around three major ideas: an agent workspace with company context, sandboxed user/agent-created applications called Gadgets, and a capability-based security framework called Gatekeepers.

For the current ADP, the recommended decision is **selective adoption of the security architecture pattern, not full migration to Cloudflare OS at this stage**.

The reason is not that Cloudflare OS is inferior. The reason is scope fit. ADP already has operational state in Notion, durable artifacts in GitHub, organizational memory in `brain`, agent-specific work instructions, and execution/completion gates. Replacing that environment with Cloudflare OS would introduce a new workspace/runtime/application model in order to obtain capabilities that ADP currently needs mainly in one area: **runtime authorization and policy enforcement for agent actions**.

However, this conclusion is conditional. If ADP evolves toward large numbers of agents and users dynamically creating isolated applications and accessing many external systems, Cloudflare OS itself should be re-evaluated. Its Gadget + Gatekeeper architecture is designed for exactly that operating model.

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

The central architectural point is that Cloudflare treats AI agents as neither ordinary users nor untrusted arbitrary code. Agents are accountable to a human while receiving their own restricted capabilities.

## 2. Gatekeepers

Gatekeepers are the most directly relevant component for ADP.

A Gatekeeper is created when an Agent or Gadget is connected to an external resource. According to Cloudflare's official architecture, a Gatekeeper:

- wraps the native service API behind a clean API;
- handles authorization such as OAuth;
- narrows access to the specific resource intended by the user;
- logs actions for later review;
- provides a human approval point for operations with side effects.

This is more than an instruction file. It is an **enforcement point placed between the agent and the external system**.

### Simulated approval / deferred commit

A particularly important design is the treatment of side-effecting actions. Instead of always blocking the agent synchronously while waiting for a human, the Gatekeeper can simulate an action locally and return the simulated result to the agent. The agent can continue reasoning and queue additional actions. A human can later approve or reject queued side effects.

This addresses a common failure mode of agent automation: synchronous approval on the first write causes the whole job to stop, while disabling approvals entirely is unsafe.

### Important distinction

Service credentials and native IAM remain necessary. Gatekeeper is an additional policy/enforcement layer, not a replacement for GitHub, Notion, Cloudflare, or their native authorization systems.

## 3. Gadgets

Gadgets are dynamically-created applications that run in isolated execution environments. Cloudflare OS uses Workers primitives such as Durable Objects, Dynamic Workers, and Facets. A workspace is backed by its own Durable Object and Gadgets execute as isolated dynamic workers/facets.

The important design implication for ADP is not that every task needs a Gadget. Rather, Gadgets show a model in which agents can create and execute custom software without receiving unrestricted access to the host environment or all company resources.

Current ADP does not yet require this as a core capability. Its primary workloads are task orchestration, research, coding, review, documentation, and connected-system operations using existing tools.

## 4. Blueprints

Blueprints are reusable Gadget definitions. They capture source code and binding requirements, but deliberately exclude live data and credentials.

A Blueprint includes:

- source code;
- required connection/binding shapes;
- metadata.

It does not include:

- SQLite contents;
- chat/edit history;
- live connections or credentials.

Each new Gadget created from a Blueprint receives independent state and bindings.

For ADP, this is conceptually adjacent to reusable Skills and templates, but they are not equivalent. A Skill primarily defines how an agent performs work. A Blueprint defines a reusable executable application plus its required capability bindings.

## 5. Deployment and maturity

Cloudflare OS is open source and can be run locally. Its architecture is deeply built around Workers, Durable Objects, Dynamic Workers and Facets.

The official project states that it can conceptually run on open-source `workerd`, but production deployment to one's own server using workerd is still marked as coming soon. The supported production path is therefore currently most mature on Cloudflare infrastructure.

The official starter also labels Cloudflare OS as early-access software and recommends pinning releases, reviewing changes, and re-verifying the trust boundary before production upgrades.

A customized deployment requires Cloudflare platform capabilities including Workers, KV, R2, Browser Rendering, and Dynamic Worker Loaders. AI products are optional, but model usage can introduce separate cost depending on provider and configuration.

This does not imply Cloudflare OS is prohibitively expensive; it means adoption creates a new runtime/platform dependency that must be justified by value.

## 6. Current ADP architecture relevant to this decision

ADP currently separates its systems of record:

- Notion: operational work state.
- `cloud42-labo/ai-development-platform`: durable architecture, policy, governance and reusable artifacts.
- `cloud42-labo/brain`: organizational memory.

`AGENTS.md` already requires all managed work to execute pre-flight and post-flight controls. Existing `governance/ai-execution-constraints.md` requires, among other things:

- an exact task must exist;
- the task must be executable;
- execution state/time tracking must be opened before substantive work;
- actor authority must be checked;
- acceptance criteria and evidence must be verified before Done;
- Human/AI authority boundaries must be respected.

The ADP capability map already explicitly identifies Governance capabilities including Security, Guardrails, Human-on-the-Loop controls, Internal controls, and Decision records.

Therefore, ADP does **not** lack governance rules. The current gap is that many of those rules are documented/pre-flight controls rather than one uniform runtime policy-enforcement layer placed in front of all external actions.

## 7. Same-axis comparison

| Evaluation axis | Current ADP | Cloudflare OS |
|---|---|---|
| Work/task source of truth | Notion | Cloudflare OS workspace/context; not a Notion replacement by design |
| Durable design artifacts | GitHub | Application/runtime source within OS deployment/Gadgets/Blueprints |
| Organizational memory | Separate `brain` repository | Company context supplied to Agents |
| Agent work instructions | AGENTS / Skills / guides | Agent instructions/context |
| Runtime authorization | Distributed across agent/tool/service controls; documented execution constraints | Gatekeeper as explicit capability enforcement layer |
| Credential mediation | Connector/service specific | Gatekeeper owns service-specific auth mediation |
| Human approval | Workflow/tool-specific | First-class Gatekeeper action approval |
| Approval without stopping reasoning | Not uniformly available | Simulated actions + deferred approval |
| Audit | Notion/GitHub/tool logs and process evidence | Gatekeeper action logging |
| Sandboxed dynamic apps | Not a core ADP capability | First-class Gadget model |
| Reusable executable apps | Skills/templates are procedural | Blueprints package executable Gadget code + binding requirements |
| Runtime dependency | Existing heterogeneous tools | Strongly aligned with Cloudflare Workers stack |
| Current maturity risk | ADP is custom and evolving | Cloudflare OS itself is early access |

## 8. Options

### Option A — Adopt Cloudflare OS as the primary ADP runtime/workspace now

**Benefits**

- Gets Gatekeeper, Gadget, Blueprint and agent-runtime architecture as one coherent system.
- Strong capability-security design from the outset.
- Simulated side effects/deferred approval solve an important autonomy problem elegantly.
- Reduces the need to invent a sandboxed app runtime later.

**Costs / risks**

- Requires ADP to adopt a new central workspace/runtime model rather than only solving the authorization gap.
- Duplicates or displaces parts of the existing Notion/GitHub/brain operating model.
- Introduces Cloudflare Workers primitives and operations as central architecture dependencies.
- Cloudflare OS is currently early access.
- Production self-hosting on standalone workerd is not yet the mature documented path.

**Assessment:** strategically interesting, but too broad for the present need.

### Option B — Adopt the Gatekeeper architecture pattern in ADP, keep current systems of record

**Benefits**

- Solves the immediate gap: uniform agent authority decisions before connected-system side effects.
- Preserves Notion, GitHub, Skills and brain responsibilities.
- Can standardize decisions such as `allow`, `require_approval`, and `deny` across agents.
- Creates a migration path toward stronger enforcement without moving all work into a new platform.

**Costs / risks**

- ADP must implement and maintain a policy checker/enforcement adapter.
- A naive YAML policy is not equivalent to Cloudflare Gatekeeper security.
- Deferred action simulation is non-trivial and should not be reimplemented casually.
- Credential isolation remains connector/service-specific unless a true proxy layer is added.

**Assessment:** best fit now, provided the implementation is deliberately smaller than a Gatekeeper clone.

### Option C — Keep current ADP controls only

**Benefits**

- No new component.
- Current governance already captures many authority boundaries.

**Costs / risks**

- Rules remain distributed across guides, Skills, tool permissions and service IAM.
- Agents can still encounter inconsistent approval behavior across tools.
- No common policy decision/audit model.
- No general solution to synchronous approval stalls.

**Assessment:** insufficient for the stated autonomy goal.

## 9. Recommended architecture

Recommendation: **Option B, with a deliberately narrow first phase.**

The target responsibility split should be:

- **Notion** — what work exists, state, priority, decisions and operational evidence.
- **Skills / AGENTS** — how work should be performed.
- **Agent Policy** — whether a requested action is allowed, needs human approval, or is denied in the current context.
- **Service IAM / credentials** — final hard security boundary on what is technically possible.
- **Future enforcement adapter** — executes the Agent Policy decision immediately before external side effects and records the decision.

This is analogous to a human organization's separation between procedure manuals and delegated-authority rules.

### Phase 1

Implement only a policy decision function with fail-closed defaults:

`decision = evaluate(actor, service, action, resource, environment, task_context)`

Possible decisions:

- `allow`
- `require_approval`
- `deny`

The default must be `deny` or `require_approval`, not automatic approval.

### Phase 2

Add service adapters for the highest-value operations, beginning with GitHub and Notion. Record every decision and side effect.

### Phase 3

Evaluate whether a proper Gatekeeper-style proxy is warranted for credential isolation, resource-scoped capabilities, centralized audit, and deferred approval.

### Explicit non-goal

Do not attempt to reproduce Cloudflare OS's simulated side-effect engine in Phase 1. That feature depends on modeling service state and action semantics correctly. It should either be adopted from a proven Gatekeeper implementation or implemented only after a narrow PoC demonstrates the need.

## 10. Correction to the initial ADP policy draft

The current experimental `governance/agent-policy.yaml` uses `default_decision: approve`. This is not recommended as the durable authorization model.

A capability-oriented policy should fail closed. Unknown actions must not become authorized merely because no rule matched. The draft should therefore be treated as an experiment, not the approved policy, until changed to a fail-closed default and backed by an enforcement point.

Likewise, a YAML document alone is not a security control. It becomes a control only when all relevant external actions are forced through a trusted evaluator that the acting agent cannot bypass or modify.

## 11. Decision criteria for re-evaluating full Cloudflare OS adoption

Re-open Option A if one or more of the following becomes true:

1. ADP needs many users to generate and share custom AI-built applications.
2. Agent sandboxing becomes a recurring infrastructure problem rather than an occasional need.
3. The number of external service integrations makes maintaining custom policy adapters expensive.
4. Deferred approvals/action simulation become critical to daily throughput.
5. Credential mediation and per-resource capability isolation cannot be reliably achieved with existing connectors.
6. Cloudflare OS leaves early access and its operational model is acceptable for ADP's production requirements.

## 12. Final decision

**Decision for the current stage:** retain the current ADP systems of record and adopt a Gatekeeper-inspired runtime authorization layer incrementally.

**Do not claim:** that ADP has implemented Cloudflare Gatekeeper merely because it has a policy file.

**Do claim:** Cloudflare OS provides a credible reference architecture showing how AI agents can be treated as first-class principals with restricted capabilities, audited service access, human approval for side effects, and sandboxed application execution.

The next implementation milestone should therefore be a small, fail-closed Policy Checker PoC. Its purpose is to validate the separation of work instructions from execution authority. It is not to recreate Cloudflare OS.

## Primary sources

- Cloudflare OS official repository and README: https://github.com/cloudflare/cloudflare-os
- Cloudflare OS Blueprints documentation: https://github.com/cloudflare/cloudflare-os/blob/main/docs/blueprints.md
- Cloudflare OS Starter: https://github.com/cloudflare/cloudflare-os-starter
- Cloudflare OS Starter customization guide: https://github.com/cloudflare/cloudflare-os-starter/blob/main/docs/customization.md
- ADP `AGENTS.md`
- ADP `governance/ai-execution-constraints.md`
- ADP `docs/capability-map.md`
