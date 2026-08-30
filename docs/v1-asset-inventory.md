# ADP v1.0.0 Asset Inventory & Freeze Scope

> **Artifact status:** durable reference. Produced for `ADP-049-A` (inventory) to unblock `ADP-049-B..H` (the ADP v1.0.0 packaging chain). Reflects the actual working repository as of 2026-08-29 (commit `5d2b3c7`), not an idealized redesign — per that task's Approach Decision, this is a classification of the current reference implementation.

## Method

Every tracked file in this repository (16 files, excluding `.git/`) was read and classified into one of the seven asset classes requested by `ADP-049-A`: **Rules / Schemas / Workflows / Templates / Skills / Adapters / Environment-specific config**. Three files (`decisions/0001-knowledge-asset-model.md`, `docs/capability-map.md`, `docs/cloudflare-os-evaluation.md`) did not fit any of the seven cleanly; they are called out separately rather than force-fit (see "Does not fit the seven classes" below), since misclassifying them would make the freeze-scope decision less useful, not more.

Cross-checked for: duplicate content, deprecated Slack-premised material, and embedded secrets/credentials (`grep` across all `.md`/`.yaml`/`.yml` for secret- and Slack-shaped strings — see "Hygiene findings").

## Inventory table

| File | Class | v1.0.0 status | Notes |
|---|---|---|---|
| `README.md` | Rules (orientation) | ✅ Include | Repo-level source-of-truth summary (State=Notion / Artifact=GitHub / Memory=brain), repo map, and entry links. Stable, public-safe as written. |
| `AGENTS.md` | Rules | ✅ Include | Core lifecycle gate for any agent touching this repo. Small, stable, no Cloud42-only values beyond expected repo names. |
| `governance/ai-execution-constraints.md` | Rules | ✅ Include | The executable form of most other rules (placement pre-flight, execution pre/post-flight, AI-to-AI stop gate, Human gate pre-flight, Human Queue WIP). This is the single most load-bearing file in the repo — most other Rules/Workflow docs point into it rather than duplicating its content. |
| `governance/source-of-truth.md` | Rules | ✅ Include | Short, stable authority model (State=Notion / Artifact=GitHub / Memory=brain). Referenced by README and AGENTS.md. |
| `governance/research-security-policy.md` | Rules | ✅ Include | External-retrieval/secrets/billing gate. No product-specific content; generalizes cleanly. |
| `governance/authority-stop-gate-regression-cases.md` | Rules (regression fixture) | ✅ Include | 5 test cases for the AI-to-AI stop gate in `ai-execution-constraints.md`. Case 1 is tied to a real incident (`experimental` PR #89) — keep as a concrete regression anchor, not a hypothetical. |
| `docs/human-gate-pre-check-examples.md` | Rules (worked examples) | ✅ Include | Explicitly anonymized/pattern-level by design (see its own header) — already written to survive the concrete tasks it was drawn from. Good v1.0 fit as-is. |
| `docs/operating-guide.md` | Workflow (+ embedded Rules) | ✅ Include | The Stage 1–7 / Gate 1–6 development lifecycle, Sprint cadence, Backlog Refinement, Chris↔Claude handoff, Definition of Ready/Done, and the Human Gate policy (section 11) all live here. This is the largest and most central document; several Rules files are its executable counterpart rather than independent content. |
| `governance/postmortem-improvement-loop.md` | Workflow | ✅ Include | The Record→Analyze→Correct→Create preventive work→Make executable→Retest→Close loop, plus (as of `ADP-043-K`, this session) the independent-review gate. Stable, no product-specific content. |
| `governance/monthly-risk-management-review.md` | Workflow | ✅ Include | Monthly cadence loop, complements the Postmortem loop. Self-contained; its "Initial review procedure" references specific seed Postmortem IDs (PM-1/PM-3) which is fine — it is describing how the *first* review was bootstrapped, not a live status claim. |
| `governance/agent-policy.yaml` | Schema (policy draft) | 🟡 Include, but **explicitly marked non-authoritative** | See "Freeze-scope exception" below — this file's own sibling document concludes it should not be treated as the approved policy yet. |
| `templates/README.md` | Templates (index) | ✅ Include | One paragraph, sets the bar for what belongs in `templates/`. |
| `templates/monthly-risk-review.md` | Templates | ✅ Include | Generic, public-safe, no live Notion status baked in — matches its own stated bar. |
| — (no files) | Skills | ⛔ Not present in this repo | Skills live in `cloud42-labo/skills`, a separate repository. Nothing to freeze here; note as a cross-repo dependency for whichever `ADP-049-*` task defines the distribution structure. |
| — (no files) | Adapters | ⛔ Not present yet | `docs/cloudflare-os-evaluation.md` (see below) explicitly places a policy-enforcement adapter at "Phase 2/3", i.e. deliberately not yet built. Nothing to freeze; this is v2+ scope by the evaluation's own recommendation, not a v1.0 gap. |
| — (no files) | Environment-specific config | ⛔ Not present, correctly | No secrets, tokens, or Cloud42-only environment values found anywhere in this repository (see "Hygiene findings"). Environment-specific config correctly lives in each product repository's own `CLAUDE.md`/CI secrets, not here. |

### Does not fit the seven classes

| File | Why it doesn't fit | Recommendation |
|---|---|---|
| `decisions/0001-knowledge-asset-model.md` | This repo's own `README.md` repo-map already names `decisions/` as its own asset class ("durable ADP design insights and architecture/organization decisions") — distinct from Rules (binding constraint), Workflow (procedure), or Schema (structured definition). | ✅ Include as-is under its existing `decisions/` class. Forcing it into "Rules" would blur a distinction the repo already deliberately makes. |
| `docs/capability-map.md` | A coverage map ("what capabilities exist"), not a constraint, procedure, schema, template, skill, adapter, or config. | ✅ Include as-is; it is explicitly a living/reference document by its own description, not something that "freezes" in the same sense as a Rule. |
| `docs/cloudflare-os-evaluation.md` | A dated decision-support research report with a Final Decision section — architecture research, not itself a Rule/Workflow/Schema. | ✅ Include as-is (durable record of *why* `agent-policy.yaml` is in its current draft state — see next section). Its recommended "Phase 1 Policy Checker PoC" is not yet implemented; route that as future work, not a v1.0 blocker. |

## Freeze-scope exception: `governance/agent-policy.yaml`

This file is the one asset in the repository that should **not** be frozen as an approved, authoritative control, even though it should stay in the v1.0.0 tree:

- It sets `default_decision: approve` — an allow-by-default posture.
- Its own sibling document, `docs/cloudflare-os-evaluation.md` §10, explicitly concludes: *"This is not recommended as the durable authorization model... The draft should therefore be treated as an experiment, not the approved policy, until changed to a fail-closed default and backed by an enforcement point."*
- No enforcement point exists yet that forces agent actions through this file — per that same evaluation, it is "not yet a security control" on its own.

**Recommendation for `ADP-049-*` downstream tasks:** carry `agent-policy.yaml` into v1.0.0 labeled explicitly as an experimental draft (e.g. a header comment or a `docs/operating-guide.md` cross-reference stating it is not yet enforced), rather than either (a) silently freezing it as if it were an approved control, or (b) dropping it and losing the design work. Flipping it to fail-closed and wiring an enforcement point is Phase 1 work from the evaluation's own roadmap — out of scope for `ADP-049-A` itself, and appropriately downstream (a candidate for a dedicated task, not bundled into the packaging chain).

## Hygiene findings

- **Secrets:** none found. Every "secret" match across all `.md`/`.yaml` files is the policy text *about* handling secrets (e.g. "never place credentials or secrets in..."), not an actual credential, key, or token value.
- **Deprecated Slack-premised content:** none found. The only Slack reference in the repository is `docs/operating-guide.md`'s current, correct statement — "Slack is not used for ADP operations" — which is a live negative constraint, not stale content assuming Slack is in use.
- **Duplicates:** none found. Each file has a distinct, non-overlapping purpose; where content is closely related (e.g. `ai-execution-constraints.md` vs. `docs/operating-guide.md` §11), one is consistently the policy source and the other its executable form, cross-referenced rather than copy-pasted.
- **Cloud42-specific values:** present but appropriate — Notion workspace links, `cloud42-labo/*` repo names, and named AI roles (Claude/ChatGPT/Chris/Codex/Gemini) appear throughout, which is expected for the *current reference implementation* per this task's own Approach Decision ("classify the current reference implementation, don't design an idealized new one"). Generalizing these into a template-able package is downstream scope (`ADP-049-C｜Rules・Schemas・Workflows・Templatesを配布構造へ正規化する`), not this task.

## Proposed v1.0.0 freeze scope

**Freeze as-is (15 files):** `AGENTS.md`, `README.md`, `decisions/0001-knowledge-asset-model.md`, `docs/capability-map.md`, `docs/cloudflare-os-evaluation.md`, `docs/human-gate-pre-check-examples.md`, `docs/operating-guide.md`, `governance/ai-execution-constraints.md`, `governance/authority-stop-gate-regression-cases.md`, `governance/monthly-risk-management-review.md`, `governance/postmortem-improvement-loop.md`, `governance/research-security-policy.md`, `governance/source-of-truth.md`, `templates/README.md`, `templates/monthly-risk-review.md`.

**Freeze with an explicit non-authoritative label (1 file):** `governance/agent-policy.yaml` — see exception above.

**Not present, send to follow-up (not a v1.0.0 blocker):**
- Skills — cross-repo (`cloud42-labo/skills`); coordinate with whichever downstream `ADP-049-*` task defines the distribution structure.
- Adapters — intentionally v2+ per the Cloudflare OS evaluation's own phased roadmap.
- A fail-closed, enforced Agent Policy (Phase 1 Policy Checker PoC) — real work, but downstream of this inventory task.

No new database, new repository structure, or new asset class is proposed here — this inventory classifies what already exists.
