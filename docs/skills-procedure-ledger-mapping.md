# Skills → Notion 手順書台帳 マッピング (ADP-066-T01)

> **Artifact status:** durable reference。ADP-066「SkillsをNotion手順書台帳からGitHub SSoTへ同期する運用」の
> T01 成果物。T02 以降（台帳構築・同期 Adapter・移行）が追加判断なしに着手できることを目的とする。
> 調査時点: 2026-09-29 JST、`cloud42-labo/skills` main `0f228d4`。

## 1. 前提（変えない原則）

ADP-066 Story の設計原則に従う。GitHub `cloud42-labo/skills` の merge 済み有効版を SSoT とし、
Notion は Human-readable な authoring / controlled copy に限る（R04 第9条「`cloud42-labo/skills` は
実行手順の正本」と整合）。Notion 編集だけでは施行せず、GitHub merge を Effective の境界とする。
差異があれば GitHub を正とする。

## 2. 棚卸し結果

### 2.1 対象範囲

| 区分 | 件数 | 扱い |
|---|---|---|
| `.claude/skills/*/`（自作 Skill） | **27** | 手順書台帳の対象 |
| `vendor/*/`（第三者） | 4（hyperresearch / japanese-tech-writing / cognitive-rhythm-writing / write-a-prd） | 同期対象外。一覧・参照のみ（下記 2.4） |
| `config/`（Registry データ） | 2（`scheduled-skills.yaml` / `external-security-skills.json`） | 手順書ではなく構成データ。GitHub 管理のまま（2.5） |

全 27 件が `SKILL.md` を持つ。frontmatter のキーは全件 `name` と `description` の 2 つだけで、
**Version / Status / 改定日時を持つ Skill は 0 件**（3.2 の含意を参照）。

### 2.2 自作 Skill 一覧

`refs` = `references/` のファイル数、`scripts` = `scripts/` のファイル数、`行` = SKILL.md の行数、
`最終変更` = `0f228d4` 時点で、そのディレクトリに触れた最新コミット（短縮 SHA と UTC 日付。全履歴で確認）。
`Actor` の根拠は 2 つだけとする: (a) `config/scheduled-skills.yaml` の `actor`、(b) `SKILL.md` 本文の明示記述。
どちらも無いものは `共通`（どの Actor からも呼べる）とし、推測で具体名を入れない。

**A. Sprint / Backlog 運用ループ（11）**

| Skill | 種別 | Actor | 用途（要約） | 行 | refs | scripts | 最終変更 |
|---|---|---|---|---|---|---|---|
| weekly-sprint | Composite | ChatGPT（registry: mon-08:00） | 週次マネジメントループ全体の実行 | 251 | 0 | 0 | e8484c2 09-22 |
| upstream-change-review | Atomic | 共通 | AI ベンダー公式変更の影響判定 | 105 | 0 | 0 | 1d25055 09-06 |
| sprint-review | Atomic | 共通 | 直前 Sprint の成果を証拠ベースで評価 | 71 | 0 | 0 | c426f0c 09-02 |
| sprint-retrospective | Atomic | 共通 | 未達・手戻りの構造的原因分析 | 62 | 0 | 0 | c426f0c 09-02 |
| backlog-refinement | Composite | 共通 | MISC 収束と Product→Task 再配置 | 415 | 0 | 1 | e8484c2 09-22 |
| hierarchical-refinement | Atomic | 共通 | Vision→Epic→Story→Task の階層妥当性検証 | 293 | 0 | 0 | c38e288 09-22 |
| task-approach-review | Atomic | 共通 | Task の How 確定（Analyze / Finalize） | 291 | 0 | 0 | e8484c2 09-22 |
| task-state-reconcile | Atomic | 共通 | terminal 後の依存解放と Story 完了判定 | 161 | 0 | 0 | e8484c2 09-22 |
| sprint-close | Atomic | 共通 | 旧 Sprint の正式クローズ | 83 | 0 | 0 | e8484c2 09-22 |
| sprint-goal-review | Atomic | 共通 | 次 Sprint Goal の維持・変更・廃棄判断 | 67 | 0 | 0 | c426f0c 09-02 |
| sprint-planning | Atomic | 共通 | Goal に対する実行計画の作成 | 139 | 0 | 0 | e8484c2 09-22 |

**B. 日次運用 / Control Plane / ゲート（7）**

