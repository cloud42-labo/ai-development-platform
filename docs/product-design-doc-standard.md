# Software Product design-document standard

> **Artifact status:** durable reference. Produced for `ADP-050`. Cross-references
> `../package/workflows.md` (this document belongs to the Workflows asset class)
> and the five templates it defines in `../templates/`.

## Why

A Software Product's design intent otherwise scatters across implementation
code, individual Task Results, and per-repository README files. None of
those is a stable place for an AI picking up the Product later to find *why*
it's built the way it is. This standard names six document types, where each
lives, when each is created, and when each is re-synced — so that intent
stays in a durable, discoverable location rather than in conversational
memory or a Task that will eventually be archived.

## The flow

```
Product Vision (Why)
        │
        ▼
Inception Deck (Starting Alignment)
        │
        ▼
PRD (What)
        │
        ▼
   ┌────┴────┐
   │  Epic 1  │  Epic Brief → Design Doc → implementation → PRD/Design Doc sync
   ├─────────┤
   │  Epic 2  │  Epic Brief → Design Doc → implementation → PRD/Design Doc sync
   └─────────┘
        │
        ▼
Major pivot → revise Vision / Inception Deck / PRD as needed
```

Product Vision and the Inception Deck are **Product-level**, written once at
Product start and revised only on a major pivot. The PRD is also
**Product-level** (What the Product does as a whole), amended when a Story's
requirement changes. The Design Doc is written **once per Product at
development start** (How the Product works) and kept in sync — not
recreated per Epic. An Epic Brief is a **lightweight, per-Epic** artifact:
it does not duplicate the Product Vision, Inception Deck, or full PRD/Design
Doc, only the scope of that Epic's change.

## Where each document lives

| Document | Canonical path | Scope | Created | Synced |
|---|---|---|---|---|
| Product Vision | `docs/PRD.md` §1 "Target User / Problem" and §2 "User Value / Use Cases" carry the Vision; a Product with a separately-approved Vision statement predating its PRD may keep it as `docs/product-vision.md` and link it from the PRD instead of duplicating it. | Product | Product Planning stage, before the Inception Deck | Major pivot only |
| Inception Deck | `docs/inception-deck.md` | Product | Product start (Stage: Idea → Vibe/Product Planning) | Major pivot only |
| PRD | `docs/PRD.md` | Product | Product requirement definition | Any Epic that changes a requirement |
| Design Doc | `design-doc.md` (repository root, matching this repository's and `management-simulation-game`'s existing convention) | Product | Development start | Any Epic that changes the design |
| Epic Brief | Inside the Epic's own Notion page (not a GitHub file — an Epic is Notion-native; see `../governance/source-of-truth.md`) | Epic | Epic start | N/A (Epic-scoped, not revised after Epic close beyond normal edits) |

Only the first four are GitHub files; the Epic Brief is deliberately kept in
Notion because an Epic itself has no GitHub-side artifact to attach it to
and Epics are transient relative to the Product documents above them (see
`../governance/source-of-truth.md`'s State = Notion / Artifact = GitHub
split). This does not create a second system of record for Epics — it
keeps Epic-scoped notes where the Epic already lives.

## Required sections

Templates for all five are in `../templates/` (`product-vision.md`,
`inception-deck.md`, `prd.md`, `design-doc.md`, `epic-brief.md`), each
carrying its required sections as headings so a Product only fills them in.

- **Inception Deck**: Why / Elevator Pitch / Product Box / NOT List /
  Stakeholders / Solution Outline / Risks / Size & Milestones / Trade-off
  Sliders / Scope Boundary.
- **PRD**: 1. Target User / Problem — 2. User Value / Use Cases —
  3. Functional Requirements — 4. Non-functional Requirements —
  5. Success Metrics — 6. Constraints — 7. Non-goals / Out of Scope —
  8. Requirement Decisions / Open Questions.
- **Design Doc**: 1. Purpose / User Value — 2. UX / Core Loop —
  3. Architecture — 4. Data Model — 5. Major Design Decisions —
  6. Constraints / Non-goals — 7. Known Issues — 8. Current Specification /
  Source of Truth.
- **Epic Brief**: Outcome / Scope / Non-goals / Related PRD Requirements /
  Design Impact / Acceptance Criteria / Risks.

## When to sync, concretely

- **Epic completion**: before a Story/Epic-closing Task moves its Epic to
  Done, check whether the Epic changed a requirement (→ update the PRD) or
  a design decision (→ update the Design Doc). This is a completion-gate
  check, not a separate scheduled task — fold it into
  `../governance/ai-execution-constraints.md`'s completion post-flight for
  Epic-level work the same way Acceptance Criteria and `Result` already are.
- **Major Product pivot**: revise Vision / Inception Deck / PRD "in the
  needed range" (the Approach Decision's own phrase) — not a full rewrite
  by default, only the sections the pivot actually changes.
- Existing PRD/ARCHITECTURE/individual design documents in a Product
  repository are **not deleted** by adopting this standard; where a Product
  already has an equivalent document under a different name, treat this
  standard's canonical path as the pointer and link the existing document
  from it rather than forking a duplicate (per the Approach Decision:
  "既存PRD・ARCHITECTURE・個別設計書は削除せず、正本ドキュメントから参照する").

## Backfilling existing Products

This document defines the standard; it does not itself backfill every
existing Product (see `ADP-050`'s own Acceptance Criteria — backfill is
part of the same Story, tracked as separate child Tasks so each Product's
backfill gets its own review rather than being bundled into one very large
diff). At the time this document was written, of the nine Products in
Notion, four have a `Product Repo` set and are addressed by dedicated
backfill Tasks: `ai-development-platform` (this repository — largely
already compliant per `../docs/v1-asset-inventory.md`; the gap is a
Product Vision / Inception Deck, since this repository grew organically
rather than through the standard Product-start flow), `serendipity-spot`,
`management-simulation-game`, and `ai-organization-design`. Products without
a `Product Repo` yet (`未来の店舗生存サバイバルゲーム` despite
`cloud42-labo/store-survival-simulator` existing, `Scanhunt`,
`人財ポートフォリオマネジメント`, `Cloud42-labo 事業化`, `Kids Oekaki`) are out of
this pass's scope — apply this standard when each is promoted to a
`Product Repository`-stage Product with a `Product Repo` set, not before.
