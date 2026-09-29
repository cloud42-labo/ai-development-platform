# Skills → Notion 手順書台帳 マッピング (ADP-066-T01)

> **Artifact status:** durable reference。ADP-066「SkillsをNotion手順書台帳からGitHub SSoTへ同期する運用」の
> T01 成果物。T02 以降（台帳構築・同期 Adapter・移行）が追加判断なしに着手できることを目的とする。
> 調査時点: 2026-09-29 JST、`cloud42-labo/skills` main `0f228d4`。

## 1. 前提（変えない原則）

ADP-066 Story の設計原則に従う。GitHub `cloud42-labo/skills` の merge 済み有効版を SSoT とし、
Notion は Human-readable な authoring / controlled copy に限る（R04 第9条「`cloud42-labo/skills` は
実行手順の正本」と整合）。Notion 編集だけでは施行せず、GitHub merge を有効化の境界とする。
差異があれば GitHub を正とする。したがって台帳では、**GitHub main 上の有効版**と、**Notion に表示されている
controlled copy の状態**を別の軸として持つ（3.2）。

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
この表の `Claude Code` は、台帳の対象 Actor の選択肢 `Claude` に対応する。

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
| pr-review-convergence | Atomic | 共通 | PR レビューラリーの収束・Merge Gate | 243 | 0 | 0 | 01f3920 09-24 |
| human-gate-preflight | Atomic | 共通 | Human Request 作成前の AC 分類 | 139 | 0 | 0 | e8484c2 09-22 |

**C. 出版 / ドメイン（3）**

| Skill | 種別 | Actor | 用途（要約） | 行 | refs | scripts | 最終変更 |
|---|---|---|---|---|---|---|---|
| aod-book-writing | Domain | 共通 | AOD 記事・書籍本文の執筆規範 | 215 | 0 | 0 | 56d35dc 09-27 |
| note-publish | Domain | 共通 | note 公開の Human handoff 定型化 | 326 | 0 | 0 | 1da4e0c 09-23 |
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
同期 Adapter（T03 以降）で rename/delete を扱うとき、依存元 Skill の一括検出が要る。
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
  この 5 件を台帳の対象外とすることは 4 章の確定事項 1。
- `config/external-security-skills.json` — Skill 本文ではなく外部 Skill の参照 registry。構成データ。

## 3. Notion 手順書台帳の項目（確定）

### 3.1 必須項目

| # | 項目 | Notion 型 | 由来 / 書き込み主体 | 備考 |
|---|---|---|---|---|
| 1 | Skill ID | Title（unique） | `SKILL.md` の `name` = ディレクトリ名 | rename は「新規 + 旧 Superseded」で扱う（3.2 規則 3、4 章の確定事項 4） |
| 2 | 名称 | Text | Skill ID の日本語表示名 | Human 向け。同期対象外 |
| 3 | 目的 | Text | `description` の前半（何をするか） | 同期方向は GitHub→Notion のみ |
| 4 | 適用条件 | Text | `description` の後半（いつ起動するか） | 同上。`description` は起動判定を決めるため編集は PR 経由 |
| 5 | 対象 Actor | Multi-select（ChatGPT / Claude / Codex / Gemini CLI / 共通 / Human handoff） | 2.2 の分類を初期値とする。`vibe-pipeline` は `Claude` と `Gemini CLI`（SKILL.md が明示） | registry の `actor` と一致確認 |
| 6 | 本文 | ページ本文 | `SKILL.md`（frontmatter 除く） | 編集可能な唯一の面。Notion→GitHub の対象 |
| 7 | 関連規程・基準 | Relation | R01–R06、各 Quality Standard | 手動維持 |
| 8 | Status | Select: Draft / Effective / Superseded / Deprecated | **Skill 単位の有効性**（GitHub main 上に有効版があるか）。Notion 本文の状態は表さない（3.2） | Adapter が 3.2 の表に従って更新 |
| 9 | Version | Text | #12 の短縮 SHA（**最終同期した有効版**） | frontmatter に version が無いため。#12 から導出し、独立に編集しない。未 merge の版は入れない（3.2） |
| 10 | GitHub path | URL | `.claude/skills/<id>/SKILL.md` | 派生値。手で編集させない |
| 11 | PR | URL | 直近の同期 PR の URL | 同期 Adapter が書く。open / merged / closed は GitHub から都度取得し、台帳には保存しない |
| 12 | commit | Text | **最終同期 commit** = 最終同期時点で main 上に、その Skill のディレクトリ `.claude/skills/<id>/` を最後に変更した commit の SHA | merge 後の同期で Adapter が書く。PR の head SHA と repository の HEAD SHA は入れない |
| 13 | 改定日時 | Date（時刻付き） | #12 の commit が main に入った時刻（JST） | Adapter が書く |
| 14 | 同期状態 | Select: In Sync / Notion Ahead / PR Open / GitHub Ahead / Conflict / Sync Failed | **Notion 本文と main 上の有効版の関係**。Adapter が Skill 単位で算出する（3.2 の判定規則） | repository 全体の HEAD は比較に使わない |
| 15 | 同期本文 hash | Text | 最終同期時点の main 上の `SKILL.md` 本文（frontmatter 除く）の SHA-256 | 同期のたびに Adapter が書く。Notion 本文の hash は判定のたびに計算し、保存しない |

