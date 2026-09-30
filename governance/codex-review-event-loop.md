# Codex Review Event Loop

> **文書区分:** 基準 / Event-driven control  
> **適用規程:** R02 職務権限規程 / R05 システム開発管理規程 / R06 プロジェクト管理規程  
> **関連基準:** [review-loop-control.md](review-loop-control.md)  
> **導入Task:** ADP-054-T21 / ai-development-platform#82

## 1. 目的

PRのreview findingを修正してpushした後、Humanまたは実装Agentが `@codex review` を手入力する待ち工程をなくす。

正常系を次へ統一する。

```text
Review Fix完了
  -> fix commit push / PR head SHA更新
  -> GitHub PR commit-update event
  -> current-head Codex re-review request
  -> Codex review result
       -> Evidence-backed blockerあり: 既存実装TaskへReview Fix handoff
       -> blockerなし: PR Flow Gate / Merge Gate
  -> authorityを満たすfinal integratorがmerge
```

この基準はreview品質基準を弱めない。Finding Admission Gate、Disposition Coverage=100%、delta-first re-review、review round hard cap、Author != Reviewer / mergerはそのまま適用する。

## 2. Normal path

### 2.1 Initial review

PRの初回reviewはCodex Automatic Reviewを利用する。Draft PRをReadyへ移した時点の自動reviewを正常系とし、同じheadに対する重複requestを作らない。

### 2.2 Review Fix push

実装Agentはcurrent headへ適用可能なFindingを全件Dispositionし、`Disposition Coverage = 100%` を確認してからfix commitをpushする。

push後は次を実行Evidenceとして扱う。

- `Expected Review Head = <current head SHA>`
- `Review Trigger = commit_update_event`
- `Review State = awaiting_event_request`
- `Disposition Coverage = 100%`

実装Agent自身がHumanの手入力を前提に待たない。

### 2.3 Commit-update event -> review request

ChatGPT WorkのGitHub PR event taskはcommit updateを受け、対象PRを再取得してcurrent headを確定する。

review request送信前に必ず次を満たすこと。

1. PRがopenかつnon-draft。
2. event head SHAがGitHub current headと一致する。
3. current headに対するCodex reviewがまだ存在しない。
4. 同一headのrequest markerが存在しない。
5. [review-loop-control.md](review-loop-control.md) のreview-round Gateが次roundを許可している。

許可される場合だけ、PR conversationへ次を1回投稿する。

```text
<!-- adp-codex-review-request:v1 head=<HEAD_SHA> round=<NEXT_ROUND> source=work-event -->
@codex review

Re-review the current head. Prioritize resolution of prior blocking findings and the delta since the previous reviewed head. Follow the repository AGENTS.md Finding Admission Gate; do not create blocking findings for style, nits, general best practices, or unrelated refactors.
```

このmarkerをhead単位のidempotency keyとする。同じheadへ同じrequestを再送してはならない。

### 2.4 Review result -> route

Codex review/review-thread activityを受けたevent taskは、reviewed SHAとGitHub current headが一致することを確認する。古いheadのreviewで状態遷移してはならない。

Findingは各repositoryのAGENTS.md Finding Admission Gateで評価する。

- Evidence-backed blockerあり:
  - PRを `REVIEW_FIX` として扱う。
  - 元の実装TaskをReview Fixとして実行可能状態へ戻す。
  - 単にCodex結果を待つためだけの `*-R<n>` Review Taskを新規作成しない。
- Evidence-backed blockerなし:
  - `pr-flow-gate` を再評価する。
  - CI / mergeability / policy-level gate / final integrator条件を満たせば `MERGE_READY` へ進める。

routing済みEvidenceをPRに残す場合は次を使う。

```text
<!-- adp-codex-review-route:v1 head=<HEAD_SHA> verdict=<review_fix|clean> -->
```

同一head / verdictがroute済みなら何もしない。

## 3. Trigger-miss fallback

Work event taskが未設定・停止・event missした場合でも、PRを無期限にWAITING_REVIEWへ残さない。

