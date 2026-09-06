# R05｜システム開発管理規程

> **文書区分:** 規程  
> **規程ID:** R05  
> **承認権者:** Owner  
> **施行日:** 2026-09-06 JST  
> **最終改定日:** 2026-09-06 JST  
> **関連規程:** R01 組織規程 / R02 職務権限規程 / R03 決裁規程 / R04 文書管理規程 / R06 プロジェクト管理規程  
> **移管元:** `docs/operating-guide.md` §3、§4、§6、§9、§10、§11

## 第1条 目的

本規程は、Ideaから継続運用Productまでのシステム開発ライフサイクル、Stage / Gate、設計・実装・レビュー・ReleaseおよびHuman Gateの管理原則を定め、価値仮説から運用品質まで一貫した統制を行うことを目的とする。

## 第2条 StageとGate

1. **Stage**は作業を進める状態をいう。
2. **Gate**は次のStageへ進むための判定条件をいう。
3. Gateは曖昧な承認儀式ではなく、次工程へ進めるだけの具体的証拠が揃ったかを判定する管理点とする。
4. AIが確認可能な条件を理由なくHuman承認へ置き換えない。Human-onlyのGateはR03に従う。
5. Gateの詳細判定条件は、本規程に基づく基準として管理できる。

## 第3条 開発ライフサイクル

標準ライフサイクルは次の7 Stageとする。

1. **Stage 1: Idea** — 課題、対象ユーザー、価値仮説を明確化する。
2. **Stage 2: Vibe** — UI / 操作体験を含む動くデモで価値仮説を具体化する。
3. **Stage 3: Experimental** — GitHub上で試作コードを保持し、追加検証する。
4. **Stage 4: Project** — Vision、Roadmap、Epic、Story、Sprint、Acceptance Criteria等を整備し、正式な開発管理対象にする。
5. **Stage 5: Development** — 設計、実装、テスト、レビューおよび品質確認を行う。
6. **Stage 6: Release Candidate** — 実機、利用体験、運用、セキュリティ、継続性その他のRelease条件を確認する。
7. **Stage 7: Product** — 継続提供、運用、計測、改善を行う正式Productとする。

## 第4条 Gate

標準Gateは次のとおりとする。

1. **Gate 1: Vibe移行判定** — 画面や操作体験を作って検証する価値があるか。
2. **Gate 2: Experimental移行判定** — デモが動作し、主要操作を確認でき、試作コードとして保持する価値があるか。
3. **Gate 3: Project移行判定** — 正式な開発Projectとして継続する価値があるか。
4. **Gate 4: Development移行判定** — Product Vision、要求、Acceptance Criteria、依存関係、対象Repository等、開発開始条件が揃っているか。
5. **Gate 5: Release Candidate移行判定** — Acceptance Criteria、必要なテスト、レビューおよび品質条件を満たし、重大な未解決問題がないか。
6. **Gate 6: Product化判定** — 継続提供する価値と品質があり、運用・改善を継続できるか。

Product Planning以降へ進むProductは、当該Productへ関連付いたApproved状態のProduct Visionを持つことを原則とする。

## 第5条 Product設計文書

Software Productは、必要に応じて次の耐久成果物を維持する。

1. **Product Vision = Why** — 誰のどの課題を、なぜ解くか。
2. **Inception Deck = Starting Alignment** — Product開始時の目的、Scope、Stakeholder、Risk、Trade-off等の初期整合。
3. **PRD = What** — 対象ユーザー、Use Case、機能・非機能要求、成功指標、対象外、制約。
4. **Design Doc = How** — UX / Core Loop、Architecture、Data Model、主要設計判断、Constraints、Known Issues、Current Specification。
5. **Epic Brief = Change Unit** — 当該Epicで何を変えるか、成果、対象外、関連要求、設計影響、主要Risk。

要求変更はPRD、設計変更はDesign Docへ同期し、Epic完了時および重大な変更時に現行実装と正本文書を一致させる。

## 第6条 開発開始

Developmentへ着手する前に、少なくとも次を確認する。