### 3.2 状態モデル（Status・Version・commit・hash・同期状態）

#### 追加項目（任意。台帳の可読性のため）

- **種別**（Atomic / Composite / Domain / Bootstrap）— 2.2 で分類済み。Composite は変更影響が大きく
  レビュー強度を変える根拠になる。
- **関連 Skill**（自己 Relation）— 2.3 の依存辺。
- **付属物**（refs / scripts / assets の件数と GitHub パス）— 責任境界（3.3）を台帳側で可視化する。
- **Registry ID** — registry の `skill_id` との対応（該当する 4 件のみ埋まる）。

#### 2 つの軸を分ける

1 列の Status では「GitHub 上の有効版」と「Notion に表示されている本文の状態」を同時に安全に表せない。
Notion 本文が古いまま `Effective` と表示されるからである。そこで軸を分ける。

| 軸 | 項目 | 何を表すか |
|---|---|---|
| A. GitHub 上の有効版 | #8 Status、#9 Version、#12 commit、#13 改定日時、#15 同期本文 hash | Skill が有効か。最後に同期した有効版はどれか |
| B. Notion 本文の状態 | #14 同期状態（と #11 PR） | Notion に表示されている本文が、その有効版と一致するか |

- **有効版は常に GitHub main 上の版**。Notion の本文は、同期状態が `In Sync` のときだけ有効版と同じ内容である。
  それ以外の状態では、Notion 本文は「提案」または「有効版より古い / 競合中」であり、有効版として扱わない。
- **Status（#8）は Skill 単位の有効性**: `Draft`＝main 上に有効版がまだ無い（Notion で新規起票した Skill）。
  `Effective`＝main 上に有効版があり施行中。`Superseded`＝別の Skill に置き換えられた。`Deprecated`＝廃止された。
  Notion 本文の編集や PR の有無では変わらない。旧 `Review` は Status から外し、同期状態 `PR Open` で表す。
- #9・#12・#13・#15 は **最終同期した有効版**を記録する。値は Adapter が merge 済みの main から読んだものだけである。
  未 merge の Notion 本文の hash と PR の head SHA は保存しない。同期状態が `GitHub Ahead` の間、これらは main の
  現在版より古い。現在の有効版は常に main である。
- Notion の Skill ページには、同期状態が `In Sync` 以外のとき、先頭に「この本文は有効版ではありません（<同期状態>）。
  実行には GitHub の `SKILL.md` を参照してください」の表示を Adapter が付ける。`In Sync` に戻ったら外す。
  この表示は本文の外（ページ先頭の Adapter 管理ブロック）に置き、`N_hash` の計算から除外する。除外しないと、表示を付けただけで
  Notion 本文が「編集された」と判定される。

#### 同期状態の判定規則（Skill 単位）

Skill ごとに評価する比較キーは次の 5 つである。状態の判定には hash の 3 つ（`M_hash`・`L_hash`・`N_hash`）、その Skill のパスの有無、
その Skill の同期 PR の状態だけを使う。commit の 2 つ（`M_commit`・`L_commit`）は、メタデータを更新する必要があるかの判定にだけ使う。
**repository 全体の HEAD SHA は比較に使わない。**

| 記号 | 内容 |
|---|---|
| `M_hash` | current main 上の `.claude/skills/<id>/SKILL.md` の本文 hash |
| `M_commit` | current main 上で `.claude/skills/<id>/` を最後に変更した commit |
| `L_hash` | 台帳の同期本文 hash（#15） |
| `L_commit` | 台帳の最終同期 commit（#12） |
| `N_hash` | 現在の Notion 本文 hash（判定のたびに計算） |