| Skill | 種別 | Actor | 用途（要約） | 行 | refs | scripts | 最終変更 |
|---|---|---|---|---|---|---|---|
| daily-close | Atomic | ChatGPT（registry: 23:00） | In Progress=0 への収束 | 63 | 0 | 0 | e8484c2 09-22 |
| canonical-consistency-check | Atomic | ChatGPT（registry: 23:00） | Registry / Scheduler / Notion の 3 者照合 | 76 | 0 | 0 | 56d35dc 09-27 |
| adp-daily-report | Atomic | ChatGPT（registry: 05:00） | 前日分の共同日報作成・検証 | 50 | 0 | 0 | 49139cd 09-20 |
| scheduled-skill-dispatcher | Atomic | 共通 | 定時窓で実行対象を決める Trigger Bus | 77 | 0 | 4 | 0f228d4 09-28 |
| pr-flow-gate | Atomic | ChatGPT（Control Plane） | Open PR 全件の分類と MERGE_READY 先行処理 | 198 | 0 | 0 | 7bdf953 09-22 |
| pr-review-convergence | Atomic | 共通（Codex 指摘の収束） | PR レビューラリーの収束・Merge Gate | 243 | 0 | 0 | 01f3920 09-24 |
| human-gate-preflight | Atomic | 共通 | Human Request 作成前の AC 分類 | 139 | 0 | 0 | e8484c2 09-22 |

**C. 出版 / ドメイン（3）**

| Skill | 種別 | Actor | 用途（要約） | 行 | refs | scripts | 最終変更 |
|---|---|---|---|---|---|---|---|
| aod-book-writing | Domain | 共通 | AOD 記事・書籍本文の執筆規範 | 215 | 0 | 0 | 56d35dc 09-27 |
| note-publish | Domain | 共通（Human handoff を生成） | note 公開の Human handoff 定型化 | 326 | 0 | 0 | 1da4e0c 09-23 |
| business-control-tree | Domain | 共通 | 事業統制ツリーの因果分解 | 434 | 0 | 0 | 29fe2d1 09-26 |

**D. 開発・個人ツール（6）**

| Skill | 種別 | Actor | 用途（要約） | 行 | refs | scripts | 最終変更 |
|---|---|---|---|---|---|---|---|
| adp-bootstrap | Bootstrap | 共通 | ADP パッケージの Install / Upgrade | 196 | 2 | 4 | 9043914 09-16 |
| brain-setup | Bootstrap | Claude Code | 個人知識ベースの新規セットアップ | 146 | 0 | 1（+`assets/` 42、`evals/` 1） | 1ad3797 07-31 |
| to-prd | Atomic | 共通 | 実装前 PRD の作成 | 133 | 0 | 0 | 623874b 07-29 |
| to-project | Atomic | 共通 | 会話からプロジェクト計画書を作成 | 198 | 0 | 0 | b95e2a3 07-25 |
| vibe-pipeline | Composite（手順書） | Claude Code / Gemini CLI | vibe coding → Cloud Run の 4 フェーズ | 123 | 1 | 0 | e263622 08-23 |
| external-security-skill-selector | Atomic | 共通 | 外部防御セキュリティ Skill の検索 | 79 | 0 | 4 | b95b384 09-26 |

合計: SKILL.md 27、references 3 ファイル（adp-bootstrap 2、vibe-pipeline 1）、scripts 14 ファイル
（brain-setup の 1 を含む）、Skill 内の非 SKILL.md/references/scripts ファイルは brain-setup の 43（`assets/` 42、`evals/` 1）のみ。

### 2.3 Skill 間の依存

Composite が Atomic を名前で呼ぶ。台帳の「関連 Skill」列の元データになる。主な辺:

- `weekly-sprint` → upstream-change-review, sprint-review, sprint-retrospective, backlog-refinement,
  task-state-reconcile, sprint-close, sprint-goal-review, sprint-planning（+ hierarchical-refinement,
  task-approach-review）
- `backlog-refinement` → task-approach-review, hierarchical-refinement, task-state-reconcile,
  sprint-goal-review, aod-book-writing
- `scheduled-skill-dispatcher` → pr-flow-gate, canonical-consistency-check, task-state-reconcile
- `daily-close` → sprint-review, task-approach-review, task-state-reconcile
- `vibe-pipeline` → to-prd

