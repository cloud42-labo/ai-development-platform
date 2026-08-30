# Inception Deck: AI Development Platform (ADP)

> Backfilled per `product-design-doc-standard.md` (`ADP-050-A`). This
> repository grew organically rather than through the standard Product-start
> flow; this deck reconstructs it from `README.md`, `docs/operating-guide.md`,
> and `docs/capability-map.md` rather than inventing new intent.

## Why

Cloud42 Labo runs product development with AI agents (Claude, ChatGPT/Chris,
Codex, Gemini) doing most of the execution. Without a durable, versioned
place for how those agents are supposed to work together, every session
re-derives — or silently reinvents — the operating rules, and a lesson
learned in one session is lost the moment that session ends. ADP exists so
those rules, gates, and reusable artifacts persist and are the same for
every agent and every product.

## Elevator Pitch

For Cloud42 Labo's AI agents building software products, ADP is the
operating system and system of record for durable governance — unlike
conversational instructions that live only in one session, ADP's Rules,
Workflows, Schemas, and Templates persist, are versioned, and apply
identically to Claude and Chris/ChatGPT alike.

## Product Box

*"ADP: the organization's memory for how work gets done, not what got
done."* Governance rules that don't need re-explaining every session.
Gates that catch a stalled or unauthorized action before it happens.
A capability map that shows what this AI-native organization can already
do. Reusable templates so the next Product doesn't start from a blank page.

## NOT List

- Not a task tracker — Notion Stories & Tasks is the operational system of
  record (`governance/source-of-truth.md`).
- Not organizational memory / lessons-learned — `cloud42-labo/brain` is.
- Not a per-Product PRD/Design Doc store — those live in each Product's own
  repository (`docs/product-design-doc-standard.md`); ADP defines the
  standard, it doesn't hold every Product's instance of it.
- Not a build tool or package manager — `adp-package.yaml` is a
  hand-maintained, documentary manifest, not something installed by a CLI.
- Not a policy enforcement point (yet) — `governance/agent-policy.yaml` is
  an explicitly non-authoritative draft (`docs/v1-asset-inventory.md`'s
  Freeze-scope exception); nothing currently executes it as a control.

## Stakeholders

| Stakeholder | What they need from ADP |
|---|---|
| Claude (daily/hourly autonomous execution) | Unambiguous gates it can execute without asking — placement, execution pre-flight, Human gate, completion post-flight |
| ChatGPT / Chris | The same gates, applied identically (`AGENTS.md`: "mandatory for Chris/ChatGPT and Claude alike") |
| Codex | A stable place to find what "compliant" means when reviewing a PR |
| Owner (Cloud42 Labo) | Confidence that AI-native execution has real guardrails, not just good intentions in a chat transcript |
| Every product repository | A durable Rules/Workflows/Templates package to adopt (`package/README.md`), rather than reinventing governance per repository |

## Solution Outline

A public GitHub repository holding four versioned asset classes (Rules,
Schemas, Workflows, Templates — `docs/v1-asset-inventory.md`,
`adp-package.yaml`), read by every acting AI at the start and end of
managed work (`AGENTS.md`'s mandatory lifecycle gate), with Notion holding
live operational state and `brain` holding organizational memory
(`governance/source-of-truth.md`'s State = Notion / Artifact = GitHub /
Memory = brain split).

## Risks

- **Governance drift**: a rule can be violated faster than it's noticed if
  no one re-checks compliance. Mitigated by the Postmortem Improvement Loop
  (`governance/postmortem-improvement-loop.md`) and the AI-to-AI stop gate's
  requirement to cite authority rather than invent it.
- **Over-governance**: too many gates can slow reversible work to a crawl.
  Mitigated by the Human Queue WIP constraint and by scoping Human gates to
  genuinely Human-only criteria (`governance/ai-execution-constraints.md`).
- **Stale documentation**: a Rule/Workflow file that no longer matches
  practice is worse than no file. Mitigated by the versioning policy's
  requirement that a MAJOR/MINOR change be recorded, and by this repository
  itself being where the correction happens (not a separate wiki).
- **`agent-policy.yaml` mistaken for an approved control**: explicitly
  flagged non-authoritative until a fail-closed default and real
  enforcement point exist (`docs/cloudflare-os-evaluation.md` §10).

## Size & Milestones

Currently pre-1.0 (`adp-package.yaml`'s `version: 0.1.0`). The `ADP-049`
chain (A: inventory, B: manifest, C: distribution structure — this session;
D–H: migration/upgrade, doctor/licensing, clean-install E2E) is the path to
a `v1.0.0` release milestone, at which point per-asset-class versions
(`rules_version`, `schema_version`, `workflow_version`, `templates_version`)
continue moving independently (`docs/versioning-policy.md`).

## Trade-off Sliders

Fixed: safety gates on irreversible/high-risk actions (Human-on-the-Loop for
data deletion, public-scope changes, protected-branch merges — never
traded away for speed). Flexes first: documentation completeness/polish —
a Rule that's correct but sparsely worded ships before a Rule that's
gold-plated but late, per this repository's own `decisions/` pattern of
recording durable insight concisely rather than exhaustively.

## Scope Boundary

ADP governs *how* AI-native product development happens across Cloud42
Labo. It does not own *what* any individual Product does — that's each
Product's own Vision/PRD (per `docs/product-design-doc-standard.md`) — and
it does not own operational task state — that's Notion
(`governance/source-of-truth.md`).