hash は同じ正規化（UTF-8、改行 LF、frontmatter 除去、末尾の空白・改行の正規化）の後に計算する。

上から順に評価し、最初に当たったものを採る。

1. main または Notion を読めない、または `N_hash` を計算できない → **Sync Failed**（他の項目は変えない）。
2. 台帳に `L_hash` が無い（まだ一度も同期していない）:
   - `.claude/skills/<id>/` が main に**ある**（初回取り込み、または Notion で起票した新規 Skill の PR が merge された後）:
     `N_hash = M_hash` なら `L_*` を main の値で埋め、Status を `Effective` にして **In Sync**。
     `N_hash ≠ M_hash` なら **Conflict**（Notion 本文は上書きしない）。
   - main に**ない**（Notion で起票した新規 Skill）: Status = `Draft`。同期 PR が open なら **PR Open**、なければ **Notion Ahead**。
3. `.claude/skills/<id>/` が main に無い（削除・置換）→ Status を `Deprecated`（置換先が特定できる rename なら `Superseded`）にし、
   同期状態は **In Sync**（台帳は最後の有効版で凍結）。
4. `M_hash = N_hash` → **In Sync**。`L_hash ≠ M_hash` なら（PR の merge 直後など）`L_hash` := `M_hash` に更新する。
5. `N_hash = L_hash`（Notion は最終同期から未変更）かつ `M_hash ≠ L_hash`（main が先に進んだ）→ **GitHub Ahead**。
   Adapter は Notion 本文を `M_hash` の内容に置き換え、#9・#12・#13・#15 を更新して **In Sync** にする。Notion に未同期の編集が無いので、失うものは無い。
6. `M_hash = L_hash`（main は未変更）かつ `N_hash ≠ L_hash`（Notion だけ編集）→ 同期 PR が open なら **PR Open**、
   open でなければ **Notion Ahead**。PR が open の間に Notion がさらに編集された場合、Adapter は新しい PR を作らず、同じ PR のブランチを更新する。
7. 上のどれにも当たらない（`M_hash ≠ L_hash` かつ `N_hash ≠ L_hash` かつ `M_hash ≠ N_hash`）→ **Conflict**。
   Notion 本文は上書きしない。解決は 2 択: (a) GitHub を採る（Notion を `M_hash` の内容に置き換え、`L_*` を更新）、
   (b) Notion の編集を、最新の main を土台にした新しい同期 PR として出し直す。

`M_commit ≠ L_commit` かつ `M_hash = L_hash` のとき（`references/`・`scripts/`・frontmatter だけの変更）は、
本文は同じなので状態は変えない。Adapter は #12・#13、付属物、目的・適用条件の表示コピーだけを更新する。
別の Skill の commit で repository の HEAD が進んでも、その Skill の `M_hash`・`M_commit` は変わらないので、
状態は変わらない。

#### ケース別の状態

| ケース | Status | 同期状態 | #9 / #12 / #15 | Notion 本文の扱い |
|---|---|---|---|---|
| 1. In Sync | Effective | In Sync | main の値と一致 | 有効版と同じ。表示なし |
| 2. Notion で編集中（PR なし） | Effective | Notion Ahead | 変更しない | 「提案」と表示 |
| 3. PR 作成済み・未 merge | Effective | PR Open | 変更しない | 「提案（PR 未 merge）」と表示 |
| 4. PR を merge した直後、Notion は未同期 | Effective | PR Open のまま（次の同期で規則 4 により In Sync） | 次の同期で main の値に更新 | 本文は merge された内容と同じ |
| 5. Adapter が同期を完了 | Effective | In Sync | main の値に更新 | 表示を外す |
| 6. GitHub で直接変更（Notion は旧本文） | Effective | GitHub Ahead → 規則 5 で自動再同期 | 再同期で更新。それまでは旧値 | 再同期までの間「有効版より古い」と表示 |
| 7. Notion の編集と main の変更が競合 | Effective | Conflict | 変更しない | 上書きしない。「競合」と表示 |
| 8. Adapter が失敗 | 変更しない | Sync Failed | 変更しない | 「同期失敗」と表示。有効版は GitHub を参照 |
| 9. Notion で新規 Skill を起票（main に無い） | Draft | Notion Ahead / PR Open | 空（有効版が無い） | 「提案」と表示。merge 後の同期で Effective になる |
| 10. main で Skill が削除・置換された | Deprecated / Superseded | In Sync | 最後の有効版で凍結 | 「廃止 / 置換済み」と表示 |

#### 不変条件

