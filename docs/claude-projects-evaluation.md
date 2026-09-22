# Claude Projects × ADP — Responsibility Mapping and Gap Analysis

Date: 2026-09-22 (JST)
Status: Decision-support report (ADP-064-T02)
Scope: Map Anthropic's Claude Projects beta (Coordinator / parallel Threads / cloud
sessions / Project memory) onto ADP's existing responsibility layers, judge each
mapping as Replace / Complement / Keep / Conflict / Unknown, name the duplication
risks, and propose a tentative loosely-coupled Execution Adapter architecture.
Source of Truth for Claude Projects' official spec: `ADP-064-T01` (Notion,
completed 2026-09-21 JST), itself grounded in
[Anthropic's official Docs](https://code.claude.com/docs/en/claude-projects)
(confirmed 2026-09-21). This document does not re-derive that spec; see T01's
Result field for the full sourced write-up.

## Executive summary

Claude Projects is not a competing orchestration platform for ADP as a whole. It
is a `claude.ai/code`-scoped UI/app feature (desktop, mobile, web — **not** the
CLI, not Bedrock, not Google Cloud Agent Platform, not Microsoft Foundry) that
lets a Coordinator conversation decompose a request into parallel cloud Threads,
each an independent cloud coding session that can open a PR.

None of ADP's five systems of record — Notion (operational state), this
repository (durable architecture/governance), `brain` (organizational memory),
Skills (how work is performed), and GitHub (code/PR truth) — are replaced by
Projects. Projects has no Notion integration, no confirmed API to export Thread
state, a per-Project memory file that is a second, ungoverned memory surface,
and a Coordinator that would become a second, ungoverned task-decomposition
authority if allowed to originate work rather than execute an already-approved
Notion Task.

The recommendation of this document is: **do not adopt Projects as a second
Trigger, Task source, Memory, or Human Gate.** At most, treat a single-repository
Claude Project as one more interchangeable **Execution Adapter** for the "write
code, open a PR" step of a Task that Notion already owns end-to-end — analogous
to how a CLI session or a Codex run is just one more way to produce a diff. This
keeps the decision reversible: if beta access is revoked, the plan tier changes,
or a better execution surface appears later, nothing about Notion / GitHub /
brain / Codex Review / TTE has to change, only which tool produced the commit.

Final Adopt/Reject on Projects itself remains **open**, gated on `ADP-064-T03`
(PoC), which itself needs Owner confirmation that the `cloud42-labo` operating
account has beta access (T01's unresolved unknown #1). This document's job is
the mapping and the tentative architecture, not the adoption verdict.

## 1. ADP responsibility layers used for this mapping

Per `ADP-064-T02`'s Acceptance Criteria, the ten layers compared are: Routine /
Trigger, Skill, Task decomposition, Notion (operational SoT), GitHub
implementation/PR, Codex Review, Human Gate, Brain / Memory, Task Time Events
(TTE), and Decision / Evidence / Outcome. Each is grounded in this repository's
own governing documents, not paraphrased from memory:

- **Routine / Trigger** — `cloud42-labo/skills`'
  `.claude/skills/scheduled-skill-dispatcher/` (Trigger Bus / Registry in
  `config/scheduled-skills.yaml`), invoked at fixed JST windows and dispatching
  against Notion. This session is itself an instance of that Trigger.
- **Skill** — versioned, git-tracked `SKILL.md` procedures under
  `.claude/skills/*` in `skills`/`ai-development-platform`/per-product repos.
- **Task decomposition** — `hierarchical-refinement` / `task-approach-review` /
  `backlog-refinement`, writing Story→Task structure into Notion.
- **Notion (operational SoT)** — `Stories & Tasks` data source: Status, Priority,
  Blocker, Acceptance Criteria, Result, Started/Completed At.
- **GitHub implementation/PR** — the actual code and PR record; branch-per-repo
  convention, PR templates, and per-repository GitHub branch protection on the
  default branch. (`governance/agent-policy.yaml`'s `github-protected-merge`
  names this intent as a policy draft, but is itself explicitly non-authoritative
  and unenforced — `docs/v1-asset-inventory.md`'s Freeze-scope exception — so
  actual enforcement today is whatever branch protection each repository has
  configured, not this file.)
- **Codex Review** — automatic PR review + ChatGPT-side hourly merge task
  described in `brain/notes/ai-pr-review-loop.md`.
- **Human Gate** — `human-gate-preflight` Skill: per-Acceptance-Criterion
  classification into AI-verifiable / Human-evidence-exists / Human-only, backed
  by Notion `Type = Human Request` records with their own SLA tracking.
- **Brain / Memory** — `cloud42-labo/brain`, git-tracked, PARA-structured,
  attached to every session across all nine repos in scope.
- **TTE** — Notion `Task Time Events`: `Started At` / `Ended At`, `State`
  (Active/Waiting), `Work Type`, rolled up into `Lead Time (h)` /
  `Active Time (h)` / `Waiting Time (h)` on each Task.
- **Decision / Evidence / Outcome** — `governance/source-of-truth.md` and each
  Task's `Result` / `Acceptance Criteria` fields; this document itself is an
  instance of that pattern.

## 2. Claude Projects capabilities (from T01, summarized for this mapping)

- **Coordinator**: interprets the Project's ongoing conversation, decides what
  work to do, and spawns Threads.
- **Thread**: an independent cloud coding session (not local), with its own
  context window and git branch, that can open a PR and runs in auto mode
  (tool calls execute without per-call confirmation unless the Thread itself
  pauses for approval).
- **Project memory**: an autonomously-maintained `MEMORY.md` index, shared by
  all Threads in that one Project only.
- **Project instructions**: up to 16,000 characters, distributed to every new
  Thread in that Project.
- **Library**: a per-Project store of user-added and Thread-produced files.
- **Thread state grouping** (UI only, no confirmed API): Ready for review /
  Waiting on you / Working / Landing / Idle / Resolved.
- **Constraints**: Pro/Max only (no Team/Enterprise); `claude.ai/code` + desktop
  + mobile only (no CLI); 200 new threads/account/day; **`.claude/settings.json`
  permission rules/hooks/env apply to a Thread only when its Project has exactly
  one repository** — multi-repo Projects do not enforce them.

## 3. Mapping table

| ADP layer | Claude Projects equivalent | Judgment | Why |
|---|---|---|---|
| Routine / Trigger | Coordinator (reactive, spawns Threads from a live conversation) | **Keep** | Projects has no CLI surface and no cron/schedule concept; the Trigger Bus's scheduled-window dispatch against Notion has nothing to hand off to here. |
| Skill | Project instructions (≤16,000 chars, per-Project) + autonomous `MEMORY.md` | **Conflict-risk / Keep** | Project instructions are unversioned outside the Project, capped far below a typical `SKILL.md`, and scoped to one Project rather than shared across repos the way Skills already are. Using both without a single owner creates a second, thinner "how" source. |
| Task decomposition | Coordinator decomposing a request into Threads | **Conflict-risk / Keep** | Coordinator decomposition is conversational and ephemeral — no Priority/Type/Blocker/Acceptance Criteria schema, no Definition-of-Ready check. Letting it originate work in parallel with Notion `Stories & Tasks` is exactly the "二重Task管理" (duplicate task management) risk this Task's Acceptance Criteria asks to flag. |
| Notion (operational SoT) | Thread state grouping (Ready for review / Waiting on you / Working / Landing / Idle / Resolved), UI-only | **Unknown / Keep** | No confirmed API or webhook (T01 did not find one) to write Thread state into Notion. Until one exists, running Threads outside a Task's normal Notion lifecycle would silently desync Notion Status from actual work state. |
| GitHub implementation/PR | Thread opens a PR on its Project's repository | **Complement, conditionally Conflict** | The PR itself is still the code/review artifact of record, so this layer is structurally compatible. But the settings.json/hooks non-enforcement on multi-repo Projects means a multi-repo Project's Threads can bypass whatever per-repository branch protection each of those repos actually has configured (`agent-policy.yaml`'s own cross-repo policy intent is not itself an enforced control — see §1). Safe only if a Project is restricted to exactly one repository, and only as safe as that one repository's own GitHub branch protection already is. |
| Codex Review | Not present; Thread's own "Ready for review" state is a UI signal, not a review mechanism | **Complement** | Codex Review runs on the PR object itself regardless of what opened it, so it is unaffected as long as the repo's existing Actions/Codex configuration is untouched. |
| Human Gate | "Waiting on you" Thread state + desktop notification | **Complement, not Replace** | This is a coarse "a human is needed" signal with no per-Acceptance-Criterion classification, no Notion `Human Request` record, and no SLA/Due tracking. Replacing `human-gate-preflight`'s structured gate with this would be a regression in auditability. |
| Brain / Memory | Project `MEMORY.md`, autonomous, per-Project only | **Conflict** | This is a second, ungoverned memory surface: not git-tracked outside the Project, not shared across Products, not human-reviewable the way `brain`'s PARA structure is. Running both is exactly the "二重Memory" (duplicate memory) risk this Task's Acceptance Criteria asks to flag. |
| TTE | Thread state timestamps, UI-only, no confirmed export | **Unknown / Keep** | No API surfaced by T01 to read Started/Ended timing per Thread into Notion `Task Time Events`. Until one exists, TTE must keep being recorded manually by whichever agent is driving the Task, exactly as today. |
| Decision / Evidence / Outcome | Thread transcript + produced PR/Library files | **Keep** | No structured Decision/Evidence/Outcome concept exists in Projects. A Thread's transcript could at most be linked as supplementary evidence (similar to a `Demo URL`), never substitute for the `Result` / `Acceptance Criteria` fields that are the actual Outcome record. |

## 4. Duplication risks (explicit, per Acceptance Criteria)

- **二重Coordinator (duplicate coordinator)**: Projects' Coordinator and ADP's
  own decomposition chain (`task-approach-review` → `hierarchical-refinement` →
  Trigger Bus dispatch) sit at the same conceptual layer — "what should happen
  next." If both are live at once with no ownership boundary, two agents can
  independently decide to start the same or conflicting work.
- **二重Task管理 (duplicate task management)**: a Thread can exist, run, and
  produce a PR without ever touching Notion. Every product repo's own
  `CLAUDE.md`/`AGENTS.md` "Task Exists?" gate assumes Notion is the only place
  work is tracked; an unmanaged Thread silently breaks that invariant.
- **二重Memory (duplicate memory)**: `brain` vs. per-Project `MEMORY.md`. Two
  places can independently record "what we learned," and only one (`brain`) is
  git-tracked, cross-Product, and human-reviewable.

## 5. Tentative architecture: Projects as a loosely-coupled Execution Adapter

If Projects is adopted at all (pending the T03 PoC and Owner confirmation of
beta access), it should be placed at exactly one point in the existing flow —
the step that already varies today between a CLI session, a Codex run, or a
human editing code directly — and nowhere else:

```
Notion Task (Ready, Assigned Agent = Claude, Acceptance Criteria set)
        │
        ▼
   Caller pre-flight (unchanged, AGENTS.md "Before starting work" / T01/T02's own
   gate): Task exists and is executable → Status = In Progress + Started At (JST)
   recorded → Task Time Event opened → actor authority checked
        │
        ▼
   Execution Adapter  ── swappable: CLI session | Claude Projects Thread | Codex
        │                 (this Task's only new option)
        ▼
   Repository PR  ──────────────────────────────────────────────────────
        │
        ▼
   Codex Review + existing merge-authority rules (unchanged)
        │
        ▼
   Calling agent closes Notion (Result → verify + close TTE with Ended At →
   Completed At → Status = Done last) — never the Thread itself
```

Concrete constraints for this Adapter role, each closing one of the risks in
§3–§4:

1. **No Trigger role.** The Trigger Bus (`scheduled-skill-dispatcher`) remains
   the only scheduler. Projects' Coordinator is never given authority to decide
   which Task runs next; it is only ever handed one already-Ready Notion Task.
2. **Single-repository Projects only.** A Project used this way must contain
   exactly one repository, so `.claude/settings.json` permission rules/hooks
   keep applying to its Threads (per T01 §5). This is necessary but not
   sufficient for merge protection on its own: `governance/agent-policy.yaml`'s
   `github-protected-merge` is explicitly a non-authoritative draft with no
   enforcement point (`docs/v1-asset-inventory.md`'s Freeze-scope exception),
   so it cannot be cited as the safeguard against a bypassed merge. The actual
   enforcement point, if one is needed for a repository used this way, is that
   repository's own GitHub branch protection on its default branch (required
   review / required status checks) — configured per-repository today,
   independent of this document. Single-repo scoping only keeps
   `settings.json` itself from being silently ignored; it does not by itself
   guarantee any particular merge policy is enforced.
3. **No independent task decomposition, and no ungated data transfer.** The
   Thread receives one Notion Task URL as its spec (Acceptance Criteria,
   Blocker, dependencies already resolved by Notion, not re-derived by the
   Coordinator). It does not spawn sibling Threads for sub-work Notion hasn't
   already broken out. Before that Task's content is supplied to a Thread, the
   calling agent applies `governance/research-security-policy.md` §1's
   public-information default: if the Task's Acceptance Criteria, Blocker, or
   dependencies contain company-confidential, private, or otherwise non-public
   material, handing it to the external Projects service requires the same
   explicit transfer authorization any other external-service data transfer
   would — it is not automatically permitted merely because the Task is
   `Ready`.
4. **No memory role.** Project `MEMORY.md` is treated as disposable scratch.
   Anything worth keeping is written to `brain` by the closing agent exactly as
   for a normal CLI-run Task; nothing in Project memory is trusted as a second
   Source of Truth.
5. **No Human Gate role.** "Waiting on you" is, at most, a supplementary UI
   notification. `human-gate-preflight`'s Notion `Human Request` records remain
   the only Human Gate SoT.
6. **Unchanged completion contract.** On Thread completion (Ready for
   review / Idle / Resolved), the calling agent — not the Thread — performs the
   same Notion completion transaction any other Execution Adapter would, in
   `AGENTS.md`'s required order: verify Acceptance Criteria/artifact, record
   `Result`, verify and close the Task Time Event with `Ended At`, record
   `Completed At`, and only then set `Status = Done`.

Because the Adapter boundary is this narrow, removing Projects later (beta
ends, plan tier changes, a better cloud execution surface appears) requires no
change to Notion, GitHub, `brain`, Codex Review, or TTE — only a different
choice of Adapter for the one step that already varies.

## 6. Open items carried to later Tasks

- Final Adopt/Reject is **not** decided here; it is gated on `ADP-064-T03`'s PoC,
  which itself needs Owner confirmation that the `cloud42-labo` operating
  account has Projects beta access (T01 unknown #1, still unresolved as of this
  writing).
- Whether Thread state or timing ever becomes API-readable (relevant to the two
  "Unknown" rows above — Notion sync and TTE) should be rechecked against
  official docs before T03/T04, not assumed.
- If T03/T04 confirm adoption, the relevant product repos' `CLAUDE.md`/
  `AGENTS.md` would need an explicit clause restricting Projects usage to
  single-repository Projects with GitHub branch protection already configured
  on that repository's default branch, per §5 point 2 — tracked here as a
  follow-up, not implemented by this Task. This is independent of
  `governance/agent-policy.yaml`'s own fail-closed/enforcement-point gap,
  which `docs/cloudflare-os-evaluation.md` §10 already tracks separately.

## Primary sources

- `ADP-064-T01｜Claude Projectsの公式仕様・制約を確定する` (Notion, Done,
  2026-09-21 JST) — full sourced write-up of the official spec used in §2.
- Anthropic Docs: Let Claude coordinate ongoing work with Projects,
  https://code.claude.com/docs/en/claude-projects (confirmed 2026-09-21, via T01)
- This repository: `governance/agent-policy.yaml`, `governance/source-of-truth.md`,
  `docs/capability-map.md`, `docs/cloudflare-os-evaluation.md` (structural
  precedent for this document)
- `cloud42-labo/skills`: `.claude/skills/scheduled-skill-dispatcher/SKILL.md`
- `cloud42-labo/brain`: `notes/ai-pr-review-loop.md`
