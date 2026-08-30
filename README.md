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
