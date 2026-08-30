# ADP distribution package

> **Artifact status:** durable reference. Produced for `ADP-049-C`, building on the
> asset inventory from `ADP-049-A` (`../docs/v1-asset-inventory.md`) and the manifest
> from `ADP-049-B` (`../adp-package.yaml`).

This directory is the **single entry point for locating this repository's four
versioned asset classes** — Rules, Schemas, Workflows, Templates (see
`../docs/v1-asset-inventory.md` for why these four and not Skills/Adapters/
Environment-specific config, none of which currently have content here).

It does not move or duplicate the underlying documents. Each class file below
(`rules.md`, `schemas.md`, `workflows.md`, `templates.md`) is a short index of
relative links into the canonical files, which stay where they already live
(mostly `governance/`, `docs/`, `templates/`, and the repository root). Two
files — `AGENTS.md` and `README.md` — stay at the repository root rather than
moving under `package/`, because tooling (GitHub's default file rendering,
Codex-family agents that look for `AGENTS.md` at the repo root) depends on
that root position; the index below still makes them traceable as Rules
without physically relocating them.

## Why an index instead of a move

`ADP-049-C`'s Approach Decision is to normalize by moving **or** referencing
existing files, and explicitly avoid duplicating content. Physically moving
every file into `package/<class>/` would require rewriting every relative
link across `docs/`, `governance/`, and `README.md` in the same change,
for no traceability benefit the index below doesn't already provide — and
this repository is not just a future package, it is also the live governance
repository other agents in this organization read from today (`AGENTS.md`
§ "Mandatory lifecycle gate"). A reference index gets `ADP-049-C`'s
acceptance criterion (Rules/Schemas/Workflows/Templates uniquely traceable
from the package structure) without that breakage risk. If a later task
decides a physical `package/<class>/` tree is worth the link-rewrite, treat
this file as the map for that move, not a blocker to it.

## Asset classes

| Class | Index | What it covers |
|---|---|---|
| Rules | [`rules.md`](rules.md) | Binding constraints an agent must follow |
| Schemas | [`schemas.md`](schemas.md) | Structured, machine-interpretable definitions |
| Workflows | [`workflows.md`](workflows.md) | Multi-step operating processes |
| Templates | [`templates.md`](templates.md) | Reusable starting points for new artifacts |

## Environment-specific values

This package's own index files (above) describe each class generically and do
not embed this organization's concrete values. The canonical files they point
to are the **live operating documents for `cloud42-labo`** and, as such, do
contain this organization's own Notion links, GitHub org/repo names, and
named AI roles — stripping those out would break this repository's current
operational use.

**This is a catalogue, not a substitution mechanism.** Where those values
live, and what an adopting organization would substitute instead, is
*documented* — one file to read, not a repository-wide search — in
[`../examples/cloud42-labo-config.md`](../examples/cloud42-labo-config.md).
Reading that file does not itself reconfigure anything: an adopter today
still edits the canonical Rules/Workflows files by hand for each value
listed there. Actually compiling this package against an adopter's own
values (so the canonical files a new environment reads never contained
Cloud42's values in the first place) is out of `ADP-049-C`'s scope and is
`ADP-049-D`'s job — "Bootstrap Skill で Install/Configure を自動化する",
Backlog, reads the manifest and package assets and compiles/deploys them
into a target environment rather than requiring manual edits. Until
`ADP-049-D` exists, treat this catalogue as a reading aid for a manual
edit, not as the config/adapter boundary itself.
