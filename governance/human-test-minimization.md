# Human Test Minimization Rule

## Purpose

Human work is a high-cost exception path. Human Requests and Human E2E checks must contain only validation that cannot be completed reliably by automated tests, connected AI agents, or existing objective evidence.

## Mandatory preflight classification

Before creating or starting any Human Request or Human E2E task, classify every verification item as one of:

1. **Automatable** — implement or execute it as an automated test/CI check.
2. **AI/connector-verifiable** — verify it directly through available connected sources such as Notion, GitHub, CI, dashboards, logs, or existing records.
3. **Human-only** — requires human authority, access, perception, identity, legal/financial responsibility, physical-device operation, or real-world observation that the AI cannot perform.

Only category 3 may remain in a Human Request.

## Testing allocation

The following are automated by default and must not be delegated to a Human merely for coverage:

- state-transition matrices;
- boundary values and negative paths;
- idempotency and replay behavior;
- reopen/retry behavior;
- Done/closure gates;
- reassignment and ownership transitions;
- regression cases that can be represented deterministically in code or fixtures.

Human Acceptance is limited to the smallest representative happy path plus the Human-only input/output that cannot be automated.

## Human-task preflight agreement

Before changing a Human task to `In Progress`, present and confirm all of the following with the Human:

- purpose of the check;
- exact operations the Human will perform;
- work the AI will perform before/after the Human step;
- expected duration or bounded effort;
- explicit finish condition and evidence to record.

Do not begin the Human step before agreement. If the procedure changes after work starts, stop and obtain agreement on the added/changed steps before continuing.

## More than three Human test items

If a Human Request contains more than three test items, re-run the automation review before handing it off. The task must be marked `Revise` or `Blocked` until the author records why each remaining item is genuinely Human-only.

## Completion rule

A Human Request is complete when the Human-only evidence is recorded. AI-verifiable follow-up work remains assigned to AI and must not keep the Human task open.

## Relationship to existing governance

This rule narrows the Human Gate Pre-check in `docs/operating-guide.md` and `governance/ai-execution-constraints.md`: classify each criterion first, automate deterministic coverage, and reserve Human work for the irreducible remainder. It does not override authority, merge, release, billing, legal, or real-device gates that are genuinely mandatory for the current transition.
