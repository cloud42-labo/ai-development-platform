# R06｜プロジェクト管理規程

> **文書区分:** 規程  
> **規程ID:** R06  
> **承認権者:** Owner  
> **施行日:** 2026-09-06 JST  
> **最終改定日:** 2026-09-06 JST  
> **関連規程:** R01 組織規程 / R02 職務権限規程 / R03 決裁規程 / R04 文書管理規程 / R05 システム開発管理規程  
> **移管元:** `docs/operating-guide.md` §1、§7、§8、§9、§10、§11、§13、§14

## 第1条 目的

本規程は、Product / Epic / Story / Task / Sprintの管理、Task粒度、Refinement、進捗、完了、Superseded、Human GateおよびPortfolio可視化の基本を定め、AIを含む組織の実行を小さく検証可能な単位で継続的に制御することを目的とする。

## 第2条 管理階層

業務は原則として次の階層で管理する。

1. **Product** — 継続的に価値を提供・改善する管理単位。
2. **Epic** — Productの目的達成に必要な大きな成果または変化。
3. **Story** — Epicの成果を利用者・業務価値の単位へ分解したもの。
4. **Task** — AIまたはHumanが単独で実行・検証できる具体的な作業単位。
5. **Sprint** — 一定期間に集中して進めるReady workの集合。

現在状態はNotionを正本とし、R04に従う。

## 第3条 Task粒度

1. Task / Subtaskは原則として**1 AI working day以内**で完了できる粒度とする。
2. 可能であれば数十分から数時間で完了する単位へ分割する。
3. 1 Taskは1つのprimary outcome / Definition of Doneを持ち、独立して実装・検証・Review可能であることを原則とする。
4. 1日を超える見込み、複数の独立した設計論点、複数の異なる失敗領域を持つ場合は、着手前またはRefinement時に分割する。
5. 大きな成果・複数日にまたがる目的はStory / Epicで管理し、巨大Taskで保持しない。
6. Task粒度不適合が実行中に判明した場合は、元Taskを無理に完了扱いせず、必要に応じて `Superseded / Split` として後続Taskへ分割する。

## 第4条 Task状態

Taskは少なくとも次の状態を使い分ける。

- **Backlog** — 未精査または未着手。
- **Ready** — Definition of Readyを満たし、実行可能。
- **In Progress** — 実作業中。
- **Review** — 成果物または判断のReview中。
- **Done** — Acceptance Criteriaと完了記録を満たして完了。
- **Blocked** — 現在の必須条件が満たせず停止。
- **Superseded** — 分割・設計変更等により元Taskを実行単位として継続しない。

状態遷移の現在値はNotionで管理する。

## 第5条 着手管理

Task着手前に、少なくとも次を確認する。

1. 対象Taskが存在し、Product / Epic / Storyとの関係が適切である。
2. Acceptance Criteriaと対象成果物が明確である。
3. StatusがReadyまたは有効なIn Progress継続である。
4. Blockerが解消済みである。
5. Assigned Agentと職務権限がR01 / R02に適合する。
6. `Status = In Progress`、`Started At`および必要なTime Eventを実作業前に記録する。

詳細な実行pre-flightは下位基準・手順で管理する。

## 第6条 Definition of Ready

TaskをReadyとするには、原則として次を満たす。

1. Product / Epic / Story等の配置が明確である。
2. 目的またはUser Storyが記載されている。
3. Acceptance Criteriaが検証可能である。
4. 依存関係と対象Repository / 正本が明確である。
5. Assigned Agentおよび必要なRole / authorityが明確である。
6. 外部一次情報確認、Human-only条件、環境制約等、着手前に把握すべき条件が明確である。
7. Task粒度が第3条を満たす。
8. 必要なApproach Reviewが完了している。

詳細なDoR判定は下位基準として管理する。

## 第7条 Approach Review

1. Task着手前に、Howが目的・Acceptance Criteria・依存関係・権限・Task粒度に適合するかを確認する。
2. Approach Reviewは、単なる承認ではなく、誤った実行方法や過大Taskを着手前に検出する管理点とする。
3. 実行中に同一領域の substantive finding が繰り返される場合は、パッチ継続ではなくApproach Refinementへ戻る。
4. 同一領域で**3 substantive review rounds**に達した場合は、Task粒度と設計前提を必ず再評価する。
5. Review roundの詳細上限・例外条件は下位Review基準で管理する。

## 第8条 Backlog Refinement

Backlog Refinementでは、少なくとも次を確認する。

1. Product Vision → Epic → Story → Taskの目的・整合性。
2. Epic / Story / Taskの依存関係と実行順序。
3. Taskの配置、重複、陳腐化、不必要な作業。
4. Priority、Blocker、Human Gate。
5. Task粒度とApproachの妥当性。
6. 次Sprintへ入れるReady候補。
7. 外部Platform / Serviceの公式変更が現行前提を壊していないか。

構造Reviewが未完了のEpic / Story配下で、TaskのHowだけを先行承認しない。

## 第9条 Sprint運用

Weekly Sprintは、原則として次の順で管理する。