他 Skill への言及（依存）は 27 件中 19 件が持つ。**Skill 名の rename・delete は依存元の本文にも波及する**ため、
同期ルール（T04 以降）で rename/delete を扱うとき、依存元 Skill の一括検出が要る。
他 Skill への言及が 0 の Skill（8 件）: adp-bootstrap, aod-book-writing, brain-setup, business-control-tree,
external-security-skill-selector, sprint-review, to-prd, to-project。このうち他 Skill から名前を言及される
（被依存）のは aod-book-writing / sprint-review / to-prd で、adp-bootstrap / brain-setup / business-control-tree /
external-security-skill-selector / to-project は依存も被依存も 0。

### 2.4 vendor の扱い

第三者成果物のため PoC 同期対象外（ADP-066 スコープ記載どおり）。台帳には「参照のみ」の別区分で
持てるようにする。

| vendor | 現状 |
|---|---|
| hyperresearch | リポジトリ丸ごと（`.github` 等を含む）。`pip install` 前提で `.claude/skills/` へ直接リンクしても動かない |
| japanese-tech-writing | gist コピー。推敲モード限定の条件付き採用（ADP-031-B） |
| cognitive-rhythm-writing | gist コピー。ADP ゲートには未組み込み（ADP-031-B） |
| write-a-prd | 自作 `to-prd` に置換済み。参考として残置 |

### 2.5 Skill ではないが `skills` repo にあるもの

- `config/scheduled-skills.yaml` — Scheduled Skill Registry。`skill_id` 9 件のうち、
  **SKILL.md が repo に存在するのは `adp-daily-report` / `weekly-sprint` / `canonical-consistency-check` /
  `daily-close` の 4 件**。`claude-daily-execution` / `brain-weekly-review` / `skills-weekly-review` /
  `control-plane` / `aod-production` の 5 件は、Routine 側の責任として ID だけあり、手順書の実体が
  この repo に無い（Registry 冒頭コメントにも「documented, not executable from this repo」とある）。
  台帳化するかは 4 章の判断事項。
- `config/external-security-skills.json` — Skill 本文ではなく外部 Skill の参照 registry。構成データ。

## 3. Notion 手順書台帳の項目（確定）

### 3.1 必須項目

| # | 項目 | Notion 型 | 由来 / 書き込み主体 | 備考 |
|---|---|---|---|---|
| 1 | Skill ID | Title（unique） | `SKILL.md` の `name` = ディレクトリ名 | rename は「新規 + 旧 Superseded」で扱う（3.3） |
| 2 | 名称 | Text | Skill ID の日本語表示名 | Human 向け。同期対象外 |
| 3 | 目的 | Text | `description` の前半（何をするか） | 同期方向は GitHub→Notion のみ |
| 4 | 適用条件 | Text | `description` の後半（いつ起動するか） | 同上。`description` は起動判定を決めるため編集は PR 経由 |
| 5 | 対象 Actor | Multi-select（ChatGPT / Claude / Codex / Gemini CLI / 共通 / Human handoff） | 2.2 の分類を初期値とする。`vibe-pipeline` は `Claude` と `Gemini CLI`（SKILL.md が明示） | registry の `actor` と一致確認 |
| 6 | 本文 | ページ本文 | `SKILL.md`（frontmatter 除く） | 編集可能な唯一の面。Notion→GitHub の対象 |
| 7 | 関連規程・基準 | Relation | R01–R06、各 Quality Standard | 手動維持 |
| 8 | Status | Select: Draft / Review / Effective / Superseded / Deprecated | Notion 上の本文の状態。定義は 3.2 | Adapter が 3.2 の表に従って更新 |
| 9 | Version | Text | **main 上の Effective version** = 有効 commit の短縮 SHA | frontmatter に version が無いため。未 merge の版は入れない（3.2） |
| 10 | GitHub path | URL | `.claude/skills/<id>/SKILL.md` | 派生値。手で編集させない |
| 11 | PR | URL | Review 中は未 merge の同期 PR、それ以外は直近に merge した PR | 同期 Adapter が書く |
| 12 | commit | Text | **有効 commit** = main 上でこの Skill を最後に変更した commit の SHA | merge 後に Adapter が書く。PR の head SHA は入れない |
| 13 | 改定日時 | Date（時刻付き） | 有効 commit の merge 時刻（JST） | Adapter が書く |
| 14 | 同期状態 | Select: In Sync / Notion Ahead / GitHub Ahead / Conflict / Sync Failed | Adapter が有効 commit・有効本文 hash と、現在の Notion 本文・main の HEAD を比較して算出 | 3.2 |
| 15 | 有効本文 hash | Text | main 上の `SKILL.md` 本文（frontmatter 除く）の SHA-256 | merge 後に Adapter が書く。Notion 本文の hash は同期のたびに計算し、保存しない |