1. #9・#12・#13・#15 は、Adapter が merge 済みの main から読んだ値だけを持つ。未 merge の版は入らない。
2. Status は Skill の有効性だけを表す。Notion 本文の編集・PR の有無・同期の失敗で Status は変わらない。
   変わるのは main 上の Skill の追加・削除・置換だけである。
3. Notion 本文が有効版と同じ内容であるのは、同期状態が `In Sync` のときだけである。それ以外の状態では 3.2 の表示を付ける。
4. 同期状態は、その Skill の `M_hash`・`L_hash`・`N_hash`、その Skill のパスの有無、その Skill の同期 PR の状態だけから決まる。repository の HEAD や、他の Skill の commit の影響を受けない。
5. GitHub Ahead を Notion の編集内容の損失なしに自動再同期できるのは、`N_hash = L_hash`（Notion が未変更）の場合だけである。
   Notion に未同期の編集がある場合は必ず Conflict にする。

#### frontmatter に version を持たせない理由

現行 Skill は frontmatter に `version` / `status` を持たない。追加すると 27 件全部の `SKILL.md` に触れ、
起動判定に使われる `name` / `description` の周辺を変えることになる。したがって **初期は GitHub 側を変更せず**、
Version は #12 の短縮 SHA として Notion 側だけで持つ。frontmatter への version 追加は、同期が安定してから
別 Task で判断する。

#### 必須項目が 15 件である理由

#15 同期本文 hash は、Notion 本文の編集と GitHub 本文の変更を、commit の変更（`references/` や frontmatter だけの変更を含む）
から分けて検出するために必要である。Notion 側には「本文が最終同期から変わったか」を確かめる信頼できる印が無いため、
最終同期時の本文 hash と比較する。Notion 本文の hash は判定のたびに計算するので、項目は増やさない。

### 3.3 GitHub / Notion の責任境界

| 対象 | 実体の置き場（SSoT） | Notion に持つもの | 編集の流れ |
|---|---|---|---|
| `SKILL.md` frontmatter（`name` / `description`） | GitHub | 目的・適用条件の**表示コピー** | GitHub のみ編集。Notion は読み取り専用 |
| `SKILL.md` 本文 | GitHub（有効版） | ページ本文（controlled copy） | Notion 編集 → Adapter が PR 生成（同期状態 `PR Open`）→ Review / Merge（merge 権限は 4 章の確定事項 6）→ 次の同期で Notion に反映（`In Sync`） |
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
   references 0、scripts 0 で、壊しても他 Skill への波及が最小。`sprint-review` は他 Skill 7 本から
   言及されるため PoC 対象にしない。Composite（`weekly-sprint`）・scripts 付き・被言及の多い Skill も
   対象にしない。
3. **`brain-setup` の `assets/`（42 ファイル）・`evals/`（1 ファイル）は「存在の記録のみ」とする。**
   3.3 のとおり。PoC の対象にしない。
4. **rename / delete の検出。** 2.3 のとおり依存元本文にも波及する。Adapter は Skill 名の変更・削除を
   検出したとき、依存元 Skill の一覧を PR 本文に出す。
5. **GitHub 直接編集との競合は 3.2 の判定規則で扱う。** 直近の変更が 2026-09-22〜09-28 に集中しており
   （27 件中 17 件が 9/22 以降）、GitHub 直接編集の頻度は高い。設計原則 4「緊急修正は GitHub を正として Notion に戻す」
   に従い、Notion が未変更なら自動で再同期する（規則 5）。Notion に未同期の編集があるときは、上書きせず `Conflict`
   にして人間に提示する（規則 7）。
