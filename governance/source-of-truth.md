# Source-of-Truth Policy

## Purpose

ADP separates **operational state**, **durable artifacts**, and **organizational memory** so humans and AI agents can find the authoritative source without duplicating or drifting information.

## Authority model

| Information class | Authoritative system | Examples |
|---|---|---|
| Operational state and work record | Notion | Product, Epic, Story, Task, Sprint, priority, status, timestamps, result, blockers, approvals, Decisions |
| Durable artifact / intellectual asset | `cloud42-labo/ai-development-platform` | Operating Guide, policies, standards, guardrails, capability maps, architecture, diagrams, templates |
| Product code and product-specific technical artifacts | Product GitHub repository | Source code, tests, CI, implementation specs, releases, PR history |
| Organizational memory | `cloud42-labo/brain` | Lessons, accumulated context, design rationale, historical learning |

## Rules

6. **Procedures do not create policy.** A Skill, scheduler registry, automation prompt, Notion task, or controlled view may implement or display an operating constraint only when that constraint is grounded in an authoritative regulation/governance source, repository-local authority, or explicit Owner instruction. AI-authored suggestions do not become binding rules merely because they are copied into code, configuration, or Notion.
7. **Constraint changes flow downward, while current Owner instructions apply immediately.** The Owner's latest explicit instruction for the exact matter is authoritative immediately and MUST be followed even before all controlled copies are synchronized. The acting AI then updates the durable ADP regulation/governance layer, implements the rule in Skills/configuration/automation, and reflects it in Notion operational views in the same change chain. AI-authored Notion text or implementation alone is never the origin of a new binding operating rule, and an older durable artifact may not override a newer explicit Owner instruction merely because synchronization is still in progress.
1. **Link, do not duplicate by default.** When a GitHub artifact is authoritative, Notion should hold status, decision context, and a link to the artifact rather than an uncontrolled copy.
2. **Operational status lives in Notion.** Do not infer current task or sprint status from Git history.
3. **Artifacts live in GitHub.** Durable documents must be versionable and diffable.
4. **Memory is not an artifact.** Raw learning, context, and historical rationale belong in `brain` until intentionally synthesized into a governed artifact.
5. **Public-repository safety applies.** This repository must contain only material intentionally suitable for public disclosure.

## Mental model

**State = Notion**  
**Artifact = GitHub**  
**Memory = brain**

These three layers together support the ADP Organization Digital Twin.
