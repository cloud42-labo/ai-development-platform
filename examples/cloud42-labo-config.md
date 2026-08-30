# Example configuration: `cloud42-labo`

> **Artifact status:** durable reference. Produced for `ADP-049-C`, cataloguing
> the environment-specific values embedded in this repository's live Rules,
> Workflows, and Schemas so an adopting organization knows what to
> substitute. See `../package/README.md` for why these values stay in place
> in the canonical files rather than being stripped out.

This repository is not only a distributable package — it is also the **live
operating repository for Cloud42 Labo**, read today by Claude's and Chris's
daily autonomous execution and by every product repository's `CLAUDE.md`
(`brain/notes/attach-brain-every-session.md`). Its Rules and Workflows
therefore name Cloud42 Labo's actual Notion workspace, GitHub organization,
and AI role assignments, not placeholders. This file is the single place
that names those concrete values, so an adopting organization can find and
replace all of them without reading the whole repository, and so the
`package/*.md` indices can stay generic.

## Notion workspace

| Value | Where it's used |
|---|---|
| `Vibe Product Development` root page (`https://app.notion.com/p/3affbd826f3b819d84ebe3015c6f946b`) | `README.md`'s source-of-truth table |
| `Notion Operating Guide` page (`https://app.notion.com/p/3bdfbd826f3b8119b7b4e623c9cdc94e`) | `README.md`'s "Start here" links |
| `Stories & Tasks` data source (`fc5e770f-c68e-4799-afe7-ec4bff0dab59`) | Not hardcoded in this repo's own files — passed in per session by the org's job-scheduling config (see the ADP daily-run job prompt registered outside this repository) |

An adopting organization substitutes its own Notion workspace, its own
top-level operating page, and its own Stories & Tasks data source ID.

## GitHub organization and repositories

| Value | Where it's used |
|---|---|
| `cloud42-labo` org name | Throughout `governance/`, `docs/`, `README.md`, `AGENTS.md` |
| `cloud42-labo/ai-development-platform` (this repo) | `docs/cloudflare-os-evaluation.md`, `governance/source-of-truth.md` |
| `cloud42-labo/brain` | `README.md`, `AGENTS.md`, `decisions/0001-knowledge-asset-model.md`, `docs/cloudflare-os-evaluation.md`, `governance/source-of-truth.md` |
| `cloud42-labo/skills` | `docs/v1-asset-inventory.md` |
| `cloud42-labo/experimental` | `governance/ai-execution-constraints.md` §"AI-to-AI stop gate" self-merge exception, `governance/authority-stop-gate-regression-cases.md` Case 1 |

An adopting organization substitutes its own GitHub org and the equivalent
of its own "ADP repo" / "brain repo" / "skills repo" / any repo-specific
self-merge exception it chooses to carry over.

## Named AI roles

| Role name in this repo | What it denotes generically |
|---|---|
| Claude | The primary coding/execution AI agent |
| ChatGPT / Chris | The PM-aide / cross-product-review / merge-judgment AI agent (see `docs/operating-guide.md` §"Roles") |
| Codex | The independent PR-review AI agent |
| Gemini | The Owner's planning/research second-opinion AI agent |
| Owner (駒場さん in `brain`, not named in this repo) | The human accountable for the organization |

These names appear throughout `docs/operating-guide.md`, `governance/postmortem-improvement-loop.md`,
`governance/monthly-risk-management-review.md`, `governance/ai-execution-constraints.md`,
and `governance/authority-stop-gate-regression-cases.md`. An adopting
organization substitutes whichever AI agents and human owner it actually
uses in each role; the roles themselves (execution agent / PM-aide-and-merge
agent / independent reviewer / research second opinion / accountable human)
are the generalizable part, per `docs/operating-guide.md` §"Roles".

## Not found

No secrets, credentials, API keys, or tokens are embedded anywhere in this
repository (confirmed by `docs/v1-asset-inventory.md`'s hygiene findings,
re-checked for this task — no new matches). Nothing in this file should ever
need to include one.
