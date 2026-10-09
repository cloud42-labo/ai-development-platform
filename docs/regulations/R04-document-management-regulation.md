# R04｜文書管理規程

> **文書区分:** 規程  
> **規程ID:** R04  
> **承認権者:** Owner  
> **施行日:** 2026-09-06 JST  
> **最終改定日:** 2026-10-05 JST  
> **関連基準:** `governance/source-of-truth.md` / `governance/postmortem-improvement-loop.md`  
> **関連手順:** `cloud42-labo/skills`  
> **移管元:** `docs/operating-guide.md` §1、§5、§13 / `governance/source-of-truth.md`

## 第1条 目的

本規程は、Vibe Product Developmentにおける文書、業務状態、判断記録、成果物および組織記憶の正本を明確にし、重複、ドリフト、古い記録による誤動作を防止することを目的とする。

## 第2条 文書階層

文書および記録は次の4階層で管理する。

1. **規程** — 組織として守る正式ルール。権限・責任・統制の基本を定める。
2. **基準** — 規程を適用するための判定条件、品質条件、数値条件その他の判断基準。
3. **手順** — 規程・基準に従って業務を実行する具体的なHow。
4. **記録** — 実行した事実、現在状態、判断、レビュー、変更履歴、学習その他の証跡。

規程、基準、手順および記録を同一の意味で扱わない。特に、記録に残された過去の判断を現行Policyとして自動的に再利用してはならない。

## 第3条 正本の基本原則

情報種別ごとの正本は次のとおりとする。

| 情報種別 | 正本 | 主な内容 |
|---|---|---|
| 規程・基準・耐久的ADP成果物 | `cloud42-labo/ai-development-platform` | 規程、基準、統制、Architecture、Template、Capability Map等 |
| 実行手順 | `cloud42-labo/skills` | Backlog Refinement、Sprint、Human Gate等のExecutable Skill |
| Product固有コード・テスト・仕様・Release | 各Product GitHub Repository | source code、tests、CI、technical spec、release、PR履歴 |
| Demo Entry Point / 人間向け配布入口 | Google DriveのProduct別Demo領域 | `latest` から現在の実行可能DemoまたはDemo URLへ到達するためのcontrolled distribution surface |
| 現在の業務状態・実行記録 | Notion | Product、Epic、Story、Task、Sprint、Priority、Status、Timestamp、Result、Blocker、Demo URL等 |
| 判断記録 | Notion Decisionまたは対象Task | 何を決めたか、理由、対象範囲、日時 |
| 組織記憶 | `cloud42-labo/brain` | journal、lesson、context、historical rationale、learning |

正本は「どこに一番詳しく書いてあるか」ではなく、**どのSystemの値を現行の公式値として更新するか**で決定する。

## 第4条 GitHub

GitHubは、版管理、差分確認、レビューおよび変更履歴を必要とする耐久成果物の正本とする。

1. 規程、基準、仕様、コード、テスト、Architecture、Template等はGitHub上でdiff可能な形を原則とする。
2. 規程本文の制定・改定はPull Request / commit履歴を残す。
3. GitHub上の古いbranch、closed PR、過去commitは履歴であり、現在有効な規程または仕様とは限らない。
4. Product固有成果物は当該Product Repositoryを正本とし、ADP Repositoryへ無制御に複製しない。
5. 公開Repositoryには、公開を意図しない秘密情報、credential、token、個人情報、会社機密その他の保護情報を保存しない。

## 第5条 Notion

Notionは、現在の業務状態、実行状態および判断記録の正本とする。

1. Product / Epic / Story / Task / SprintのStatus、Priority、Timestamp、Result、Blocker等の現在値はNotionで管理する。
2. Git履歴から現在のTask StatusやSprint状態を推測してNotionの代替正本としてはならない。
3. 日報、Sprint Review、Retrospective、Human Requestその他の業務記録はNotionに保持する。
4. Decisionは、結論・理由・対象・時点を残す判断記録としてNotionに保持する。
5. NotionのDashboardやTop Pageは現在状態への入口であり、規程本文の唯一の正本とはしない。

## 第5条の2 Demo Entry Pointと配布面

Google DriveはProductコードやReleaseの正本ではなく、Humanが現在のDemoへ迷わず到達するための**Demo Entry Point / controlled distribution surface**として使用する。

1. Demoを持つProductは、原則としてProductごとのGoogle Drive Demo領域に `latest` を持ち、Humanが最初に参照する入口とする。
2. `latest` の実体はProduct特性に応じて、APK、HTML / ZIP、GitHub Pages、Cloud Runその他のDemo URL、Google Play test導線等を利用できる。
3. 配布方式そのものは統一しない。統一するのは、`latest` から現在の実行可能Demoへ到達できることである。
4. Source code、tests、CI、technical spec、release、PR履歴の正本は引き続き各Product GitHub Repositoryとし、Google Driveをコード正本として扱わない。
5. NotionはTask / Productの運用状態と、必要な `Demo URL` / Demo Entry Point参照を保持する。配布物そのものをNotionへ重複保存しない。
6. Demo対象Taskの完了判定はR05のDemo Delivery Completion Gateに従う。

## 第6条 規程類のNotion閲覧面

規程類はHumanも日常的に参照するため、GitHubのみで管理してNotionから読めない状態にしない。

