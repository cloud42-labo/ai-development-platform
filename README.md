# AI Development Platform (ADP)

ADP is the operating system for Cloud42 Labo's AI-native product development organization.

This repository is the **system of record for ADP artifacts and intellectual assets**: operating models, governance documents, capability maps, architecture, reusable templates, and other durable deliverables.

## Source-of-truth model

| Domain | System of Record | Purpose |
|---|---|---|
| Operational state / work records | [Notion — Vibe Product Development](https://app.notion.com/p/3affbd826f3b819d84ebe3015c6f946b) | Products, Epics, Stories, Tasks, Sprints, timestamps, results, decisions and execution evidence |
| Artifacts / intellectual assets | This repository | Durable documents, models, standards, diagrams and templates |
| Organizational memory | [`cloud42-labo/brain`](https://github.com/cloud42-labo/brain) | Learned context, rationale, lessons and accumulated organizational memory |

In short: **State = Notion / Artifact = GitHub / Memory = brain**.

## Start here

- [Operating Guide](docs/operating-guide.md)
- [Human Gate Pre-check — worked examples](docs/human-gate-pre-check-examples.md)
- [Organization Digital Twin Capability Map](docs/capability-map.md)
- [Source-of-Truth Policy](governance/source-of-truth.md)
- [Knowledge Asset Model: State / Artifact / Memory](decisions/0001-knowledge-asset-model.md)
- [AI agent working rules](AGENTS.md)
- [Package manifest](adp-package.yaml) and [Versioning Policy](docs/versioning-policy.md)
- [Distribution package index](package/README.md) — Rules/Schemas/Workflows/Templates by class
- [Software Product design-document standard](docs/product-design-doc-standard.md)
- [ADP's own Inception Deck](docs/inception-deck.md) and [PRD](docs/PRD.md)
- [v1.0.0 Asset Inventory & Freeze Scope](docs/v1-asset-inventory.md)
- [Notion Operating Guide](https://app.notion.com/p/3bdfbd826f3b8119b7b4e623c9cdc94e)

## Repository map

- `docs/` — operating model, capability maps, architecture and design assets
- `governance/` — policies, standards, guardrails and source-of-truth rules
- `decisions/` — durable ADP design insights and architecture/organization decisions
- `templates/` — reusable templates for AI-native product development
- `package/` — index of this repository's Rules/Schemas/Workflows/Templates by class, for an adopting agent or script (`adp-package.yaml`'s `package_root`)
- `examples/` — this deployment's own environment-specific values (Notion workspace, GitHub org, named AI roles), catalogued separately from the package body
- `AGENTS.md` — working rules for AI agents modifying this repository

## Operating principle

ADP is treated as an **Organization Digital Twin**: roles, authority, decisions, delivery flows, controls and feedback loops are implemented, observed and improved as a working AI organization.

The repository is public. Do not commit secrets, credentials, private personal data, company-confidential information, or content that cannot be intentionally published.

## License / usage terms

This repository does not currently carry an OSS license file. Being publicly
visible on GitHub does not by itself grant anyone permission to reuse,
redistribute, or modify its contents — under default copyright, all rights
are reserved by Cloud42 Labo. Viewing and reading the contents (including
via `adp-bootstrap`'s dry-run/plan step) is fine; installing or
redistributing it into another environment requires the repository owner's
explicit permission until a license is formally adopted.

Candidate OSS licenses for a future formal adoption, for when Cloud42 Labo's
owner decides to open this package up for third-party/other-org reuse (see
[`adp-bootstrap`](https://github.com/cloud42-labo/skills/tree/main/.claude/skills/adp-bootstrap)):

| License | Why it could fit | Trade-off |
|---|---|---|
| **MIT** (recommended) | Simplest, most widely recognized permissive license; low friction for another org to adopt Rules/Schemas/Workflows/Templates that are mostly documentation and process, not patent-sensitive code | No explicit patent grant (unlikely to matter here) |
| Apache-2.0 | Adds an explicit patent grant and contribution terms | More legal text than this package's content (docs/templates/rules, not a library) plausibly needs |
| Keep proprietary (all rights reserved) | No change from today; simplest if third-party redistribution isn't actually intended yet | `adp-bootstrap`'s stated purpose (deploying ADP to other orgs) would need a different distribution mechanism (e.g. a signed agreement per adopter) instead of "clone and go" |

Which license (if any) to formally adopt is an Owner decision, not an AI
one — tracked as a Notion Task under this repository's Product/Epic (per
this README's own Source-of-truth model above), not linked here to avoid
embedding an org-specific Notion page reference in a package meant for
other adopters. This section states the current default status and the
options; it does not itself grant a license.