### 3.2 追加項目と Status / Version の定義

- **種別**（Atomic / Composite / Domain / Bootstrap）— 2.2 で分類済み。Composite は変更影響が大きく
  レビュー強度を変える根拠になる。
- **関連 Skill**（自己 Relation）— 2.3 の依存辺。
- **付属物**（refs / scripts / assets の件数と GitHub パス）— 責任境界（3.3）を台帳側で可視化する。
- **Registry ID** — registry の `skill_id` との対応（該当する 4 件のみ埋まる）。

**Effective の定義（確定）:** Effective なのは **GitHub main 上にある版だけ**。Notion で編集中の本文、および
PR が未 merge の本文は、Notion にどれだけ書かれていても Effective ではない（proposed）。Version（#9）・
有効 commit（#12）・有効本文 hash（#15）には、main に merge 済みの値だけを入れる。未 merge の Notion 本文の
hash と PR の head SHA は、台帳に保存しない。

現行 Skill は frontmatter に `version` / `status` を持たない。frontmatter に足すと 27 件全部の `SKILL.md` に
触れ、起動判定に使われる `name` / `description` の周辺を変えることになる。したがって **初期は GitHub 側を
変更せず**、Version は有効 commit の短縮 SHA として Notion 側だけで持つ。frontmatter への version 追加は
同期が安定してから別 Task で判断する。

**Status・Version・commit・有効本文 hash・同期状態の組み合わせ:**

| ケース | Status | 同期状態 | Version / 有効 commit / 有効本文 hash | PR（#11） |
|---|---|---|---|---|
| Notion 本文が main の有効版と一致 | Effective | In Sync | main の値 | 直近に merge した PR |
| Notion で本文を編集中（PR 未作成） | Draft | Notion Ahead | **変更しない**（直前の有効版のまま） | 直近に merge した PR |
| 同期 PR を作成済み・未 merge | Review | Notion Ahead | **変更しない** | 未 merge の PR |
| PR を merge した直後（Notion 未反映） | Review のまま | GitHub Ahead | 更新前の値のまま。Adapter が再同期して更新 | merge 済みの PR |
| Adapter が反映を完了 | Effective | In Sync | 新しい main の値 | merge 済みの PR |
| GitHub 直接修正で main が進んだ | 変更しない | GitHub Ahead | 更新前の値のまま。Adapter が再同期して更新 | 変更しない |
| Notion の編集と main の変更が同時にある | Draft / Review のまま | Conflict | 変更しない。GitHub を正として人間に提示 | 変更しない |
| 同期処理が失敗 | 変更しない | Sync Failed | 変更しない | 変更しない |
| Notion で新しい Skill を起票（main に無い） | Draft / Review | Notion Ahead | **空**（Effective な版が存在しない） | 未 merge の PR、または空 |
| main で Skill が削除・置換された | Superseded / Deprecated | In Sync | 削除・置換前の最後の値 | 削除・置換の PR |

不変条件: (1) Status = Effective のとき、Notion 本文は台帳に記録した有効版（有効 commit / 有効本文 hash）と一致している。
(2) Version・有効 commit・有効本文 hash は、Adapter が merge 済みの main から読んだ値だけを書く。
(3) 同期状態が In Sync 以外のとき、Effective なのは main の版であって Notion の本文ではない。

### 3.3 GitHub / Notion の責任境界

| 対象 | 実体の置き場（SSoT） | Notion に持つもの | 編集の流れ |
|---|---|---|---|
| `SKILL.md` frontmatter（`name` / `description`） | GitHub | 目的・適用条件の**表示コピー** | GitHub のみ編集。Notion は読み取り専用 |
| `SKILL.md` 本文 | GitHub（有効版） | ページ本文（controlled copy） | Notion 編集 → Adapter が PR 生成 → Review / Merge → Notion に commit 反映 |
| `references/*` | GitHub | 存在・用途・GitHub リンクの一覧（本文は複製しない） | GitHub のみ。SKILL.md から相対参照されるため Notion 側で内容を編集させない |
| `scripts/*` | GitHub | 存在・用途・GitHub リンク（実行成果物のため） | GitHub のみ。テスト同梱（`test_*.py`）を壊さない |
| `assets/`（42）・`evals/`（1）（brain-setup のみ） | GitHub | 存在の記録のみ | GitHub のみ。references / scripts の 2 分類に当てはまらない第 3 の種別として明示 |
| Registry（`config/*`） | GitHub | 台帳の対象外 | Notion「Job Schedule」ページとの 3 者照合は既存の `canonical-consistency-check` が担う |

