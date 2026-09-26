# 執筆依頼（3条件共通）

Jetpack Compose を使い始めた Android 開発者向けに、「画面の状態をどこに保持するか：`remember`・`rememberSaveable`・`ViewModel` の使い分け」を解説する日本語の技術記事を書く。

- 分量：本文 1,800〜2,500 字程度（コードを除く）。Markdown。見出しは 3〜5 個。
- コード例：Kotlin で 2〜3 個。短く。
- 読者：View システムでの Android 開発経験はあるが、Compose の状態保持は曖昧な開発者。
- 技術的事実は下の「事実シート」の範囲で書く。事実シートにない技術的主張を足すときは、確実に正しいものだけにする。事実シートの内容を落とすのは構わないが、1〜7 は必ず含める。

## 事実シート

1. `remember` は、コンポーザブルが再コンポーズされても値を保持する。ただし、そのコンポーザブルがコンポジションから外れると値は破棄される。
2. `remember` だけでは値の変更は UI に反映されない。変更を監視させて再コンポーズを起こすには `mutableStateOf` などの State を使う（`remember { mutableStateOf(...) }`）。
3. `remember` の値は、画面回転などの構成変更で Activity が再生成されると失われる。システムによるプロセス終了（バックグラウンドでのメモリ回収）後の復元でも失われる。
4. `rememberSaveable` は、保存済みインスタンス状態（Bundle）の仕組みで値を保存し、構成変更とシステムによるプロセス終了後の復元の両方を越えて値を保持する。
5. `rememberSaveable` で保存できるのは Bundle に入る型（プリミティブ、String、Parcelable など）。それ以外の型は `Saver`（`mapSaver`、`listSaver` など）を渡すか、`@Parcelize` で Parcelable にする。
6. Bundle に大きなデータを入れると `TransactionTooLargeException` の原因になりうる。`rememberSaveable` には、スクロール位置や入力中の文字列のような小さな UI 状態だけを入れる。
7. `ViewModel` は構成変更を越えて生き残るが、システムによるプロセス終了では破棄される。プロセス終了後も必要な値は `SavedStateHandle` に保存する。
8. ユーザーが明示的に画面を閉じた場合（戻る操作で Activity を終了、最近のアプリ一覧からスワイプで消去）は、`rememberSaveable` の値も `ViewModel` も復元されない。これは想定どおりの動作である。
9. `remember(key) { ... }` のようにキーを渡すと、キーが変わったときに計算し直す。
10. 画面をまたいで使う・ビジネスロジックが絡む状態は `ViewModel`（状態ホルダー）へ、コンポーザブル内で閉じる UI 要素の状態は `remember` / `rememberSaveable` へ、という使い分けが公式ガイドの考え方である。
