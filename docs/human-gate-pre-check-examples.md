# Human Gate Pre-check — worked examples

> **Artifact status:** durable reference for applying the Human Gate Pre-check defined in [`operating-guide.md`](operating-guide.md) section 11 and [`../governance/ai-execution-constraints.md`](../governance/ai-execution-constraints.md).
>
> The task states quoted below are the evidence as it stood on **2026-08-24 (JST)**, captured to show how the classification was reached. Notion remains the system of record for current state; do not read these examples as current status.

The pre-check exists because a Human gate is a claim about the present ("no record exists yet that satisfies this criterion") written in the past. The three examples below are the three outcomes the classification can produce, applied to real work.

## Case 1 — False Human gate

**Subject:** [HPM-02-S05｜経営コックピットで事業目標・人財・予算・KPI・時間軸を同時に判断できる](https://app.notion.com/3b8fbd826f3b81529628cb1fc7f5e272) — Status `Blocked`.

**Blocker as written:** HPM-02-S05-5 (Human verification of decision-making clarity through actual screen operation) is incomplete, therefore the parent Story cannot complete.

**Sources searched:** Notion Stories & Tasks (all HPM-02-S05 children), the feedback record attached to HPM-02-S05-6, and GitHub `cloud42-labo/experimental` PR #83.

**Classification:**

| Acceptance Criterion | Class | Evidence |
|---|---|---|
| Five viewpoints (goal, departmental talent portfolio, investment budget, KPI impact, five-year timeline) comparable without screen transitions | Human evidence already exists / AI-verifiable | [PR #83](https://github.com/cloud42-labo/experimental/pull/83) merged 2026-08-11, single-screen cockpit; design fixed in S05-1/S05-2/S05-4, all `Done` |
| Not too many controls; KPI, budget and future impact traceable when a measure changes | Human evidence already exists | HPM-02-S05-3 `Done` (realtime preview, PR #83); HPM-02-S05-X `Done` with a Chromium headless run confirming four simultaneous targets are reachable |
| Human confirmation that the screen is readable as a management decision | Human evidence already exists | 取締役Labo 6th session survey, **2026-08-23**, recorded on [HPM-02-S05-6](https://app.notion.com/p/3c5fbd826f3b81109339c4440c7ba55c): real users reported learning how to prioritise placement and reskilling under limited resources. Three improvement points were extracted and already backlogged as HPM-02-S04-4, HPM-02-S02-8 and HPM-02-S00-6 |

**Result:** no `Human-only` criterion. Every child (S05-1 … S05-6, S05-X) was already `Done`, including S05-5, which was itself corrected on 2026-08-24 06:41 JST using the same survey evidence. The Blocker text was simply never revisited after the child completed, so a satisfied gate kept the parent Story stopped.

**Action taken:** no Human Request created. Blocker cleared and the Story completed with the evidence links recorded in `Result`.

**What made it detectable:** the gate named a *specific child task*. Checking whether that child was still incomplete took one query. Gates written as "Human confirmation needed" without naming what would satisfy them are the ones that rot silently.

### Case 1b — the same failure produced by a tool limitation

**Subject:** [HUMAN-SPOT-06-S01-T02-1｜release署名CIの実行結果を確認する](https://app.notion.com/3c6fbd826f3b8165bae6ddf4f3f1377b) (`Type = Human Request`, `Ready`) and its parent [SPOT-06-S01-T02](https://app.notion.com/3c5fbd826f3b81309adee7e7fa5930c6) (`Blocked`).

**Request as written:** open GitHub Actions, find the run triggered by the PR #25 merge to `main`, and report whether `Build release APK` and `Verify release APK signer` passed.

**Why it was created:** the acting agent's GitHub connector exposed only pull-request-triggered runs, so the merge-commit run appeared to have zero runs. Rather than guess, the agent delegated the lookup to a person — the right instinct, applied one step too early.

**Classification:** the single criterion is `AI-verifiable`. Reading a CI result is not Human work; only that agent's connector could not reach it.

**Evidence found through a different tool path** (workflow-run listing filtered by `branch=main`, then job listing):

- Run [32623341668](https://github.com/cloud42-labo/serendipity-spot/actions/runs/32623341668), workflow `serendipity-spot-android build`, event `push`, head `3627d056fe1977de41329137854ad42165afe35c` (the PR #25 merge commit), conclusion **success**.
- Step 13 `Build release APK` — success. Step 14 `Verify release APK signer` — success. Job environment shows `HAS_RELEASE_KEY: true`, so the release path executed rather than being skipped.
- The verification step is not decorative: it compares the keystore SHA-1 against the APK signer certificate and exits non-zero on mismatch, so its success establishes that the release APK was signed with the CI release key.

**Action taken:** the Human Request was completed from the CI evidence without Owner involvement, and the parent task unblocked.

**Rule this produced:** *one tool failing is not evidence that a Human is required.* Before declaring a criterion Human-only because a lookup failed, try another tool, another agent's connector, or the underlying API — and record which paths were tried, so the next agent neither repeats the dead end nor inherits its conclusion.

## Case 2 — Genuine Human gate, correctly maintained

**Subject:** [SPOT-06-S01-H03｜Play Consoleアカウントセットアップ・Data Safetyフォーム入力・カテゴリ確定](https://app.notion.com/3c5fbd826f3b81d7938ac0e8564bec3a) (`Type = Human Request`, `Ready`).

**Sources searched:** Notion Stories & Tasks under SPOT-06-S01, the `android/google-play-release-checklist.md` artifact referenced by the request, GitHub PR #25 and the repository's Actions history.

**Classification:**

| Acceptance Criterion | Class | Why |
|---|---|---|
| A usable Google Play developer account exists | Human-only | Account creation with identity verification and a US$25 registration payment. Account creation, identity proof and payment are Owner authority; no connected source can perform or substitute for them |
| Privacy policy URL and Data Safety form submitted in Play Console | Human-only | Form submission inside a third-party console with no available API path. The *content* was already drafted by AI in the release checklist, so the Human action is data entry against the live option wording, not authorship |
| Store category finalised | Human-only | A product positioning decision inside the Owner's authority (「地図とナビ」 vs 「ツール」). AI may recommend; it may not decide |

**Result:** all criteria `Human-only`. No adjacent evidence exists — the sibling gate H01 (release key generation and Secrets registration) is `Done`, which confirms the Owner is acting on this Story and makes the absence of any Play Console record meaningful rather than merely unsearched.

**Action taken:** the Human Request was left as-is. The gate is doing its job.

**What separates this from Case 1:** in Case 1 the Human act had already happened and had a dated record. Here it demonstrably has not. The pre-check is not a bias toward closing gates — it is a requirement to look before opening or keeping one.

## Case 3 — Partial Human gate

**Subject:** [HPM-02-S04-3｜4チェックポイントで振り返り、研修で分かりやすさを検証する](https://app.notion.com/3b8fbd826f3b816aa49cc0ea177362fd) (`Blocked`, Human), which also blocks its parent Story [HPM-02-S04](https://app.notion.com/3b8fbd826f3b81ae8b66e6ad74b444ac).

**Blocker as written:** verification of comprehensibility by actual training participants is required; the AI will not judge "was it understandable" on its own.

**Sources searched:** the reflection design recorded on the task itself, HPM-02-S04's `Result` (headless verification, 2026-08-12 17:50 JST), and the 取締役Labo 6th session survey on HPM-02-S05-6.

**Classification, per reflection checkpoint** (the task fixes four questions and requires 3 of 4 to be answered unaided):

| Checkpoint | Class | Evidence or reason |
|---|---|---|
| The four-question reflection UI and the 予定 vs 実績 causal trace actually render | AI-verifiable | Already verified: HPM-02-S04 `Result` records a Chromium headless run through five years showing the four-indicator delta, per-department causal trace and all four reflection prompts, with no console errors |
| Q2 配分 — can the player explain how they prioritised limited talent budget, and why? | Human evidence already exists | 取締役Labo survey, 2026-08-23: participants reported obtaining the learning of prioritising placement and reskilling under limited resources |
| Q1 目標, Q3 時間差, Q4 結果 | Human-only | The survey collected general impressions and improvement requests; it did not put these three questions to participants. Human evidence covers what was actually observed, and no more |

**Result:** the gate is real but far narrower than it was written. One of four checkpoints is already evidenced, and the AI-verifiable portion was complete twelve days before the gate was last touched.

**Action taken:** the task stays `Blocked`, but the Blocker was rewritten to name only the residual — confirm Q1/Q3/Q4 with participants at the next training session — with the satisfied portions and their evidence recorded in `Result`. The Owner is asked for three questions rather than an open-ended "verify the game is understandable".

**Why narrowing matters even when the gate survives:** an unscoped gate is unschedulable. "Verify comprehensibility in a training session" has no defined completion, so it drifts; "ask participants these three questions and record the answers" fits into a session that is happening anyway. Narrowing converts a stalled dependency into a scheduled one.

## What the first inventory pass found

The pre-check was applied on 2026-08-24 to every open `Type = Human Request` and every task `Blocked` for a Human reason — 28 records in total. Four were false gates; the rest were correct and left alone.

Every false gate had the same shape: **a Human act completed, and the record that pointed at it was never updated.** None of them were caused by a Human failing to act.

| Pattern | Count | Signature |
|---|---|---|
| Parent stalled on a child that had already completed | 3 | The Blocker names a specific task; that task is `Done` |
| Gate opened because one agent's connector could not reach the evidence | 1 | The `Approach Decision` says the AI "could not retrieve" something, rather than that a person is required |

Two consequences follow, and both are now rules:

- **Check the named dependency first.** A Blocker that names a task or request is verified with one lookup. This makes clearing stale gates cheap enough to do daily, which is the only reason the standing re-evaluation is affordable.
- **A satisfied Human gate does not mean the task is Done.** In two of the four cases the Human portion was complete but AI work remained, so the correct move was to return the task to `Ready` with the residual AI work named — not to close it, and not to leave it Blocked. Blocked and Done are both wrong answers for "the person finished; the machine has not started".

## Reading the three cases together

| | Case 1 | Case 2 | Case 3 |
|---|---|---|---|
| Human act already performed and recorded? | Yes | No | Partly |
| AI-verifiable portion completed before asking? | N/A — nothing left | Yes, the form content was pre-drafted | Yes, twelve days earlier |
| Outcome | Gate removed, task completed | Gate kept unchanged | Gate kept, scope reduced to the residual |

The pre-check does not decide in advance that Humans are unnecessary. It decides that a Human gate must be justified by the absence of evidence, and that the absence must be established by searching rather than assumed by inheritance.
