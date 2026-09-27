# Jetpack Compose の状態保持：remember・rememberSaveable・ViewModel をどう使い分けるか

remember で包んでおけば、たいていはそれで動く。実際、ボタンを押せば数値は増え、画面にもきちんと反映される。ところが、画面を回転させた途端、あるいはしばらく裏で放置されただけで、さっきまで増えていたはずの数値が0に戻る。View システムで `onSaveInstanceState` や `ViewModel` の使い分けに慣れていた開発者ほど、この落差に戸惑う。Compose では、その使い分けが `remember`・`rememberSaveable`・`ViewModel` という3つの道具に分かれて見えるからだ。

三つの違いは、機能の多さではなく、値が生き残る範囲の違いに尽きる。

## remember はコンポジション限りの記憶装置

`remember` がどこまで面倒を見てくれるかは、そのコンポーザブルがコンポジションに乗っている間、という一言に尽きる。再コンポーズのたびに初期化処理が走り直すことはない。

ただし、`remember` に包んだだけでは、値が変わってもUIには反映されない。Compose に「この値が変わったら再描画してほしい」と伝えるには、`mutableStateOf` のような監視可能な State を組み合わせる必要がある。

```kotlin
@Composable
fun Counter() {
    var count by remember { mutableStateOf(0) }

    Column {
        Text("Count: $count")
        Button(onClick = { count++ }) {
            Text("Increment")
        }
    }
}
```

`count` はボタンを押すたびに増え、画面にも反映される。うまく動いているように見える。ところが、この値が保持されるのは、あくまでコンポジションに乗っている間だけだ。このコンポーザブルがコンポジションから外れれば——画面遷移で消えるなど——値は破棄される。画面回転などの構成変更で Activity が再生成された場合も同じで、システムがバックグラウンドでプロセスごと回収し、あとで復元する場合でも、`remember` の値はそこで途切れる。

`remember(key) { ... }` の形も覚えておく価値がある。渡したキーの値が変わったタイミングで、内部の計算をやり直してくれる。何かのパラメータに依存して初期値を作り直したいときに使う。

## rememberSaveable：どこまでなら生き延びるか

では、画面回転やプロセスの回収を越えて値を残したいときはどうするか。答えは、Android が昔から持っている「保存済みインスタンス状態」の仕組み——Bundle——を借りることだ。`rememberSaveable` はこの仕組みで値を保存するため、構成変更だけでなく、システムによるプロセス終了後の復元も越えて残る。入力途中のテキストや、スクロール位置を保持したい場合に向いている。

```kotlin
@Composable
fun SearchField() {
    var query by rememberSaveable { mutableStateOf("") }

    TextField(
        value = query,
        onValueChange = { query = it },
        label = { Text("検索") }
    )
}
```

ここで「何でも保存できる」と思うと足をすくわれる。`rememberSaveable` が直接扱えるのは、Bundle に入れられる型に限られる。プリミティブ型や `String`、`Parcelable` などがこれにあたる。それ以外の独自クラスを保存したいなら、`Saver`（`mapSaver` や `listSaver` など）を自分で渡すか、そのクラス自体を `@Parcelize` で Parcelable にしておく必要がある。

サイズの見積もりも甘くない。Bundle に大きなデータを詰め込むと、`TransactionTooLargeException` を引き起こしうる。`rememberSaveable` に入れるのは、スクロール位置や入力中の文字列のような小さな UI 状態にとどめる。大きなリストや画像データのようなものをここに保存すると、この例外を招きやすい。

## ViewModel：構成変更は越えるが、プロセス終了では消える

画面をまたいで使い回したい状態や、ビジネスロジックが絡む状態は、そもそも `remember` 系の話ではない。公式ガイドの考え方に沿えば、そうした状態は `ViewModel` に置く。`ViewModel` は構成変更を越えて保持され、画面回転のたびにインスタンスが作り直されることはない。

構成変更さえ越えれば安心、というわけにはいかない。システムによるプロセス終了に対しては、`ViewModel` も他の手段と同じく無力だ。プロセスが終了すれば、`ViewModel` のインスタンスごと消える。プロセス終了後も必要な値は、`ViewModel` が内部に持つ `SavedStateHandle` に保存しておく必要がある。

```kotlin
class SearchViewModel(
    private val savedStateHandle: SavedStateHandle
) : ViewModel() {

    val query: StateFlow<String> =
        savedStateHandle.getStateFlow("query", "")

    fun onQueryChanged(newQuery: String) {
        savedStateHandle["query"] = newQuery
    }
}
```

`SavedStateHandle` を使うと、構成変更はもちろん、プロセス終了後の復元にも耐える状態を `ViewModel` の中に閉じ込めておける。`rememberSaveable` と役割は近い。違うのは、置き場所がコンポーザブル関数の中か、`ViewModel` の中かだけだ。

## 三つがそろって手放す一線

戻る操作で Activity を終了させたときも、最近のアプリ一覧からスワイプしてタスクごと消去したときも、`rememberSaveable` の値も `ViewModel` も復元されない。

一見、辻褄が合わない話に見えるかもしれない。`rememberSaveable` も `ViewModel` も、あれほど頑丈に作られていたはずだ。だが、これは想定どおりの挙動である。ユーザー自身が「この画面は終わり」と意思表示した以上、次に開いたときはまっさらな状態から始まるほうが自然だからだ。

## 使い分けの指針

では、どの状態をどこに置けばよいのか。判断の軸は一つでいい——このコンポーザブルが消えたとき、この値はどうなってほしいか、である。

- 画面をまたいで使う状態、ビジネスロジックが絡む状態 → `ViewModel`（必要なら `SavedStateHandle` で守る）
- 画面が生きている間は消えてほしくない UI 状態（入力中の文字列、スクロール位置など） → `rememberSaveable`
- コンポーザブルが消えれば一緒に消えて構わない一時的な値 → `remember`

消えても構わないなら `remember`、次にアプリを開いたときにも残っていてほしいなら `rememberSaveable` か `ViewModel`（＋ `SavedStateHandle`）、他の画面からも参照したいなら `ViewModel` を選ぶ。判断に迷ったときほど、この一問に立ち返るとよい。