`name` / `description` を Notion 編集の対象から外す理由: `description` は「いつ Skill が起動するか」を
決める文字列で、誤編集は実行時の起動漏れ・誤起動に直結する。本文より一段厳しいレビューを要求する
価値がある。

## 4. T02 以降への引き継ぎ（確定事項）

以下は ADP-066-T01 の決定であり、T02 以降で再判断しない。変更が要る場合は新しい Task で行う。

1. **Routine 責任 5 件は台帳の対象外とする。** 対象は `claude-daily-execution` / `brain-weekly-review` /
   `skills-weekly-review` / `control-plane` / `aod-production`。`.claude/skills/` に `SKILL.md` の実体が
   無いため、今回の「Skill 手順書台帳」には載せない。これらは Registry（`config/scheduled-skills.yaml`）と
   Notion「Job Schedule」で管理する。
2. **PoC 対象 Skill は `to-project` とする。** 根拠: 他 Skill への言及 0、他 Skill からの言及 0、
   references 0、scripts 0で、壊しても他 Skill への波及が最小。`sprint-review` は他 Skill 7 本から
   言及されるため PoC 対象にしない。Composite（`weekly-sprint`）・scripts 付き・被言及の多い Skill も
   対象にしない。
3. **`brain-setup` の `assets/`（42 ファイル）・`evals/`（1 ファイル）は「存在の記録のみ」とする。**
   3.3 のとおり。PoC の対象にしない。
4. **rename / delete の検出。** 2.3 のとおり依存元本文にも波及する。Adapter は Skill 名の変更・削除を
   検出したとき、依存元 Skill の一覧を PR 本文に出す。
5. **GitHub 直接編集との競合。** 直近の変更が 2026-09-22〜09-28 に集中しており（27 件中 17 件が
   9/22 以降）、GitHub 直接編集の頻度は高い。設計原則 4「緊急修正は GitHub を正として Notion に戻す」を
   既定とし、同期状態 `GitHub Ahead` は Adapter が Notion を再同期する。`Notion Ahead` と `GitHub Ahead` が
   同時に立つ場合は `Conflict` とし、GitHub を正として人間に提示する（3.2 の表）。
6. **merge の権限と手順は、最新の policy と PR Flow Gate に従う。** この文書は merge 権限を決めない。
   確認済みの事実は `governance/agent-policy.yaml` の `github-protected-merge`（`decision: approve`、
   承認者の指定なし）だけである。同期 Adapter の実装 PR と、Adapter が生成する Skill 変更 PR は、
   どちらも作成時点の最新の policy・各リポジトリの運用文書・`pr-flow-gate` に従って扱う。
   `skills` repo の merge 権限も、この文書では断定しない。

## 5. 受け入れ基準との対応

| AC | 対応 |
|---|---|
| 1) `.claude/skills` 全件棚卸し（名前・SKILL.md・references・scripts・Actor・用途） | 2.2 |
| 2) vendor を自作から分離 | 2.1, 2.4 |
| 3) 台帳の必須項目確定 | 3.1（必須 15 項目）、3.2（Status・Version・commit・hash の定義） |
| 4) SKILL.md 本文・references・scripts の Notion/GitHub 責任境界 | 3.3 |

## 6. 再現手順（棚卸しの根拠）

```bash
cd skills
ls .claude/skills                                   # 27 ディレクトリ
find .claude/skills -name SKILL.md | wc -l          # 27
find .claude/skills -path '*/references/*' -type f  # 3 ファイル
find .claude/skills -path '*/scripts/*' -type f     # 14 ファイル
git log --format='%h %ad' --date=short -1 -- .claude/skills/<skill>   # 最終変更
```

依存辺は、各 `SKILL.md` に他 Skill の名前が単語境界付きで現れるかの grep で機械抽出した。
言及と実際の呼び出しは区別していない（言及のみの辺を含み得る）。
