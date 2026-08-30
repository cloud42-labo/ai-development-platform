# PRD: AI Development Platform (ADP)

> Backfilled per `product-design-doc-standard.md` (`ADP-050-A`). Synthesized
> from `README.md`, `AGENTS.md`, `docs/operating-guide.md`,
> `docs/capability-map.md`, and `governance/*` — not new scope invention.
> See `docs/inception-deck.md` for the Why/Elevator Pitch this PRD expands on.

## 1. Target User / Problem

Cloud42 Labo's acting AI agents (Claude, ChatGPT/Chris, Codex, Gemini) and
the human Owner, across every Product repository. Problem: without a
durable, versioned, agent-agnostic place for operating rules, each session
either re-derives governance from scratch (slow, inconsistent) or silently
skips a gate it doesn't know exists (unsafe) — and a lesson learned in one
session doesn't reach the next one running a different Product.

## 2. User Value / Use Cases

- An autonomous daily/hourly execution session can pick a Task, verify it's
  safe to start, do the work, and close it out — without asking a Human
  what "safe to start" or "safe to close" means, because
  `governance/ai-execution-constraints.md` says so explicitly.
- A reviewing AI (Codex) or the Owner can check whether a given action was
  compliant against a single, stable source rather than a scattered set of
  chat instructions.
- A new Product repository can adopt the same Rules/Workflows/Templates
  instead of re-inventing them (`package/README.md`).
- When something goes wrong (a false stop gate, a skipped Human check), the
  Postmortem Improvement Loop turns it into a durable correction rather
  than a one-off apology.

## 3. Functional Requirements

- Define and version four asset classes: Rules, Schemas, Workflows,
  Templates (`docs/v1-asset-inventory.md`, `adp-package.yaml`).
- Provide an executable (not merely descriptive) pre-flight/post-flight gate
  for managed work: placement, execution start, AI-to-AI stop, Human gate,
  Human Queue WIP, completion (`governance/ai-execution-constraints.md`).
- Provide an AI Work Session audit log (who ran, on what Task, with what
  result) separate from Time Events (pure elapsed-time measurement)
  (`ADP-046`, this file's own governance section).
- Provide a Postmortem → preventive-task → retest loop for governance
  defects (`governance/postmortem-improvement-loop.md`).
- Provide a monthly risk review cadence
  (`governance/monthly-risk-management-review.md`).
- Provide a distribution index (`package/`) so an adopting agent/script can
  locate each asset class without reading the whole repository, and an
  environment-specific-value catalogue (`examples/`) separating this
  deployment's concrete values from the generalizable package body.
- Provide a Software Product design-document standard
  (`docs/product-design-doc-standard.md`, `ADP-050`) so individual Products
  have a consistent Vision/Inception Deck/PRD/Design Doc/Epic Brief
  structure, distinct from ADP's own governance of *how* work happens.

## 4. Non-functional Requirements

- **Agent-neutral**: every gate applies identically to Claude and
  Chris/ChatGPT (`AGENTS.md`, `governance/ai-execution-constraints.md`
  §"Human work and PR completion").
- **Public-safe**: the repository is public; no secrets, credentials, or
  private personal data (`README.md`'s Operating principle,
  `governance/research-security-policy.md`).
- **Durable over convenient**: prefer Markdown/Mermaid, diffable and
  reviewable, over any format requiring special tooling to read
  (`AGENTS.md`'s Change rules).
- **Versioned per asset class**, not as one monolith, so an adopter can
  evaluate a Rules change without re-evaluating Templates
  (`docs/versioning-policy.md`).

## 5. Success Metrics

- No un-cited AI-to-AI stop gate reaches a Postmortem (i.e., the gate's own
  precedence rules resolve conflicts before they stall work).
- Autonomous daily/hourly execution completes a Task end-to-end (Task
  exists → In Progress → Time Event → AI Work Session → Done or correctly
  routed) without a Human being asked something the AI could have verified
  itself (`governance/ai-execution-constraints.md`'s Human gate pre-flight).
- AI Work Sessions and Task Time Events are populated by every managed-work
  execution, not just some (`ADP-046`'s completion criterion, now checkable
  via the `⚠ Session Missing Started At` / `⚠ Success Missing Completed At`
  views).
- A Postmortem's preventive task is retested against a representative
  regression case before closure, not merely documented
  (`governance/postmortem-improvement-loop.md`).

## 6. Constraints

- No dedicated GitHub Actions billing spend for AI review/merge loops — use
  Codex Automatic reviews (ChatGPT Plus/Pro) and ChatGPT's own scheduled
  tasks instead (`notes/ai-pr-review-loop` in `cloud42-labo/brain`,
  referenced from this repository's governance).
- No custom package manager or install tooling — `adp-package.yaml` is
  documentary (`adp-package.yaml`'s own header comment).
- Timestamps are recorded in JST (`adp-package.yaml`'s
  `required_capabilities: jst_time_source`).

## 7. Non-goals / Out of Scope

- Not a task tracker (Notion Stories & Tasks is authoritative for
  operational state — `governance/source-of-truth.md`).
- Not organizational memory (`cloud42-labo/brain` is).
- Not a per-Product PRD/Design Doc store (`docs/product-design-doc-standard.md`
  defines the standard; each Product repository holds its own instance).
- Not a live-enforced authorization system yet — `governance/agent-policy.yaml`
  is an explicitly non-authoritative draft
  (`docs/v1-asset-inventory.md`'s Freeze-scope exception).
- Jira integration is not currently in scope: no Jira MCP connector is
  available in this environment as of `ADP-042-D`'s 2026-08-30 finding, and
  `required_capabilities` does not list one; `HUMAN-ADP-042-D-2` tracks the
  Owner decision on whether to keep it in scope going forward.

## 8. Requirement Decisions / Open Questions

- **Decided**: four independently-versioned asset classes rather than one
  package version (`docs/versioning-policy.md`'s "Why one version number is
  not enough").
- **Decided**: `agent-policy.yaml` ships in v1.0.0 labeled non-authoritative
  rather than being dropped or silently frozen as approved
  (`docs/v1-asset-inventory.md`'s Freeze-scope exception).
- **Open**: whether ADP itself needs a single consolidated `design-doc.md`
  (`docs/product-design-doc-standard.md`'s How), given `docs/operating-guide.md`
  and `governance/` already serve as this repository's de facto design
  documentation but under a different structure. Left open by `ADP-050-A`
  rather than forcing a merge that could lose the existing files' own
  internal cross-referencing.
- **Open**: Jira scope (see Non-goals above; tracked in `HUMAN-ADP-042-D-2`).