Chrisの `pr-flow-gate` はnon-draft PRについて、current head更新から30分以上経過しても次を両方満たす場合を `WAITING_REVIEW(event_trigger_missed)` とする。

- current-head Codex reviewが無い
- 同一headの `adp-codex-review-request` markerが無い

この場合だけreview-round Gateを再確認し、許可されるならChrisが同一形式のrequestを `source=pr-flow-fallback` として1回投稿する。

request markerが存在するのにreview結果だけが無い場合はtrigger missではない。Reviewer latency / availabilityとして扱い、重複requestを送らない。

## 4. Manual request policy

Work event taskがActiveかつ正常に稼働している環境では、Humanが通常運用として `@codex review` を入力しない。

明示的なmanual requestを許すのは次だけ。

- Work event taskが未導入の環境
- Work event taskが停止・利用不能
- trigger missをcurrent evidenceで確認し、自動fallbackも実行不能
- Ownerが特定roundへのmanual requestを明示指示した

manual requestでもreview-round hard capは回避できない。

## 5. Work event task configuration

### Trigger

ChatGPT WorkでGitHub pull request activityをevent triggerとして設定する。

対象イベント:

- pull request commit updates
- pull request reviews / review activity

対象はADP管理下の `cloud42-labo` implementation repositories。利用UIでrepository filterを設定できない場合は、task promptでorganization/repository scopeを検証し、対象外eventはno-opにする。

### Task prompt

```text
Operate the ADP Codex Review Event Loop for this GitHub pull-request event.

First fetch the PR and current head SHA. Ignore events outside the authorized cloud42-labo implementation repositories.

For a commit-update event:
1. Require the PR to be open and non-draft.
2. If a Codex review already covers the current head, do nothing.
3. If the PR conversation already contains
   <!-- adp-codex-review-request:v1 head=<CURRENT_HEAD> ... -->
   do nothing.
4. Count substantive review rounds for the same change objective and enforce the ADP default hard cap of 5. Do not request round 6+ without explicit Owner approval for that round.
5. Confirm the linked implementation Task has Disposition Coverage=100% when this is a Review Fix push. If not, do not request review; route back to the implementation Task.
6. Post exactly one request marker plus @codex review for the current head, source=work-event. Ask Codex to verify prior blocking findings and the delta first and to follow repository AGENTS.md Finding Admission Gate.

For a Codex review/review-thread event:
1. Require reviewed SHA == current PR head SHA; otherwise no-op.
2. Evaluate findings using repository AGENTS.md. Severity alone is not a blocker.
3. If an evidence-backed blocker remains, route the existing implementation Task to Review Fix. Do not create a passive review-wait Task.
4. If no evidence-backed blocker remains, run/re-evaluate the ADP PR Flow Gate. If all CI, mergeability, policy and authority gates pass, progress to the correct final integrator / MERGE_READY path.
5. Be idempotent per PR + head SHA + verdict. Never send a duplicate review request for the same head.

Never use a metered external OpenAI API, never expose secrets, never bypass Author != Reviewer/merger, and never bypass the review-round hard cap.
```

## 6. Rollout gate

この基準をmergeしただけではWork event taskがActiveになったとは扱わない。

導入完了には次のEvidenceが必要。

1. Workで上記event-triggered taskが作成・Enabled。
2. GitHub connectorが対象repositoryのPR activityを受信できる。
3. test/実PRのcommit update 1件でrequest markerが自動投稿される。
4. Codex current-head review結果がreview_fixまたはcleanへrouteされる。
5. Notion Job ScheduleへActive状態と責務が反映される。

これらが揃うまでは `work_event_trigger_enabled = false` と扱い、既存Control Plane fallbackを維持する。

## 7. Observability

月次KMIまたはTask Resultで最低限次を観測できること。

- event-trigger review requests
- pr-flow fallback review requests
- duplicate request prevented
- event trigger missed
- reviewer latency
- head更新からreview requestまでの時間
- head更新からcurrent-head review完了までの時間

目的はreview件数を増やすことではなく、**修正push後の無人待ち時間を消し、review loopを自動で次状態へ送ること**である。
