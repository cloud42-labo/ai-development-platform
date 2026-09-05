# Vibe Product Development 規程体系

> **文書区分:** 規程体系の正本（Normative Index）  
> **承認権者:** Owner  
> **適用開始:** 2026-09-06 JST  
> **移行状態:** `docs/operating-guide.md` から段階移行中（ADP-059）

## 1. 目的

Vibe Product Development の運用ルールを、AI固有の「Operating Guide」ではなく、一般企業で用いられる社内規程体系に整理する。

Human / AI を別制度として扱わず、Owner、ChatGPT / Chris、Claude、Codex、Gemini 等を、それぞれ役割・権限・責任を持つ**組織上の実行主体**として同じ規程体系の中で扱う。

規程名は原則として一般企業で意味が通じる名称を用いる。「AIだから」という理由だけで専用規程を新設しない。

## 2. 文書階層

| 階層 | 意味 | 正本 / 配置 | 例 |
|---|---|---|---|
| **規程** | 組織として守る正式ルール。権限・責任・統制の基本を定める | `docs/regulations/` | 組織規程、職務権限規程、決裁規程 |
| **基準** | 規程を適用するための判定条件・品質条件・数値基準 | `governance/` を順次整理 | DoR / DoD、Task粒度、Review基準、Human Gate判定基準 |
| **手順** | 規程・基準に従って実際にどう実行するか | `cloud42-labo/skills` | Backlog Refinement、Sprint Planning、Human Gate Pre-check |
| **記録** | 実行した事実、状態、判断履歴、証跡 | Notion / GitHub / `cloud42-labo/brain` | Task、Decision、PR、Time Event、journal |

### 2.1 「規程」と「規定」

- **規程**: ルール体系・文書そのもの。文書名には原則としてこちらを使う。
- **規定**: 規程等の中で具体的に定めた条項・内容、または「定める」という行為を指す。

例: 「職務権限**規程**の第5条で、merge権限を**規定**する」。

### 2.2 Decision と Memory

- Notion Decision は、何を決めたか・なぜ決めたかを残す**判断記録**であり、規程そのものではない。
- `cloud42-labo/brain` は**組織記憶**であり、規程・基準の正本ではない。
- 過去の Decision / brain の記述が現行規程と矛盾するとき、現在の行動ルールとして優先しない。
- `AGENTS.md` / `CLAUDE.md` はRepo固有の**実行指示**であり、規程に反する新しいPolicyを独自に作らない。

## 3. 規程一覧

ADP-059では、既存Operating Guideを次の規程へ分解する。

| ID | 規程 | 主な対象 | 移行Task |
|---|---|---|---|
| R01 | **組織規程** | 組織構成、役割、責任、Owner / Chris / Claude / Codex / Gemini の位置付け | ADP-059-B |
| R02 | **職務権限規程** | 各実行主体が自律実行できる範囲、merge・変更・外部操作等の権限 | ADP-059-B |
| R03 | **決裁規程** | Human承認が必要な事項、例外承認、不可逆操作、権限変更の決裁 | ADP-059-B |
| R04 | **文書管理規程** | SoT、文書区分、Decision、記録、Memory、変更履歴、参照優先順位 | ADP-059-C |
| R05 | **システム開発管理規程** | Idea→ProductのStage/Gate、開発・Review・Releaseの管理原則 | ADP-059-D |
| R06 | **プロジェクト管理規程** | Product/Epic/Story/Task/Sprint、優先順位、進捗、Refinement、完了管理 | ADP-059-D |

情報セキュリティ管理規程、リスク管理規程、購買・契約等は、実際に独立した統制領域が必要になった時点で通常の規程として追加する。AI専用規程として先回りして増やさない。

## 4. 既存 Operating Guide 移管マップ

`docs/operating-guide.md` の現行章を以下へ移す。完全移管が終わるまで旧文書を削除しない。

| Operating Guide | 主な移管先 | 下位文書 |
|---|---|---|
| §1 Basic principles | R04 文書管理規程 / R06 プロジェクト管理規程 | Task開始・完了基準、Skills |
| §2 AI roles | R01 組織規程 | 必要に応じ役割別手順 |
| §3–4 Development lifecycle / Stage and Gate | R05 システム開発管理規程 | Stage/Gate判定基準 |
| §5 Systems of record | R04 文書管理規程 | `governance/source-of-truth.md` を基準へ整理 |
| §6 AI operating rules / PR・review・merge | R02 職務権限規程 / R03 決裁規程 / R05 システム開発管理規程 | PR Review基準・Skills |
| §7 Backlog Refinement | R06 プロジェクト管理規程 | `backlog-refinement` Skill |
| §8 Weekly Sprint operation | R06 プロジェクト管理規程 | `weekly-sprint` Composite Skill |
| §9 Definition of Ready | R05 / R06 配下の基準 | DoR基準 |
| §10 Definition of Done | R05 / R06 配下の基準 | DoD基準 |
| §11 Human Request / Human Gate | R02 職務権限規程 / R03 決裁規程 | Human Gate判定基準 / `human-gate-preflight` Skill |
| §12 Chris → Claude handoff | R01 組織規程 / R02 職務権限規程 | Handoff手順 |
| §13 Portfolio top-page principle | R04 文書管理規程 / R06 プロジェクト管理規程 | Dashboard表示基準 |
| §14 Portfolio Health automation | R06 プロジェクト管理規程 | Portfolio Health判定基準 |

## 5. 優先順位と正本

規範文書間で矛盾した場合は、原則として次の順で扱う。

1. 現在有効な**規程**
2. 規程に基づく**基準**
3. 基準に基づく**手順（Skills）**
4. Repo固有の `AGENTS.md` / `CLAUDE.md` 等の実行指示
5. **記録**（Notion Task / Decision、GitHub履歴、brain Memory）

Ownerが明示的に既存ルールを変更した場合、その判断をNotion Decisionまたは対象Taskへ記録し、規程の正本へ速やかに反映する。**Decisionを残しただけで恒久Policyの改定完了とはみなさない。**

## 6. 移行期間の扱い

ADP-059完了までは `docs/operating-guide.md` を**旧規程の互換正本**として残す。

- 個別規程へ正式移管済みの条項は、新しい規程を優先する。
- 未移管の条項は、引き続きOperating Guideを参照する。
- 同じルールを両方で恒久運用しない。移管後はOperating Guide側を参照リンクへ置換する。
- 最終Task ADP-059-EでOperating Guideを「規程体系への入口」に縮退し、重複した規定を除去する。

この段階移行により、規程再編の途中で統制の空白や二重の正本を作らない。

## 7. 規程文書の標準ヘッダ

各規程は最低限、次を明記する。

```text
文書区分: 規程
規程ID: Rxx
承認権者: Owner
施行日: YYYY-MM-DD JST
最終改定日: YYYY-MM-DD JST
関連基準: ...
関連手順: ...
```

規程改定の理由と経緯は本文へ累積させず、Notion Decision / Task / GitHub PRの変更履歴で追跡する。

## 8. 本Taskの完了境界

ADP-059-Aは**規程体系・文書階層・移管マップの定義まで**を対象とする。個別規程の条文化はADP-059-B〜D、旧Operating Guideの縮退はADP-059-Eで行う。