6. **merge authority はこの T01 で新設しない。最新の R02 と Repository 固有ルールに従う。** 現在の正本（2026-09-29 時点）は次のとおり。
   - **R02 §4.1（最終改定 2026-09-19）:** `cloud42-labo/skills` は self-merge 可能な Repository である（根拠: Owner 指示 2026-09-12、
     `cloud42-labo/skills/CLAUDE.md`「GitHub操作・PRレビュー・マージ」）。変更種別で self-merge 可否を分けない。
     ただし、未解決の P0/P1、失敗した必須 CI、Repository 固有の必須テスト、現在の遷移に明示的に適用される検証 Gate は無視できない。
     self-merge は `main` への直接 push を標準化するものではなく、Branch → commit → PR → merge の履歴を残す。
   - **R02 §4.2:** self-merge の対象外の Repository（`cloud42-labo/ai-development-platform` を含む）は、Author と最終 merge 担当を分離する。
     Claude が作った PR は、必要な独立レビューの後に Chris が最終確認・merge する。Chris が作った PR は Claude が merge する。
     Owner は通常の merge operator ではない。Repository 固有の明示ルールまたは Owner の明示指示が別の authority を設定した場合は、その範囲で適用する。
   - **`governance/agent-policy.yaml` は merge authority の根拠にしない。** `docs/instruction-skill-debt-inventory.md` が non-authoritative と
     明記している。`github-protected-merge`（`decision: approve`）は一般規則で、Repository 別の self-merge 例外を含まない。例外は R02 にある。
   - **同期 Adapter への帰結:** Adapter が `cloud42-labo/skills` に生成する同期 PR は、その Repository の self-merge authority の対象である。
     ただし上記の品質条件（P0/P1、必須 CI、conflict、Repository 固有 Gate）は維持する。Adapter の実装 PR（`ai-development-platform` 側）は
     R02 §4.2 の Author ≠ merger に従う。Adapter は authority をコードに固定せず、merge の直前に最新の R02 と対象 Repository の固有ルールを
     確認する。この文書は R02 の現在の内容を記録するだけであり、R02 が改定された場合は R02 が優先する。

## 5. 受け入れ基準との対応

| AC | 対応 |
|---|---|
| 1) `.claude/skills` 全件棚卸し（名前・SKILL.md・references・scripts・Actor・用途） | 2.2 |
| 2) vendor を自作から分離 | 2.1, 2.4 |
| 3) 台帳の必須項目確定 | 3.1（必須 15 項目）、3.2（2 軸の状態モデル・同期状態の判定規則・ケース別の状態・不変条件） |
| 4) SKILL.md 本文・references・scripts の Notion/GitHub 責任境界 | 3.3 |

## 6. 再現手順（棚卸しの根拠）

```bash
cd skills
ls .claude/skills                                   # 27 ディレクトリ
find .claude/skills -name SKILL.md | wc -l          # 27
find .claude/skills -path '*/references/*' -type f  # 3 ファイル
find .claude/skills -path '*/scripts/*' -type f     # 14 ファイル
TZ=UTC git log --format='%h %ad' --date=format-local:%Y-%m-%d -1 0f228d4 -- .claude/skills/<skill>   # 最終変更（UTC 日付）
```

最終変更は全履歴が要る。浅い clone（`--depth`）では、履歴の切れ目より前の変更が切れ目のコミットに見えて誤る。
`git fetch --unshallow` してから実行する（この文書の初版はこの誤りで 8 行が不正確だった）。

依存辺は、各 `SKILL.md` に他 Skill の名前が単語境界付きで現れるかの grep で機械抽出した。
言及と実際の呼び出しは区別していない（言及のみの辺を含み得る）。

## 7. T02 / T03 の受け入れテスト（この文書を仕様として実装したときに満たすべき挙動）

| # | シナリオ | 期待される結果 |
|---|---|---|
| 1 | Skill A を commit X が最後に変更した。その後、Skill B だけを commit Y が変更した | A の `M_hash`・`M_commit` は変わらない。A は `In Sync` のまま。`GitHub Ahead` にならない |
| 2 | A が `Effective` / `In Sync`。GitHub main で A の本文だけを直接変更した。Notion は旧本文 | 同期状態は `GitHub Ahead`。Notion 本文は「有効版より古い」と表示され、有効版として扱われない。Notion が未変更なので自動で再同期し `In Sync` に戻る |
| 3 | 2 のとき、Notion にも未同期の編集がある | `Conflict`。Notion 本文を上書きしない |
| 4 | A の `references/` だけを main で変更した | `M_hash = L_hash`。状態は変えず、#12・#13・付属物だけを更新する |
| 5 | Adapter が `cloud42-labo/skills` に同期 PR を生成した | R02 §4.1 と `skills/CLAUDE.md` の self-merge authority を失わない。同時に、P0/P1・必須 CI・conflict・Repository 固有 Gate は維持する |
| 6 | Adapter の実装 PR を `ai-development-platform` に出した | R02 §4.2 の Author ≠ merger に従う |
| 7 | Notion 本文を Markdown に書き出し、正規化しても `L_hash` 時点の内容と一致しない Skill がある | 初回同期で検出し `Sync Failed`（原因: 往復で不一致）とする。状態を推測しない |
| 8 | Notion で新規 Skill を起票し、PR がまだ無い | Status = `Draft`、同期状態 = `Notion Ahead`、#9・#12・#15 は空 |