1. **Upstream Change Review** — 公式一次情報から外部前提の変化を確認する。
2. **Sprint Review** — 成果、未完了、Blockerを確認する。
3. **Retrospective** — Keep / Problem / Tryと改善入力を記録する。
4. **Backlog Refinement** — 構造とHowを再評価する。
5. **Sprint Close** — 未完了項目の扱いを明示してSprintを閉じる。
6. **Sprint Goal Review** — 新しい事実に基づきGoalを再評価する。
7. **Sprint Planning** — Ready workから次Sprintを構成する。

実行Howは `cloud42-labo/skills` の `weekly-sprint` Compositeおよび構成Skillを正本とし、Scheduler / Routineには詳細手順を重複保持しない。

## 第10条 Sprint Planning

1. Sprintへ入れる項目は原則としてReadyであること。
2. Sprint Goalと各Taskの関係を説明できること。
3. Human Gate、依存関係、Reviewer capacityその他の既知制約を考慮する。
4. 未完了Taskを自動的に次Sprintへcarry overしない。Sprint Closeで継続、分割、Backlog戻し、Superseded等を明示する。
5. Refinementの結果、上位構造または外部前提が変わった場合はSprint Goal自体を見直す。

## 第11条 ReviewとRefinement

1. Review findingsは品質改善だけでなく、Task粒度、設計、要求の誤りを検知するSensorとして扱う。
2. 同一領域のReview修正が連続する場合、Taskをそのまま延命せず、Approach / scope / evidence modelを見直す。
3. Taskの目的自体を変える必要がある場合は、元TaskをSupersededとして適切な後続Taskへ分ける。
4. Reviewを無制限の設計探索にしない。一定roundでRefinementへ戻す管理条件を下位基準に持つ。
5. Review / merge権限はR02、開発品質GateはR05に従う。

## 第12条 Superseded

Taskを分割・置換する場合は、DoneではなくSupersededを用いる。

1. 元Taskに `Closure Reason = Superseded` を記録する。
2. `Closed At`を記録し、`Completed At`はDone専用として扱う。
3. 後続Taskとの `Split From` / `Superseded By` 関係を保持する。
4. 元Taskで発生した作業時間・Review cost・失敗証跡は元Taskの記録として保持する。
5. 分割前の失敗を消去して成功Taskだけに見せない。

## 第13条 BlockedとHuman Gate

1. Blockedは、**現在の遷移**に必要な条件が満たせない場合だけ使用する。
2. AIで検証・実行できる事項をHuman理由のBlockedにしない。
3. Human GateはR03の基準に従い、Acceptance Criterion単位で最小化する。
4. 後工程だけのHuman-only条件を、現在の開発・Review・mergeを止める理由にしない。
5. Human Gateは定期的に再評価し、証拠が到着したら速やかに解除する。
6. Human Queueは高コストな例外処理としてWIPを管理し、AIで縮小できる準備・代替作業を優先する。

## 第14条 Definition of Done

TaskをDoneとするには、原則として次を満たす。

1. Acceptance Criteriaが満たされている。
2. 必須テスト、Review、品質Gateが対象Repository / R05に従って完了している。
3. unresolved P0/P1がない。
4. 必要な正本文書・仕様同期が完了している。
5. `Result`に成果・証跡・PR / commit等を記録している。
6. 必要なTask Time Eventが存在し、実作業区間が完結している。
7. `Completed At`を記録している。
8. Statusを最後にDoneへ変更する。
9. Task自身のAcceptance Criteriaに必要なHuman / 他Agent作業が残っていない。

詳細なDoD判定は下位基準として管理する。

## 第15条 Time Eventと管理計測

1. Task Time Eventsは、Task実行のActive / Waiting / Review等を把握する管理Sensorとして扱う。
2. Time EventをHumanの勤務時間申告や監視目的のtimesheetとして扱わない。
3. 実測できない作業時間を推測・捏造しない。
4. Active Time、Waiting Time、Review Fix等の計測は、Bottleneck、Review cost、Task sizing failureその他の管理改善に利用する。
5. 計測の不整合を見つけた場合は、データを都合よく補正するのではなく、生成・状態遷移・証跡モデルを修正する。

## 第16条 Portfolio Dashboard

1. Vibe Product Development top pageはDashboardであり、Policy manualではない。
2. 現在のStatus、Priority、Sprint、Health等は可能な限りNotionのlive dataから表示する。
3. 手作業で複製した進捗数値・固定Priorityを正本として維持しない。
4. Dashboardは現在位置、注視点、主要link、重要な可視化に集中する。

## 第17条 Portfolio Health

Portfolio Healthは手動評価ではなく、Priority、Status、期限、依存関係その他の正本状態から導出する客観的Signalとする。

Healthが不適切な場合は、Health値を手修正するのではなく、元となるPriority、Status、Target、Due Date、Relation等を修正する。

詳細なHealth判定条件は下位基準として管理する。

## 第18条 記録

Product / Epic / Story / Task / Sprintの現在状態、Result、Timestamp、Decision等はR04に従いNotionを正本とする。GitHubは成果物・PR・Review・commit等の技術証跡を保持し、双方を必要なlinkで接続する。
