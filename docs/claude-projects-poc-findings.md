# Claude Projects PoC — 並列Thread実行の観測結果（ADP-064-T03）

Date: 2026-09-26 (JST)
Status: PoC findings（ADP-064-T03の中間成果。採否判断は未確定）
Related: [claude-projects-evaluation.md](claude-projects-evaluation.md)（ADP-064-T02の責務マッピング）
Operational record: Notion `ADP-064-T03` の Result。観測レポート（HTML）:
https://claude.ai/artifact/CWySgkTQzgH16fBqxsV8Y3

この文書は、実在ADP Work（ADP-031-B/C/D/E）をClaude Projectsの並列Threadで実行した
PoCから得た、ADPの設計に効く恒久的な知見だけを残す。各Taskの進捗・時刻の正本はNotion。

## 実施内容

- 入力: 相互依存のない4 Task（ADP-031-B 文章Skill比較、C grill-me、D Context7、E ax）。
  いずれもNotionでReady相当・Approach Review=Approved。
- 構成: 1 Project に `ai-development-platform` / `skills` / `brain` の3リポジトリ。
  Coordinatorが4 Taskを1対1で4 Threadへ割り当て、別に読み取り専用の事前調査Threadを1本立てた。
- 結果: 4 Threadが同時起動し、依頼から約27分で全Threadが終息。各Threadが
  Notion着手記録 → 検証 → PR → 確認用アーティファクト → Notion Result まで自走した。
  各Threadの所要時間の合計は約66分（実時間比 約2.4倍）。
- usage: 6セッション合計で出力約35万トークン、キャッシュ読込約80Mトークン、
  API換算 約$34（大半はキャッシュ読込）。サブスクリプション上限に対する消費率は未取得。

## 知見

1. **並列分解と自律進行は成立する。** Notionで定義済みの独立Taskを1 Task = 1 Threadで
   渡せば、各ThreadはADPの着手・完了手順（Status / Started At / TTE / Result）を自走できた。
   T02 §5.3 の「Coordinatorに独自分解をさせず、Notion Taskをそのまま渡す」形で運用可能。
2. **制約はAI処理能力ではなくHumanの注意になる。** 27分間でHuman対応が7回発生し、
   うち3回は設定不足による不要な待ち、1回は状態表現の誤りだった。Threadを増やすほど
   Humanへの割込みが増えるため、Thread数はHuman処理能力に合わせたWIP制御が要る。
3. **ADPの役割ルールはThreadに自動継承されない。** Coordinatorの指示に書かれなかった
   「ai-development-platformのPRはChrisがマージする」「brainは自己マージ可」が欠け、
   2 ThreadがユーザーにADP PRのマージを依頼し、1 Threadが不要なbrainマージ確認を出した。
   → Thread起動指示のテンプレートに、リポジトリ別マージ権限とHuman Gate既定を必須項目として含める。
4. **権限プロンプトはThreadごとに散らばる。** プロジェクトチャットでの「許可する」は
   Threadの権限プロンプトに届かない。外部取得やコネクタが必要な操作は、Thread起動前に
   ネットワーク許可・コネクタで先に解消しておく（Context7はネットワーク方針で遮断され、
   コネクタ追加で解消した）。
5. **並列Threadは共有ファイルで競合する。** 複数Threadが同じbrain日次journalへ書き、
   マージ競合が発生し、1 Threadの記録が終息時点で未反映だった。並列Threadの記録は
   Threadごとの別ファイルにするか、journal集約をCoordinator（または最後の1本）に寄せる。
6. **Threadの状態とusageはセッションのメタデータから読める。** T02 §3 で Unknown とした
   「Thread状態の取得」は、プロジェクト内のセッションからは状態・status checklist・
   トークン数・API換算コストを取得できた（外部APIとしての公開有無は未確認のまま）。
7. **失敗からの再開。** 外部要因で止まったThread（ネットワーク遮断）は、Human対応後に
   同じThreadのまま中断箇所から再開できた。異常終了したThreadの再起動は発生せず未観測。

## T02のアーキテクチャ案との差分

- T02 §5.2 は単一リポジトリのProjectに限ることを推奨したが、本PoCは3リポジトリ構成で実施した。
  マージ権限の誤りは、リポジトリごとにルールが異なることと、それが指示に入っていなかったことの
  両方に起因する。採用する場合も §5.2 の制約は維持する。
- T02 §5.4（Project memoryを正本にしない）について、本PoCではCoordinatorの観測記録が
  Project memoryに蓄積された。恒久化すべき内容はこの文書・brain・Notionへ移した。

## 未観測・残課題

- PCやブラウザを閉じた後の継続（構成上は端末非依存だが実測していない）。
- 同一Taskを現行方式（scheduled-skill-dispatcher + 個別Claude Codeセッション）で実行した
  場合との、同じ成果物・品質条件での定量比較。今回は定性比較のみ。
