# ADP Versioning Policy

> **Artifact status:** durable reference for `adp-package.yaml` at the repository root. Produced for `ADP-049-B`, building on the asset inventory from `ADP-049-A` (`docs/v1-asset-inventory.md`).

## Why one version number is not enough

`ai-development-platform` is not one artifact — it is four independently-evolving asset classes (Rules, Schemas, Workflows, Templates; see `docs/v1-asset-inventory.md`). A Rules change (e.g. tightening the Human Gate Pre-check) and a Templates change (e.g. adding a new reusable template) have different blast radii for an adopter. Forcing them onto one shared version number would mean every adopter re-evaluates their whole integration on every change, including changes that don't touch what they depend on.

`adp-package.yaml` therefore carries five version fields: an overall `version` for the package as a whole, plus `schema_version`, `rules_version`, `workflow_version`, and `templates_version` for each asset class. All follow SemVer (`MAJOR.MINOR.PATCH`). Skills and Adapters have no version field yet because neither asset class has any content in this repository (`docs/v1-asset-inventory.md`); add fields for them when content first exists, not preemptively.

## SemVer judgment per asset class

The general SemVer intent (MAJOR = breaking, MINOR = backward-compatible addition, PATCH = fix/clarification with no behavior change) applies, but "breaking" means different things for a governance document than for code. Judge each change against the class it belongs to:

### Rules (`rules_version`)

A Rule is a binding constraint an agent must follow (`AGENTS.md`, `governance/ai-execution-constraints.md`, `governance/source-of-truth.md`, `governance/research-security-policy.md`, `governance/authority-stop-gate-regression-cases.md`, `docs/human-gate-pre-check-examples.md`, and `README.md`'s orientation content).

- **MAJOR** — a change that makes previously-compliant agent behavior non-compliant, or removes/loosens a gate an adopter may be relying on for safety (e.g. removing a pre-flight check, changing an authority boundary, changing what counts as a secret).
- **MINOR** — a new gate, a new check, or a new rule that adds a constraint without invalidating prior compliant behavior (e.g. `ADP-043-K`'s independent-review gate was additive: it introduced a new requirement for `Closed`, but did not change what already-compliant Postmortem handling looked like before that point).
- **PATCH** — wording clarification, a worked example added, a typo fix, or a regression case added to an existing gate (e.g. adding Case 6 to `authority-stop-gate-regression-cases.md` without changing the gate itself) that does not change what compliance requires.

### Schemas (`schema_version`)

Structured, machine-interpretable definitions (currently: `governance/agent-policy.yaml` only).

- **MAJOR** — a field is removed or renamed, a field's type/meaning changes, or the default decision changes in a way that changes what an unmatched action resolves to.
- **MINOR** — a new field or new rule entry is added that an adopter can ignore without breaking their existing integration.
- **PATCH** — a comment, description, or non-functional formatting change.
- `schema_version` is separately marked `0.1.0-experimental` regardless of these rules, because `governance/agent-policy.yaml` itself is not yet an approved control (see `docs/v1-asset-inventory.md`'s "Freeze-scope exception" and `docs/cloudflare-os-evaluation.md` §10). Drop the `-experimental` suffix only when that file's `default_decision` is fail-closed and a real enforcement point exists — not before.

### Workflows (`workflow_version`)

Multi-step processes (`docs/operating-guide.md`, `governance/postmortem-improvement-loop.md`, `governance/monthly-risk-management-review.md`).

- **MAJOR** — a Stage/Gate is removed or reordered, a closure criterion is removed, or a cadence changes in a way that changes what "compliant" looks like for work already in flight.
- **MINOR** — a new Stage/Gate/step/closure criterion is added (e.g. `ADP-043-K`'s addition to Postmortem closure criteria is also a `workflow_version` MINOR, since the loop itself gained a step).
- **PATCH** — sequencing/cadence clarification that doesn't change required steps.

### Templates (`templates_version`)

- **MAJOR** — a template's required-fields contract changes in a way that makes prior instances non-conformant.
- **MINOR** — a new optional section or a new template is added.
- **PATCH** — formatting/wording fixes to an existing template.

### Overall `version`

Bump when the package is deliberately released as a coherent whole (e.g. the `ADP-049-H` v1.0.0 fix-point), not automatically derived from the per-class versions. Between coherent releases, per-class versions may move independently while `version` stays put — that is the point of separating them.

## When to add a `migration_path` entry

Add an entry to `adp-package.yaml`'s `migration_path` whenever a version bump requires an adopter to *do* something to stay compliant or keep functioning — not for every bump. A MINOR addition that adopters can safely ignore does not need one; a MAJOR change to a gate, or a schema field rename, does. Each entry names the `from`/`to` version, the `date`, a one-line `change` description, and the concrete `action_required` (or `none` if the bump is informational only, as with the initial entry).

## Relationship to product-level SemVer

This policy versions the ADP package itself (the durable artifacts in this repository). It is unrelated to and does not replace the per-application SemVer used by product repositories (`brain/notes/semver-and-release-deliverables.md`), which versions shipped apps like `serendipity-spot` or `store-survival-simulator`. A product repository's `APP_VERSION`/`versionName` says nothing about which ADP version it was built under; if that traceability becomes necessary, it is separate future work, not implied by this file.
