# R02｜職務権限規程

> **文書区分:** 規程  
> **規程ID:** R02  
> **承認権者:** Owner  
> **施行日:** 2026-09-06 JST  
> **最終改定日:** 2026-09-06 JST  
> **関連規程:** R01 組織規程 / R03 決裁規程  
> **移管元:** `docs/operating-guide.md` §6、§11、§12 / Owner方針 ADP-058

## 第1条 目的

本規程は、各実行主体が自律的に遂行できる行為、Repository別のmerge authority、レビュー独立性および権限変更の境界を定める。

## 第2条 権限の根拠

1. 実行権限は、現行規程、規程に基づく基準・手順、Repository固有の実行指示およびOwnerの最新の明示指示に基づく。
2. 過去のDecision、brain Memory、会話履歴、古い運用メモは、それだけでは新しい権限を付与・取消ししない。
3. Repository固有ルールは、そのRepositoryに関する具体的な実行条件を定めることができるが、上位規程に反する恒久Policyを独自に新設しない。
4. Ownerの最新の明示指示が既存下位文書と競合する場合は当該指示を優先し、恒久変更であれば速やかに規程へ反映する。

## 第3条 通常執行権限

担当Taskが有効でAcceptance Criteriaと対象Repositoryが明確な場合、担当AIは付与された接続手段の範囲で、次の可逆的な通常業務を自律実行できる。

1. Notion / GitHubその他の正本からの情報取得・照合。
2. Task範囲内の設計、実装、文書作成、テスト、修正および証跡記録。
3. Branch、commit、Pull Requestの作成およびレビュー指摘への修正。
4. Task / Result / Blocker / Sprint等、担当業務に必要な運用状態の更新。
5. 規程・基準・手順に従うAI間の引継ぎおよびフェイルオーバー。

R03に定める決裁事項、Human-only事項、課金・契約・本人性・不可逆操作等は通常執行権限に含まれない。

## 第4条 Repository別merge authority

### 4.1 self-merge Repository

次のRepositoryは、Ownerの明示方針により**全変更をself-merge可能**とする。

- `cloud42-labo/brain`
- `cloud42-labo/experimental`

両Repositoryでは、journal、notes、decisions、code、docs、root運用ファイルその他の変更種別によってself-merge可否を分けない。

作業Agentは原則としてBranch → commit → Pull Request → mergeの履歴を残す。self-merge権限は通常のdirect `main` pushを標準化するものではない。

独立レビューは品質補助として実施できるが、**mergeの必須Gateではない**。ただし、未解決P0/P1、失敗した必須CI、Repository固有の必須テスト、現在の遷移に明示的に適用される検証Gateは無視してはならない。

### 4.2 その他のRepository

前項以外のRepositoryでは、原則としてself-mergeを禁止し、Authorと最終merge担当を分離する。

標準フローは次のとおりとする。

1. **Claude-authored** — ClaudeがPR作成・修正 → 必要な独立レビュー → Chrisが最終確認・merge。
2. **Chris-authored** — ChrisがPR作成・修正 → 必要な独立レビュー → Claudeが最終確認・merge。
3. Ownerは通常のmerge operatorとしない。

Repository固有の明示ルールまたはOwnerの明示指示により別のmerge authorityが設定された場合は、その範囲で当該ルールを適用する。

## 第5条 独立レビュー

1. 独立レビューが必須のRepositoryまたは変更では、AuthorとReviewerを同一主体にしない。
2. Codexが指定Reviewerとして利用可能な場合は、Codexを独立Reviewerとして用いることができる。
3. 指定Reviewerが利用不能で、独立レビューが必要な場合は、Authorと異なる適格な主体へフェイルオーバーできる。Reviewer変更だけを理由に業務全体を停止しない。
4. レビュー対象SHAが変わった場合は、merge時点のheadに対して必要な独立確認をやり直す。
5. 独立レビューのフェイルオーバーは、CI、P0/P1、mergeability、Human/device/environment Gate等の既存品質条件を緩和しない。

## 第6条 AI-to-AIの停止・権限取消し

1. AIは、明示的な根拠なく他AIの既存実行権限を停止、取消し、縮小してはならない。
2. 「より安全そう」「レビューした方がよい」等の推測だけで、新しいapproval Gate、Human Gate、再レビューGateを追加してはならない。
3. 権限変更が必要な場合は、Ownerの明示指示、現行規程または既存のRepository固有ルールを根拠とする。
4. 規程間・記録間の不整合を発見した場合は、可逆的で権限が明確な作業を継続しつつ、不可逆または高影響の当該操作だけを必要に応じて保留する。競合そのものを理由に全作業を停止しない。

## 第7条 外部サービス・課金・情報取扱い

次の行為は、通常執行権限に含まれない。

1. Owner承認のない従量課金API、追加credit、plan upgradeその他のmetered pathへの切替。
2. secrets、credentials、tokens、非公開情報その他の保護対象情報を、明示的な許可なく外部サービスへ送信すること。
3. 契約、購入、支払、本人確認、権限付与等のOwner / Human権限事項をAI判断だけで実行すること。

## 第8条 Repository固有実行指示

`AGENTS.md`、`CLAUDE.md`その他のRepository固有実行指示は、本規程に基づく具体的なHowとして扱う。

1. 本規程より厳しい品質手順をRepository固有要件として定めることができる。
2. Ownerが明示したRepository別merge authorityを、古い汎用記述で取り消してはならない。
3. 規程と実行指示の矛盾を検出した場合は、正本を修正して二重ルールを残さない。

## 第9条 権限例外

一時的な権限例外は、R03に従いOwnerが承認できる。例外は対象、行為、期間または終了条件を明確にし、無限定な一般権限として解釈しない。

恒久的な権限変更は、本規程または該当規程の改定を完了して初めて恒久Policyとして扱う。
