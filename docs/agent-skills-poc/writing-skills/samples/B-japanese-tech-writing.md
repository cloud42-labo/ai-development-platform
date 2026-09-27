# 画面の状態はどこに置くか：remember・rememberSaveable・ViewModelの使い分け

Jetpack Compose の入力欄やスクロール位置は、コンポーザブル関数の外に保存場所を持たない限り、再コンポーズのたびに初期値へ戻ってしまう。View システムでは Activity や Fragment のフィールドに値を持たせれば済んだが、Compose では状態をどこに置くかによって、その値がいつまで生き残るかが変わる。

## remember が保持し損なうもの

`remember` は、コンポーザブルが再コンポーズされても値を保持する。ただし、そのコンポーザブルがコンポジションから外れると値は破棄される。条件分岐で表示が切り替わって呼び出し自体がなくなった場合や、画面回転で Activity が作り直された場合がこれにあたる。

実際、画面回転のような構成変更が起きると、Activity は一度破棄されて再生成される。この再生成によってコンポジションも作り直されるため、`remember` に保持していた値は失われる。バックグラウンドで長時間放置したアプリのプロセスをシステムがメモリ回収のために終了させ、後でユーザーが呼び戻したときの復元でも、同じように失われる。`remember` は再コンポーズだけを前提にした保持であり、これら二種類の再生成には対応しない。

## 変更を再コンポーズに伝える

`remember` だけでは、保持している値を書き換えても UI には反映されない。Compose は、読み取っている値が変わったことを検知して初めて再コンポーズを行うため、変更を監視対象にする必要がある。そのために使うのが `mutableStateOf` のような State であり、`remember { mutableStateOf(0) }` のように組み合わせて使う。

```kotlin
var count by remember { mutableStateOf(0) }

Button(onClick = { count++ }) {
    Text("カウント: $count")
}
```

`remember` にはキーを渡すこともできる。`remember(key) { ... }` と書くと、`key` が変わったときにブロックを再実行し、値を計算し直す。入力に応じて派生させたい値を保持する場合に使う。

## rememberSaveable が越えられる範囲

`rememberSaveable` は、保存済みインスタンス状態（Bundle）の仕組みを使って値を保存する。この仕組みは、画面回転などの構成変更だけでなく、システムによるプロセス終了後の復元も越えて値を保持する。`remember` が耐えられなかった二種類の再生成のいずれにも対応する。

```kotlin
var text by rememberSaveable { mutableStateOf("") }

TextField(value = text, onValueChange = { text = it })
```

ただし、Bundle に入れられる型には制限がある。`rememberSaveable` がそのまま保存できるのは、プリミティブ型や String、Parcelable など、Bundle が扱える型に限られる。それ以外の型を保存したいときは、`mapSaver` や `listSaver` といった `Saver` を渡すか、対象のクラスを `@Parcelize` で Parcelable にする。

さらに、Bundle に大きなデータを入れると、`TransactionTooLargeException` の原因になりうる。`rememberSaveable` に入れてよいのは、スクロール位置や入力中の文字列のような小さな UI 状態にとどめる。画面をまたいで保持したい一覧データなどを、そのまま Bundle に持たせるのは避ける。

## ViewModel との役割分担

`ViewModel` は構成変更を越えて生き残る点では `rememberSaveable` と同じだが、保持の仕組みが違う。`ViewModel` のインスタンスそのものがメモリ上に残り続けるために生き残るのであり、システムがプロセスを終了させれば、`ViewModel` のインスタンスごと破棄される。プロセス終了後も必要な値を残したいときは、`ViewModel` が持つ `SavedStateHandle` に保存する。

ただし、ユーザーが戻る操作で Activity を終了させたり、最近のアプリ一覧からスワイプして消去したりした場合は、`rememberSaveable` の値も `ViewModel` も復元されない。これは、ユーザー自身がその画面を終わらせた結果であり、想定どおりの動作である。

画面をまたいで使う状態や、ビジネスロジックが絡む状態は `ViewModel` へ置き、コンポーザブル内で閉じる UI 要素の状態は `remember` や `rememberSaveable` へ置く。公式ガイドが示すこの考え方に沿えば、状態ごとにどちらへ置くかを個別に悩む必要はない。入力欄の一文字ごとの値やスクロール位置は前者に、サーバーから取得した一覧やユーザー操作の結果として組み立てるドメインの状態は後者に、それぞれ置き場所が決まる。
