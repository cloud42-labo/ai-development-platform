# Vibe Product Development — Operating Guide

> **Compatibility entry point only.** This file is no longer the authoritative source for detailed operating rules.
> Formal rules have been migrated to the regulation system under [`docs/regulations/`](regulations/).

## 1. Where to look

| Information class | Authoritative source | Purpose |
|---|---|---|
| Regulations | [`docs/regulations/README.md`](regulations/README.md) and R01–R06 | Formal organizational rules that Human/AI actors must follow |
| Criteria / guardrails | [`governance/`](../governance/) | Decision criteria, execution constraints, source-of-truth rules, regression cases and control checks |
| Procedures | [`cloud42-labo/skills`](https://github.com/cloud42-labo/skills) | Reusable executable procedures such as Approach Review, Sprint operation and Human Gate preflight |
| Operational records | Notion | Product/Epic/Story/Task/Sprint state, timestamps, Result, Decisions, Daily Reports and Human Requests |
| Code / specifications / PR history | GitHub repositories | Versioned implementation, durable technical artifacts and review history |
| Organizational memory / accumulated learning | [`cloud42-labo/brain`](https://github.com/cloud42-labo/brain) | Notes, learning and synthesized organizational memory |

The classification is intentional: **regulations = rules, governance = criteria, Skills = procedures, Notion/GitHub/brain = records or durable evidence according to their role.** Do not duplicate a rule into this guide when its authoritative regulation, criterion or Skill already exists.

## 2. Regulation index

Use [`docs/regulations/README.md`](regulations/README.md) as the primary entry point.

- [R01 — Organization Regulation](regulations/R01-organization-regulation.md)
- [R02 — Authority Regulation](regulations/R02-authority-regulation.md)
- [R03 — Approval Regulation](regulations/R03-approval-regulation.md)
- [R04 — Document Management Regulation](regulations/R04-document-management-regulation.md)
- [R05 — System Development Management Regulation](regulations/R05-system-development-management-regulation.md)
- [R06 — Project Management Regulation](regulations/R06-project-management-regulation.md)

When this compatibility guide conflicts with a regulation, the regulation governs.

## 3. Criteria and execution constraints

The `governance/` directory contains criteria and guardrails rather than duplicate operating procedures. Start with:

- [`governance/ai-execution-constraints.md`](../governance/ai-execution-constraints.md)
- [`governance/source-of-truth.md`](../governance/source-of-truth.md)
- relevant regression-case or review criteria under [`governance/`](../governance/)

If a criterion has an executable Skill, use the Skill for the procedure and the governance document for the decision condition.

## 4. Operational system of record

Notion remains the operational system of record for live planning and execution state. In particular, Stories & Tasks holds assignment, status, Acceptance Criteria, Approach Review/Decision, Blocker, Result, Started At and Completed At.

GitHub remains the authoritative source for repository content, commits, pull requests, reviews and durable versioned artifacts. `cloud42-labo/brain` remains the organizational-memory store for accumulated learning that has not been promoted into a formal regulation, criterion, Skill or durable repository artifact.

## 5. Legacy compatibility

Existing links to `docs/operating-guide.md` may continue to resolve here during migration. New rules or procedures must not be added to this file. Update the appropriate regulation, governance criterion or Skill instead, and record execution state in Notion/GitHub/brain as defined above.
