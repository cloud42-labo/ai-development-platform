# Upstream Change Review Policy

> This file is an implementation staging artifact for ADP-057. The durable policy is referenced from `docs/operating-guide.md`.

## Purpose

Before weekly internal Review / Refinement, verify whether the external platforms ADP depends on have changed in ways that invalidate current assumptions.

## Source of Truth

- Official primary documentation, release notes, changelogs, migration guidance and deprecation notices are authoritative.
- X, blogs, summaries and third-party Skill pages are discovery sources only.
- Do not change ADP policy, Skills or Backlog from a discovery source until the relevant official source is confirmed.

## Weekly order

The Weekly Sprint management loop starts with `upstream-change-review`, then continues with Sprint Review, Retrospective, Backlog Refinement, Sprint Close, Sprint Goal Review and Sprint Planning.

`upstream-change-review` must pass confirmed external-change signals and Instruction / Skill Debt signals into subsequent Review / Refinement. No-material-change weeks must not create new rules or Tasks merely to prove the review ran.

## Scope

At minimum, when actively used by ADP, review official upstream information from OpenAI, Anthropic and Google Gemini, plus any external SDK/API/service directly required by the coming Sprint.

Classify confirmed changes as Model, Agent, Skill, Prompt-Instruction, API-SDK, Deprecation, Cost-Limit or Safety-Permission, then as No Impact, Watch, Refinement Input or Immediate Action.

Only changes that alter an ADP assumption, dependency, safety boundary or execution approach should become Refinement inputs or Tasks.
