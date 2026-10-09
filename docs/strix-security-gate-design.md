# Strix Security Gate — placement design, fail-safe boundaries, overlap, and build plan (AC2/AC4/AC7/AC9)

Date: 2026-10-09 (JST)
Scope: Notion `ADP-069-T06｜Strixを検証しSecurity Gateを設計・PoCする`
(Issue cloud42-labo/ai-development-platform#109, PR #112).

This document is the continuation of `docs/strix-security-gate-evaluation.md` (PR #112,
not yet merged as of this writing). That document covers AC1/AC3/AC5(partial)/AC6 and
the AC8 pre-flight-gate result (blocked on billing + no Docker daemon in that session's
container). This document completes the design-only acceptance criteria that do not
require running Strix: **AC2** (Gate placement), **AC4** (fail-safe boundaries), **AC7**
(overlap with existing controls — PR #112 §5 mislabeled this as "AC4 sketch"; it is AC7
content and is treated as such here), and **AC9** (Skill/CI/Scheduler/Evidence/KMI
proposal). **AC10** (final Adopt/Partial Adopt/Reject/Defer) still cannot be finalized
without the AC7/AC8 PoC run — see §5 for what remains Owner-gated and why.

This document was written on `claude/wizardly-newton-g502o0` as a separate PR because
PR #112 lives on a different branch (`claude/wizardly-newton-7c55pw`) this session is
not authorized to push to. Once both PRs are reviewed, their content is intended to be
folded into one `docs/strix-security-gate-evaluation.md`.

## 1. Gate placement design (AC2)

Three placement candidates, as the Approach Decision required:

### 1.1 PR Merge Gate

- **Trigger**: PR opened/updated against a protected branch in a scanned repository.
- **Target**: changed files in the PR diff only (Strix's own quick-scan mode is
  diff-scoped — see PR #112 §1). A full-repo scan on every PR is not proposed; it
  duplicates the periodic control in §1.3 and would multiply runtime/cost per PR.
- **Judgment**: see §2's severity→decision table. A PR-level gate does not introduce a
  new approval layer or a new merge operator — `governance/agent-policy.yaml`'s
  `github-protected-merge` rule is marked non-authoritative
  (`docs/instruction-skill-debt-inventory.md`), and the actual authority is
  `docs/regulations/R02-authority-regulation.md` §4.2: a Strix finding is evidence fed
  into whichever Author/Reviewer/merger flow already governs the repository (R02 §4.1
  self-merge repos keep self-merge; R02 §4.2's other repos keep Claude-authored →
  independent review → Chris merges, or Chris-authored → independent review → Claude
  merges). The Owner is not the normal merge operator under either case.
- **Evidence**: Strix's own finding list (or SARIF, once confirmed — see PR #112 §1)
  attached to the PR as a check-run artifact; a one-line summary posted as a PR
  comment, consistent with the existing Codex review comment convention.
- **Override authority**: none for an open P0/P1 — `docs/regulations/R05-system-development-management-regulation.md`
  §8.4 prohibits merging with an unresolved P0/P1 finding, full stop; this is the same
  rule a Codex P0/P1 is already held to on every PR today, and Strix does not get a
  softer standard or an Owner waiver. An AI actor also cannot privately dismiss its own
  P0/P1 finding without that evidence, per `governance/ai-execution-constraints.md`'s
  AI-to-AI stop gate / self-authority-escalation rule — but the resolution path is
  "fix it or the repository's normal independent reviewer confirms it's not real," not
  an Owner escalation invented for Strix specifically.
- **Re-execution**: event-driven on PR head update, the same pattern already defined
  for Codex in `governance/codex-review-event-loop.md` — re-run only on a new head SHA,
  not on every comment/label event.

### 1.2 Release Gate

- **Trigger**: the existing Demo/Release Delivery Gate
  (`docs/regulations/R05-system-development-management-regulation.md`) at the point a
  version is tagged/published, not at every PR.
- **Target**: full repository tree at the released ref (broader than the PR-level
  diff scan — catches issues introduced across several merged PRs, or present before
  Strix was adopted).
- **Judgment**: same severity table as §1.2 below, but blocking here is Release
  completion, not PR merge — a repo can still merge internal-only PRs while a release
  finding is triaged.
- **Evidence/override/re-execution**: same shape as §1.1, attached to the release
  record instead of a PR.

### 1.3 Periodic Security Control

- **Trigger**: scheduled (e.g. weekly), not tied to any single PR or release.
- **Target**: full tree of each in-scope repository, rotated across the organization's
  repos rather than all at once, to bound run cost.
- **Judgment**: findings feed a Notion Task (via MISC intake per
  `governance/ai-execution-constraints.md`) rather than blocking anything directly —
  this is detection, not a merge/release blocker.
- **Evidence**: a Notion `Scheduler Run Events` record for every run (clean or not,
  per the liveness-evidence requirement — see §5); a Stories & Tasks Task only when
  the run has an actionable finding, with the finding list linked. KMI aggregation
  per §4.
- **Override authority**: N/A — nothing is blocked by this control; it only creates
  follow-up Tasks.
- **Re-execution**: fixed schedule, independent of repo activity.

**Recommendation for the PoC (once unblocked):** start with §1.3 (periodic, non-blocking)
on one or two small non-production repos. A non-blocking control surfaces false-positive
rate and runtime/cost data without putting Strix in the critical path of any merge or
release before that data exists. Promoting to §1.1/§1.2 is a separate, later decision
once the PoC's false-positive rate and runtime are known (see §5).

## 2. Severity → merge/release decision (part of AC2)

| Strix severity | PR Merge Gate | Release Gate | Periodic Control |
|---|---|---|---|
| Critical/P0 | Block merge — no override; resolve (fix, or the repository's required independent reviewer confirms it does not apply) before merge, per R05 §8.4 | Block release on the same terms | Open P0 Task immediately (MISC intake), notify |
| High/P1 | Block merge — same as P0 | Block release — same as P0 | Open P1 Task |
| Medium/P2 and below | Do not block; attach as informational finding | Do not block; attach as informational finding | Open backlog Task |

This mirrors the existing Codex review convention already in force
(`governance/review-loop-control.md`'s P0/P1 vs P2 treatment), so adopting Strix does
not introduce a second, differently-calibrated severity standard alongside Codex's.

## 3. Fail-safe boundaries (AC4)

| Condition | Safe-side stop (do not proceed as if clean) | Continue without a false Human Gate |
|---|---|---|
| Scan tool unavailable (Docker daemon down, Strix install/auth failure, network egress blocked) | PR Merge Gate / Release Gate: **do not merge/release as if scanned** — report the tool failure explicitly, do not silently skip the check or treat "scan did not run" as "scan passed". | Periodic Control: skip this run, log the miss, and pick the repo up on the next scheduled run — a single missed periodic scan is not a reason to open a Human Request. |
| Budget exhaustion (metered LLM spend cap, Strix Cloud quota) | Any gate currently running under a Human-approved metered budget: stop at the cap, do not retry into further spend. | Do not create a new approval/WIP-style constraint from this (per the AI-authored operating-constraint prohibition) — exhausting an already-approved budget is an ordinary `capability_permission_failure`, handled like any other, not a new standing policy. |
| Suspected false positive | PR Merge Gate: do not auto-dismiss a P0/P1 finding on the AI's own judgment that it is probably wrong — this is exactly the "AI may not waive the gate for itself" boundary in §1.1. Route it through the same independent review the repository already requires (R02 §4.1/§4.2) with the specific reasoning for why it looks like a false positive, same as an open Codex P0/P1 thread today; it stays open until that reviewer resolves it, not an Owner round-trip. | Periodic Control: a likely-false P2/below finding can be closed in the backlog Task with the reasoning recorded, without a reviewer round-trip — consistent with the existing "P2 is not a blocker" convention. |
| Scan failure mid-run (crash, timeout) | Treat as "scan did not run", not as "scan found nothing" — same rule as tool-unavailable above. First classify the failure into one of the four required classes (`governance/ai-execution-constraints.md`'s failure/recovery contract) before deciding how to respond: a crash/timeout with no sign of a policy denial or permission/capability error is `transient_connector_failure` — re-read state and retry, **up to 3 times after the initial failure, never more**; an explicit policy/sandbox denial is `hard_safety_guard` — do not retry, do not route around it; a 401/403/missing-scope/tool-not-installed failure is `capability_permission_failure` — do not retry uselessly, escalate instead; anything else is `ordinary_failure` — record it and fall through to the tool-unavailable row without retrying. Never retry a failure that isn't classified as `transient_connector_failure`. | If `transient_connector_failure` retries are exhausted, fall through to the tool-unavailable row (Periodic Control: skip, log, pick up next scheduled run). |

The common thread: **absence of a clean result is never treated as a clean result.**
A gate that cannot run reports "not run" and stops the thing it was supposed to gate
(merge/release), while a periodic, non-blocking control simply logs the miss and tries
again on schedule — it has nothing to incorrectly wave through.

## 4. Relationship to existing controls (AC7)

- **Codex Automatic Review** (`governance/review-loop-control.md`,
  `governance/codex-review-event-loop.md`): reviews the PR diff for correctness,
  design, and — per `AGENTS.md` §Code Review Rules — "things that break if merged".
  It is not a dedicated security scanner and has no documented exploit-validation
  step. Strix is a different layer: an agentic tool that actively probes/validates
  (not just reads) for vulnerability classes Codex's general review does not
  specifically target (injection, auth bypass, SSRF, etc., validated with a live
  PoC rather than inferred from the diff). Complementary, not duplicate — Strix's
  SARIF/finding list should be a *separate* check alongside Codex's existing
  comment, not merged into or replacing it.
- **GitHub native security checks** (Dependabot/secret scanning, where enabled):
  dependency-CVE and credential-pattern detection, not application-logic
  vulnerability discovery. Strix overlaps least here — different detection class.
- **`external-security-skill-selector`** (cloud42-labo/skills): a curated,
  default-deny registry of *defensive* Anthropic-published skills (DevSecOps
  scanning, prompt-injection defense, SBOM analysis), loaded only after Human
  approval, with offensive/exploitation categories excluded by design. Strix is
  explicitly an offensive/agentic-pentesting tool run via a third-party CLI/cloud
  product — adopting it is **its own authority, billing, and Docker decision**,
  not something that can piggyback on that selector's existing approval. If Strix
  is adopted, it should be referenced *from* that selector's documentation as a
  related-but-separate capability, not folded into its allowlist.

Net: no existing control already does what Strix would do (active exploit
validation on live/code targets); adoption would add a new detection category, not
duplicate one already covered by Codex, GitHub native checks, or the Skill selector.

## 5. Security Gate Skill / CI workflow / Scheduler / Evidence / KMI proposal (AC9)

This is a **build plan**, written so that once AC7/AC8 (the actual PoC run) produce
real false-positive-rate and runtime/cost numbers, implementation can start without
a second design pass. It is not itself the AC8 evidence and does not claim the PoC ran.

- **Skill**: `strix-security-gate` (new), responsible for: invoking Strix in the
  chosen execution path (§2 of PR #112 — whichever actor/environment the Owner
  decides runs it), mapping its output to the severity table in §2 above, and
  posting the PR comment / release record / backlog Task depending on which gate
  (§1.1/1.2/1.3) invoked it. It does not duplicate `external-security-skill-selector`
  — that Skill is for loading vetted defensive skill bodies, this one is for running
  a specific third-party pentesting tool.
- **CI workflow**: a new GitHub Actions workflow per in-scope repo (mirroring the
  Company Forge Android CI pattern already used in this organization — see
  `management-simulation-game` PR #31's `company-forge-android-demo.yml` for the
  house style of a scoped, single-purpose workflow), gated on `pull_request` for
  §1.1 and `workflow_dispatch`/schedule for §1.3. Requires a Docker-capable runner
  (`ubuntu-latest` has Docker by default — this resolves PR #112 §6's "no Docker
  daemon" blocker for the periodic/CI path, independent of which AI actor's
  interactive session runs the PoC).
- **Scheduler**: the periodic control (§1.3) is registered the same way other
  recurring skills are — an entry in `cloud42-labo/skills`'
  `config/scheduled-skills.yaml` with its own `windows_jst`/`concurrency_key`, not a
  bespoke new scheduler. No new scheduler infrastructure is proposed.
- **Evidence**: each run (any of the three gates) writes a durable record — PR
  comment + check-run artifact for §1.1, release record for §1.2, a Notion Task only
  for an actionable (non-clean) finding for §1.3 — linked back to this Task
  (ADP-069-T06) and, once adopted, to its own governance section once this evaluation
  is promoted into a permanent `governance/` document (not proposed as final text
  yet — AC10 below). The periodic control (§1.3) additionally writes a Notion
  `Scheduler Run Events` record for **every** expected run, clean or not — a clean
  run, a failed run, and a missed run are otherwise indistinguishable from each other
  and from "the scan never happened," which defeats `governance/ai-execution-constraints.md`'s
  daily liveness reconciliation (it must be able to tell `Scheduled`/`Started`/
  `Completed`/`Failed or Blocked`/`Missed` apart, with retry count and failure class
  where applicable). A Stories & Tasks Task stays reserved for the finding itself,
  not for proving the scan ran.
- **KPI/KMI (draft, to be confirmed against real PoC data)**:
  - finding count by severity, per repo, per period;
  - false-positive rate (findings closed as not-a-bug / total findings) — the
    single number that decides whether §1.1/1.2 (blocking) is viable, since a high
    false-positive rate on a blocking gate directly damages merge/release velocity;
  - scan runtime and (if a metered LLM path is used) token/cost per run;
  - tool-unavailable rate (how often §3's "scan did not run" path fires) — a high
    rate here means the Docker/billing dependency is a reliability risk, not just a
    one-time setup problem.

## 6. AC10 — still Defer, and why this document does not change that

Nothing in this document required running Strix, so it does not supply the AC7/AC8
PoC evidence (finding validity, false-positive rate, runtime, cost, required
permissions, data exposure) that AC10 needs for a real Adopt/Partial Adopt/Reject
call. The two Owner decisions PR #112 §6 already identified are unchanged and are
the actual remaining blocker:

1. who runs the PoC (Chris/ChatGPT session with the ChatGPT-subscription LLM path,
   or Owner-approved bounded metered Anthropic/OpenAI spend for a Claude session) —
   §5's CI-workflow option (a GitHub Actions runner, which has Docker by default) is
   offered here as a third option that sidesteps the "which AI actor's interactive
   container has Docker" question entirely, leaving only the billing-path decision;
2. the billing-path decision itself, which only the Owner can make under
   `governance/research-security-policy.md` §5.

Everything design-shaped that does **not** depend on that PoC (AC2, AC4, AC7, AC9) is
now written above. What remains open is exactly, and only, the two Owner decisions
above — once either is made, the PoC in PR #112 §6's recommended target (a small
non-production repo such as `store-survival-simulator` or `kids-oekaki`) can run and
AC10 can be finalized without a further design pass.
