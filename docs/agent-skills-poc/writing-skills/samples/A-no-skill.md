# Jetpack Compose の状態保持：remember・rememberSaveable・ViewModel をどう使い分けるか

View システムでの Android 開発に慣れている人ほど、Compose を書き始めたときに「この値、どこに置けばいいんだ」と手が止まりやすい。`onSaveInstanceState` や `ViewModel` のような馴染みのある仕組みが、Compose では `remember`・`rememberSaveable`・`ViewModel` という3つの選択肢に分かれて見えるからだ。この記事では、それぞれが「何に強く、何に弱いか」を具体的なシナリオに沿って整理する。

## remember はコンポジション限りの記憶装置

Compose において最も基本的な状態保持手段が `remember` だ。`remember` に包んだ値は、そのコンポーザブルが再コンポーズされても保持され続ける。再コンポーズのたびに初期化処理が走り直すことはない。

ただし、いくつか誤解しやすい点がある。まず、`remember` だけでは値を変更しても UI には反映されない。Compose に「この値が変わったら再コンポーズしてほしい」と伝えるには、`mutableStateOf` のような監視可能な State を組み合わせる必要がある。

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

ここでの `count` はボタンを押すたびに増え、画面にも反映される。しかし、この値が保持されるのはあくまで「コンポジションに乗っている間」だけだ。このコンポーザブルがコンポジションから外れれば（画面遷移で消えるなど）値は破棄される。さらに、画面回転などの構成変更で Activity が再生成された場合も、`remember` の値は失われる。同様に、バックグラウンドでシステムがプロセスごと回収し、後で復元されるケースでも失われる。

もう一つ覚えておきたいのが `remember(key) { ... }` の形だ。キーを渡しておくと、そのキーの値が変わったタイミングで内部の計算をやり直してくれる。何かのパラメータに依存して初期値を作り直したいときに使う。

## rememberSaveable：構成変更もプロセス終了後の復元も越える

`remember` が「コンポジション内限定」なのに対し、`rememberSaveable` はもう一段階頑丈だ。内部的には、Android が昔から持っている「保存済みインスタンス状態」の仕組み（Bundle）を使って値を保存するため、構成変更だけでなく、システムによるプロセス終了後の復元も越えて値を保持できる。ユーザーが入力途中だったテキストや、スクロール位置を保持したい場合に向いている。

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

ここで注意したいのが「何でも保存できるわけではない」という点だ。`rememberSaveable` が直接扱えるのは、Bundle に入れられる型に限られる。プリミティブ型や `String`、`Parcelable` などがこれにあたる。それ以外の独自クラスなどを保存したい場合は、`Saver`（`mapSaver` や `listSaver` など）を自分で渡すか、そのクラス自体を `@Parcelize` で Parcelable にしておく必要がある。

もう一つ実務上ハマりやすいのが、保存するデータのサイズだ。Bundle にあまり大きなデータを詰め込むと、`TransactionTooLargeException` を引き起こす可能性がある。`rememberSaveable` に入れるのは、あくまでスクロール位置や入力中の文字列のような、小さな UI 状態にとどめるのが安全だ。大きなリストや画像データのようなものをここに保存しようとするのは筋が悪い。

## ViewModel：構成変更を越えて生きるが、プロセス終了には無力

画面をまたいで使い回したい状態や、ビジネスロジックが絡む状態は `ViewModel` に置くのが公式ガイドの考え方だ。`ViewModel` は構成変更を越えて生存する。つまり、画面回転のたびにインスタンスが作り直されることはない。

一方で、`ViewModel` は万能ではない。システムによるプロセス終了に対しては無力で、プロセスが終了すれば `ViewModel` のインスタンスごと破棄される。プロセス終了後も必要な値については、`ViewModel` が内部に持つ `SavedStateHandle` に保存しておく必要がある。

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

`SavedStateHandle` を使うと、構成変更はもちろん、プロセス終了後の復元にも耐える状態を `ViewModel` の中に閉じ込めておける。`rememberSaveable` と役割は近いが、置き場所がコンポーザブル関数の中か `ViewModel` の中かという違いがある。

## 共通して覚えておきたい前提

3つの仕組みには、共通する一つの前提がある。ユーザーが明示的に画面を閉じた場合、つまり戻る操作で Activity を終了させたり、最近のアプリ一覧からスワイプしてタスクごと消去したりした場合は、`rememberSaveable` の値も `ViewModel` も復元されない。これは不具合ではなく、想定どおりの挙動だ。ユーザー自身が「この画面は終わり」と意思表示した以上、次に開いたときはまっさらな状態から始まるのが自然だからだ。

## 使い分けの指針

ここまでの内容を整理すると、判断の軸は次のようになる。

- 画面をまたいで使う状態、ビジネスロジックが絡む状態 → `ViewModel`（必要ならさらに `SavedStateHandle` で保護する）
- コンポーザブルの中だけで完結する UI 状態のうち、構成変更やプロセス終了後の復元を越えて残したいもの（入力中の文字列、スクロール位置など） → `rememberSaveable`
- それ以外の、再コンポーズの間だけ保持できれば十分な一時的な値 → `remember`

これは公式ガイドが示す考え方でもある。迷ったときは「この状態は、この画面のこのコンポーザブルが消えたらどうなってほしいか」を自問するとよい。消えても構わないなら `remember`、ユーザーが再びアプリを開いたときにも残っていてほしいなら `rememberSaveable` か `ViewModel`（＋ `SavedStateHandle`）、他の画面からも参照したいなら `ViewModel` という順に絞り込んでいけば、View システム時代の感覚を引きずったままでも大きく判断を誤ることは少ないはずだ。