1. **版管理上の正本はGitHub**とする。
2. **NotionはHuman向けの規程集・閲覧面**として、現在有効な規程本文を読みやすい形で同期表示する。
3. Notionの規程ページには、対応するGitHub正本への参照を明記する。
4. GitHubとNotionの規程本文に差異が生じた場合は、GitHubのmerge済み有効版を優先し、Notionを速やかに再同期する。
5. Notion上の規程本文を単独で編集して恒久Policyを変更したことにしてはならない。改定はGitHub正本へ反映して完了する。
6. 規程改定TaskのDefinition of Doneには、必要なNotion閲覧面の同期確認を含める。

このNotion同期は、無制御な文書複製ではなく、Human向け閲覧面として意図的に維持するcontrolled copyとする。

## 第7条 DecisionとPolicy

1. Decisionは「何を、なぜ、その時点で決めたか」を残す記録であり、規程そのものではない。
2. Ownerが恒久的なRule変更をDecisionまたはTaskで明示した場合、当該判断は変更の根拠となるが、担当主体は該当規程・基準・手順へ速やかに反映する。
3. Decisionだけを残して規程改定を未実施のまま恒久運用してはならない。
4. 過去Decisionと現在有効な規程が矛盾する場合、現在有効な規程を通常の行動ルールとして適用する。ただしOwnerの最新の明示指示が当該事項を変更している場合は、その指示を適用し、規程同期を行う。

## 第8条 brainとMemory

`cloud42-labo/brain`は組織記憶の正本であり、Policyの正本ではない。

1. journal、notes、decisions、projects、areasその他のbrain記録は、学習、経緯、仮説、設計理由、過去の判断を保持する。
2. Memoryは新しいTaskや規程検討の入力として利用できるが、現行規程を上書きしない。
3. 再利用価値のある学習を恒久ルール、基準、手順または設計成果物へ昇格する場合は、対象の正本へ意図的に移管する。
4. brain内のファイル名や配置だけを理由に、当該記録をPolicyとして扱わない。

5. OwnerとChris / Claudeその他の実行主体との会話・作業から、次回以降の判断を変える決定、仮説、設計原則、再利用可能な学び、重要な前提変更、未決論点が生じた場合は、会話履歴だけに依存せずbrainへ組織記憶として記録する。
6. 前項の記録は会話の逐語録ではなく、元会話を知らない次回実行主体が判断を再開できる最小限のdurable deltaとして要約する。単純なStatusやTask状態はNotion、Policy/Artifactは各GitHub正本へ残し、brainへ無制御に複製しない。
7. managed-workの完了時は、durable deltaの有無を明示的に判定し、`Brain Capture = Updated` または `Brain Capture = No durable delta` のいずれかを完了証跡へ残す。deltaありの場合はbrainへの反映を確認するまで完了扱いにしない。
8. Daily Closeその他の定期Close処理では、当日のNotion/GitHub上の重要な判断・学習・前提変更とbrain更新を照合し、記憶化漏れを補償する。会話履歴へ直接アクセスできない実行環境では、その面の完全性を推測せずcoverage gapとして記録する。

## 第9条 Skills

`cloud42-labo/skills`は実行手順の正本とする。

1. Skillは規程・基準で定められたPolicy / judgmentを具体的な実行Howへ変換する。
2. Skillは上位規程に存在しない新しい権限、承認GateまたはPolicyを独自に作らない。
3. 規程・基準の変更によって手順が変わる場合は、関連Skillも同期する。
4. Schedule / RoutineはWhenを担い、Skill本文の詳細手順を重複保持しないことを原則とする。

## 第10条 Repository固有実行指示

`AGENTS.md`、`CLAUDE.md`その他のRepository固有ファイルは、当該Repositoryでの実行指示として扱う。

1. 上位規程・基準・手順を当該Repositoryへ適用するための具体的な制約を記載できる。
2. 上位規程に反する恒久Policyを独自に作らない。
3. 規程変更で内容が陳腐化した場合は、関連Taskで速やかに同期する。

## 第11条 変更履歴

1. 規程・基準・手順・仕様その他の耐久成果物は、可能な限りGit履歴で制定・改定・廃止の差分を追跡できる状態にする。
2. 規程本文には施行日および最終改定日を明記する。
3. 改定理由、議論、レビュー経緯は本文へ無制限に累積せず、Notion Decision / TaskおよびGitHub PR履歴で追跡する。
4. merge済み成果物のURL、PR、commit等を関連TaskのResultへ記録する。
5. 現在値と履歴を混同しない。履歴が残っていることは、その内容が現在有効であることを意味しない。

## 第12条 記録保持

1. Task、Decision、PR、Review、Time Event、Sprint記録、journal等は、組織活動の証跡として原則保持する。
2. 完了・Superseded・Cancelled等の履歴は、現行状態と区別したうえで保持する。
3. 古い記録を消して現在の整合性を作るのではなく、現行正本を明確化し、履歴として残すことを原則とする。
4. 秘密情報、個人情報、法令・契約・セキュリティ上の削除要件がある場合は、本条より当該要件を優先する。

## 第13条 重複と同期

1. 同一情報について恒久的な複数正本を作らない。
2. 別Systemに表示が必要な場合は、正本とcontrolled copy / referenceの関係を明示する。
3. 同期対象に差異を検出した場合は、どちらが正本かを先に確認し、正本から閲覧面・派生情報へ同期する。
4. AIは、古い複製を発見した際に推測で両方を編集するのではなく、正本境界に従って是正する。

## 第14条 優先順位

規範文書間の優先順位は、`docs/regulations/README.md`に定める規程体系に従う。

原則は、**規程 → 基準 → 手順 → Repository固有実行指示 → 記録**の順とする。

記録は重要な証拠であるが、それ自体を現行規程より上位のRule sourceとして扱わない。