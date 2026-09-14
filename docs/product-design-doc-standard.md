# Software Product design-document standard

> **Artifact status:** durable reference. Produced for `ADP-050` and extended by `ADP-044-D`. Cross-references
> `../package/workflows.md`, `product-vision-quality-standard.md`, and the five templates in `../templates/`.

## Why

A Software Product's design intent otherwise scatters across implementation
code, individual Task Results, and per-repository README files. None of
those is a stable place for an AI picking up the Product later to find *why*
it's built the way it is. This standard names document types, where each
lives, when each is created, and when each is re-synced — so that intent
stays in a durable, discoverable location rather than in conversational
memory or a Task that will eventually be archived.

Product Vision quality itself is governed by
[`product-vision-quality-standard.md`](product-vision-quality-standard.md).
A Human Raw Idea or provisional Vision is valid during Idea / Experimental
work, but it is not an Approved Vision and cannot permanently justify
downstream Epic structure.

## The flow

```
Human Raw Idea
      │
      ▼
Idea / Experimental ── primary evidence / learning
      │
      ▼
Human × AI Vision re-articulation
      │
      ▼
Product Vision Quality Gate + Owner acceptance
      │
      ▼
Approved Product Vision (Why / desired future state)
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
Major pivot → re-run Vision Gate / revise downstream docs as needed
```

Product Vision and the Inception Deck are **Product-level**. The Vision may
begin provisionally during exploration, but Product Registry / Product
Planning entry requires an Approved Vision that passes the quality standard
and has explicit Owner acceptance. The PRD is also **Product-level** (What
the Product does as a whole), amended when a Story's requirement changes.
The Design Doc is written **once per Product at development start** (How the
Product works) and kept in sync — not recreated per Epic. An Epic Brief is a
**lightweight, per-Epic** artifact: it does not duplicate the Product Vision,
Inception Deck, or full PRD/Design Doc, only the scope of that Epic's change.

## Where each document lives

| Document | Canonical path | Scope | Created | Synced |
|---|---|---|---|---|
| Product Vision | `docs/PRD.md` §1/§2 may carry an already-approved Product Vision; a separately-approved Vision may live at `docs/product-vision.md` and be linked from the PRD. In either case the content must pass `docs/product-vision-quality-standard.md`. | Product | provisional during Idea/Experimental; Approved before Product Registry / Product Planning | Major pivot / material evidence change |
| Inception Deck | `docs/inception-deck.md` | Product | Product start after Approved Vision | Major pivot only |
| PRD | `docs/PRD.md` | Product | Product requirement definition | Any Epic that changes a requirement |
| Design Doc | `design-doc.md` (repository root, matching this repository's and `management-simulation-game`'s existing convention) | Product | Development start | Any Epic that changes the design |
| Epic Brief | Inside the Epic's own Notion page | Epic | Epic start | N/A |

Only the first four are GitHub files; the Epic Brief is deliberately kept in
Notion because an Epic itself has no GitHub-side artifact to attach it to and
Epics are transient relative to the Product documents above them. This does
not create a second system of record for Epics — it keeps Epic-scoped notes
where the Epic already lives.

## Required sections

Templates for all five are in `../templates/` (`product-vision.md`,
`inception-deck.md`, `prd.md`, `design-doc.md`, `epic-brief.md`).

- **Product Vision**: Vision Type / Lifecycle Stage / Purpose / Problem /
  Opportunity / Evidence / Desired Future State or Outcome / Success Measures /
  Assumptions / Unknowns / Non-goals / Owner Intent / AI Interpretation /
  Downstream Boundary / Vision Gate / Revision Notes.
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

## Vision lifecycle, concretely

- **Idea**: Human Raw Idea may be incomplete, intuitive, emotional, or solution-shaped. Preserve it as input; do not label it Approved merely to unblock planning.
- **Experimental**: use prototypes/experiments/direct observation to create primary evidence. AI may challenge assumptions and propose alternative structures, but Human × AI dialogue must re-articulate the Vision from the evidence.
- **Product Registry / Product Planning promotion**: require `Vision Decision = Approved` and Owner acceptance evidence under the Product Vision Quality Standard.
- **Major pivot**: re-run the Vision Gate when target user/stakeholder, problem/opportunity, desired future state, or foundational evidence changes. Implementation-only changes do not automatically require Vision revision.

## When to sync, concretely

- **Epic completion**: before a Story/Epic-closing Task moves its Epic to
  Done, check whether the Epic changed a requirement (→ update the PRD) or
  a design decision (→ update the Design Doc). This is a completion-gate
  check, not a separate scheduled task.
- **Major Product pivot**: re-run the Vision Gate first, then revise Vision /
  Inception Deck / PRD in the needed range — not a full rewrite by default.
- Existing PRD/ARCHITECTURE/individual design documents in a Product
  repository are **not deleted** by adopting this standard; where a Product
  already has an equivalent document under a different name, treat this
  standard's canonical path as the pointer and link the existing document
  from it rather than forking a duplicate.

## Backfilling existing Products

This document defines the standard; it does not itself backfill every
existing Product. Existing Product artifacts are evaluated against the Vision
Quality Gate when their lifecycle next requires an Approved Vision or when a
material pivot is proposed. Do not silently rewrite Owner intent merely to
make a legacy document pass the Gate; return `Revise` with the specific
quality gap and obtain Owner acceptance for the revised Vision.