1. 対象Product / Epic / Story / TaskとAcceptance Criteriaが特定されている。
2. 対象Repositoryと正本が明確である。
3. 必要な依存関係、制約および外部仕様が確認されている。
4. 外部SDK、Library、Service等に依存する場合は、実装前に最新の一次情報を確認する。
5. 担当主体と職務権限がR01 / R02に照らして有効である。
6. Taskの実行粒度、状態、開始記録その他のProject管理条件がR06を満たす。

詳細なDefinition of Readyは下位基準として管理する。

## 第7条 実装およびScope管理

1. 実装は承認済みの目的、TaskおよびAcceptance Criteriaの範囲内で行う。
2. 不明点を推測で埋めてScopeを拡張しない。
3. 実装中に別の独立した目的・設計論点が判明した場合は、R06に従ってTask分割またはRefinementを行う。
4. Durable artifact、code、specification等の正本はR04に従う。
5. 実装Agentは、R02に定めるmerge authorityおよびRepository固有ルールに従う。

## 第8条 Reviewおよび品質Gate

1. Reviewの要否、独立性およびmerge authorityはR02と対象Repositoryの有効ルールに従う。
2. 独立Reviewが必須の場合、AuthorとReviewerを分離する。
3. 指定Reviewerが利用不能な場合は、R02に従って独立性を保ったReviewerへフェイルオーバーできる。
4. unresolved P0/P1、失敗した必須CI、現在の遷移に明示的に適用される未完了の必須検証がある状態ではmergeしない。
5. merge対象headがReview後に変わった場合は、必要な差分を再Reviewする。
6. Reviewが実質的な設計探索を繰り返す場合は、単なる修正継続ではなくR06に定めるApproach Refinement / Task粒度再評価へ戻す。

P2以下の扱い、Review round上限その他の詳細条件は下位Review基準で管理できる。

## 第9条 Human Gate

1. Human RequestまたはHuman理由によるBlockedは、R03のHuman Gate条件を満たす場合だけ設定する。
2. AIがNotion、GitHub、CIその他の接続可能な情報から検証できる事項をHuman確認へ移管しない。
3. Human-only条件が後工程だけの条件である場合、当該条件を現在の遷移へ前倒しして開発・mergeを停止しない。
4. Accountable ReviewerまたはOwnerが現在の遷移に明示的に設定したGateは、同等以上の権限者が改訂するまで維持する。
5. 実機、本人性、契約・支払、実ユーザー評価その他のHuman-only項目は、必要な遷移に限定した独立Taskとして管理できる。

## 第10条 Release Candidate

Release Candidateでは、Productの性質に応じて次を確認する。

1. 実装された機能とAcceptance Criteriaの一致。
2. 必須テスト、CI、Security / Privacyその他の品質条件。
3. 必要な実機・環境固有の検証。
4. 運用可能性、Monitoring、Recovery、継続提供条件。
5. PRD / Design Doc等の正本が実装済み仕様と同期していること。

Human-onlyの検証が必要な場合はR03に従う。

## 第11条 Product化および継続改善

Product化後も、仕様・品質・運用状態を固定物として扱わず、R06のSprint / Refinementにより継続的に改善する。

重大な方向転換ではProduct Vision、PRD、Design Docその他の上位成果物を再評価し、必要に応じて適切なStage / Gateへ戻す。

## 第12条 Definition of Done

開発TaskのDoneは、少なくとも次を満たすことを原則とする。

1. Acceptance Criteriaを満たす。
2. 必須テストが成功している。
3. 対象Repositoryで必要なReview / final judgmentが完了している。
4. unresolved P0/P1がなく、必須CIおよび現在の遷移に必要な検証が完了している。
5. 必要な仕様・文書同期が完了している。
6. NotionのResult、Time Event、Completed At、Status等の完了記録がR06 / R04に従って整合している。

詳細なDefinition of Doneは下位基準として管理する。

## 第13条 例外

本規程のGateまたは開発権限に対する例外は、R02 / R03に従う。例外は対象・理由・期限または終了条件を記録し、他Product / Repositoryへ無限定に一般化しない。
