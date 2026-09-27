# 画面を回しただけで消える値

入力欄に文字を打ち込んで、端末を横に倒す。それだけで、さっきまであった文字が消えている。バグ報告としてよく見る現象だが、原因は一つとは限らない。

## `remember`が保持しているもの

Composeで最初に覚える状態保持の道具は`remember`である。

```kotlin
@Composable
fun Counter() {
    var count = remember { 0 }
    Button(onClick = { count++ }) {
        Text("count: $count")
    }
}
```

このコードを実機で試すと、ボタンを押しても画面の数字は変わらない。`remember`は再コンポーズのあいだ値を保持する仕組みであって、値の変更を再コンポーズの引き金にはしない。UIに反映させるには、変更を監視できる入れ物が要る。`mutableStateOf`である。

```kotlin
@Composable
fun Counter() {
    var count by remember { mutableStateOf(0) }
    Button(onClick = { count++ }) {
        Text("count: $count")
    }
}
```

ここまで直せば、ボタンを押すたびに数字は増える。冒頭の入力欄の消失は、ここでは起きない類の不具合だろう、と思いたくなる。

ところが、この`Counter`を画面回転させると、数字は0に戻る。`remember`が保持しているのは、そのコンポーザブルがコンポジションに乗っているあいだの値であり、コンポジションから外れれば値は消える。画面回転でActivityが作り直されるときは、以前のコンポジションごと失われるので、同じことが起きる。バックグラウンドでシステムがメモリを回収し、あとで復元する場合も同様である。プロセスが一度終わっている以上、`remember`に何を積んでいても残らない。

なお、`remember(key) { ... }`のようにキーを渡す書き方もある。これは値を保持するかどうかの話ではなく、キーが変わった瞬間に計算をやり直すための指定であり、消失とは別の性質である。

## `rememberSaveable`とBundleの制約

構成変更とプロセス終了の両方を越えて値を残すには、`rememberSaveable`に切り替える。保存済みインスタンス状態、つまりBundleの仕組みに乗せて値を保存する点が`remember`との違いである。

だから、Bundleに入る型でなければそのままでは保存できない。プリミティブ型やString、Parcelableは通るが、任意のデータクラスはそのままでは弾かれる。`Saver`を自分で渡せば、この制約は越えられる。

```kotlin
data class FormState(val name: String, val age: Int)

val FormStateSaver = mapSaver(
    save = { mapOf("name" to it.name, "age" to it.age) },
    restore = { FormState(it["name"] as String, it["age"] as Int) }
)

@Composable
fun Form() {
    var state by rememberSaveable(stateSaver = FormStateSaver) {
        mutableStateOf(FormState("", 0))
    }
}
```

`@Parcelize`でParcelableにする道もあるが、既存のデータクラスに手を入れにくい場面では`mapSaver`や`listSaver`のほうが使いやすい。リストであれば`listSaver`、キーと値の組であれば`mapSaver`と、保存したい形に合わせて選べる。

ここで欲を出して、入力履歴や取得したデータの一覧を丸ごと`rememberSaveable`に積みたくなることがある。だが、Bundleは軽量な状態の受け渡しを想定した仕組みであり、大きなデータを詰め込むと`TransactionTooLargeException`で落ちる可能性がある。`rememberSaveable`に置いてよいのは、スクロール位置や入力中の文字列のような、小さなUI状態に限られる。

## `ViewModel`と、それでも消える場合

では、画面をまたいで使うデータや、ネットワークから取得した一覧はどこに置けばよいのか。答えは`ViewModel`である。`ViewModel`は構成変更を生き延びる点で`rememberSaveable`と似ているが、プロセスが終了すれば`ViewModel`ごと破棄される。プロセス終了後も必要な値は、`ViewModel`が持つ`SavedStateHandle`に保存する。`SavedStateHandle`は`ViewModel`本体とは別に、OSの保存済みインスタンス状態と結びついているため、`ViewModel`のインスタンスそのものが失われても中身だけは残る。

なお、ユーザーが戻る操作でActivityを終了させたり、最近のアプリ一覧からスワイプで消去したりした場合は、`rememberSaveable`も`ViewModel`も復元されない。これは不具合ではなく、想定どおりの挙動である。ユーザーが明示的に閉じた画面まで復元してしまえば、それこそ意図しない状態の持ち越しになる。

## 三つの置き場所

三つの道具を並べると、使い分けの軸が一本見えてくる。画面をまたいで使う状態やビジネスロジックが絡む状態は`ViewModel`へ、一つのコンポーザブルの中で閉じるUI状態は`remember`か`rememberSaveable`へ。これが公式ガイドの考え方である。

冒頭の入力欄も、`remember`のままなら回転で消え、`rememberSaveable`に変えれば残る。ただし、それでユーザーがアプリを最近のアプリ一覧から消した後も残ってほしいと思うなら、その期待自体を見直す番である。
