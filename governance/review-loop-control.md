# Review Loop Control Standard

> **文書区分:** 基準 / Guardrail  
> **適用規程:** R02 職務権限規程 / R05 システム開発管理規程 / R06 プロジェクト管理規程  
> **適用開始:** 2026-09-06 JST  
> **移管元:** ADP-056 / PR #25 の未移管残差

## 1. 目的

独立Reviewを無制限の設計探索にせず、Review costを管理信号としてApproach Refinement・Task分割へ戻す条件を定める。

Reviewer availability、Author≠Reviewer、merge authority、reviewed SHAとmerge headの一致、P0/P1・CI・mergeability・Human/device/environment GateはR02/R05の現行規程に従い、本基準では重複定義しない。

## 2. Substantive review round

Review roundは、独立Reviewerが1つのrevisionを実際に評価し、findingまたはclean verdictを返したときに1回として数える。

- usage limit、platform outage、connector failure等でReview結果が生成されなかった呼出しはroundに数えない。
- trivial commit、Reviewer変更、fallback Reviewerへの切替だけではround countをresetしない。
- round countはPR番号ではなく、同一のchange objective / Task目的に追随する。
- Refinementの結果として意図的にTask/PRを分割し、NotionにSplit / Superseded判断を記録したreplacement PRは、新しい独立change objectiveとしてcountを開始できる。

## 3. Round 3 — Approach Refinement trigger

同一subsystem、state transition、invariant、migration、retry/failure mode、provenance modelその他の同一領域について、3 substantive roundsまで新規findingが継続した場合は、patch-by-patch修正を停止してApproach Refinementへ戻る。

この時点で少なくとも次を再評価する。

1. Task / Subtaskが1 AI working day以内の粒度か。
2. 設計前提、state-transition / failure matrix、evidence modelが不足していないか。
3. 1 Taskに複数の独立した失敗領域・設計論点が混在していないか。
4. 粒度不適合なら、元TaskをDoneにせずSuperseded / Splitとして後続Taskへ分割すべきか。

詳細なTask粒度・Superseded管理はR06に従う。

## 4. Round 5 — default hard cap

同一change objectiveに対するsubstantive review roundは**5回をdefault hard cap**とする。

- 5回目までにP0/P1が解消しない、または新規findingが継続する場合、6回目のautomated / AI reviewを惰性的に要求しない。
- **第6回以降のsubstantive reviewはOwnerの明示承認が必要**である。
- Owner承認がない場合は、Approach Refinement、Task/PR分割、設計変更、要求・証拠モデルの再整理のいずれかへ戻る。
- hard cap到達はquality waiverではない。unresolved P0/P1、failed required CI、未完了の必須Gateを残したままmergeしてよい理由にはならない。

## 5. Reviewer unavailable時

Reviewer利用不能時の独立fallbackはR02に従う。fallbackはround countをresetしない。

Reviewer usage limitは、Owner承認なしの追加credit、plan upgrade、metered APIその他の有料capacity変更を許可しない。

## 6. 記録

Approach Refinement triggerまたはhard capに到達した場合、Notion Task / ResultまたはPR discussionへ最低限次を記録する。

- substantive round count
- 同一領域で繰り返されたfindingの要約
- Refinement / Split / Continueの判断
- 第6回以降を実施する場合はOwner承認の証跡

本基準はReview回数そのものを成果指標にしない。目的はReview costからTask sizing・設計・要求の問題を早期検知し、より小さく検証可能な実行単位へ収束させることである。
