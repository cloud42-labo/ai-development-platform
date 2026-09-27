#!/usr/bin/env python3
"""文章Skill比較用の機械的チェック（ADP-031-B）。本文のみ対象（コードブロック除外）。

使い方: python3 lint.py samples/*.md > lint-result.json
注意: 語の出現を数えるだけなので文脈は見ない（例:「ここでは起きない」も予告表現として数える）。
判定には必ず目視を併用する。chars_prose はインラインコードを1字に置換し見出しを除いた字数。
"""
import json, re, sys

JTW_BANNED = {
    "予告・総括": ["重要なのは", "本章では", "本記事では", "ここでは", "見ていく", "まとめると", "要するに", "に他ならない", "この記事では", "ここまでの内容を整理"],
    "正面から系": ["正面から"],
    "空虚な形容": ["不可欠", "核心的", "鍵となる", "根本的な", "多角的", "包括的", "総合的"],
    "空虚な動詞": ["掘り下げ", "深掘り", "言語化"],
    "接続の型": ["において", "という側面から", "の観点から"],
    "弱い緩和・称賛": ["と言えるだろう", "非常に", "極めて", "大いに"],
    "翻訳調": ["を運ぶ", "開かれた問い", "が効く", "筋がいい", "筋が悪い", "刺さる"],
}
CRW_LEAK = ["答えの半分", "緊張", "(?<!メモリ)回収", "線を引く", "問いを半分", "認知モード", "密度波形"]
I_ADJ_DESU = re.compile(r"[いし]いです[。、]|[^なら]いです。")
FACT_KEYS = {
    "F1 コンポジション離脱で破棄": r"コンポジションから(外れ|離れ|消え)",
    "F2 mutableStateOf": r"mutableStateOf",
    "F3 構成変更で消える(remember)": r"(構成変更|画面回転|回転)",
    "F4 rememberSaveable/Bundle": r"Bundle",
    "F5 Saver/Parcelize": r"(Saver|Parcelize)",
    "F6 TransactionTooLarge": r"TransactionTooLargeException",
    "F7 SavedStateHandle": r"SavedStateHandle",
    "F8 明示的に閉じた場合": r"(戻る|スワイプ|最近のアプリ|明示的に)",
    "F9 remember(key)": r"remember\(\s*\w+",
    "F10 状態ホルダー方針": r"(状態ホルダー|ビジネスロジック)",
}

def strip_code(md):
    return re.sub(r"```.*?```", "", md, flags=re.S)

def analyze(path):
    raw = open(path, encoding="utf-8").read()
    body = strip_code(raw)
    text = re.sub(r"^#.*$", "", body, flags=re.M)
    prose = re.sub(r"`[^`]*`", "X", text)
    sentences = [s for s in re.split(r"(?<=[。？！])", prose.replace("\n", "")) if s.strip()]
    lens = [len(s.strip()) for s in sentences]
    paras = [p for p in re.split(r"\n\s*\n", text) if p.strip() and not p.strip().startswith(("-", "*", "|", "1."))]
    banned = {cat: {w: prose.count(w) for w in ws if prose.count(w)} for cat, ws in JTW_BANNED.items()}
    banned = {k: v for k, v in banned.items() if v}
    return {
        "file": path.split("/")[-1],
        "chars_prose": len(re.sub(r"\s", "", prose)),
        "code_blocks": raw.count("```") // 2,
        "headings": [l.strip() for l in raw.splitlines() if l.startswith("#")],
        "sentences": len(lens),
        "avg_sentence_len": round(sum(lens) / max(len(lens), 1), 1),
        "short_sentences_le15": sum(1 for l in lens if l <= 15),
        "long_sentences_ge80": sum(1 for l in lens if l >= 80),
        "paragraphs": len(paras),
        "bold": len(re.findall(r"\*\*[^*]+\*\*", body)),
        "second_person_anata": prose.count("あなた"),
        "questions": prose.count("？") + prose.count("だろうか") + prose.count("でしょうか"),
        "desu_masu": len(re.findall(r"(です|ます)。", prose)),
        "i_adj_desu": len(I_ADJ_DESU.findall(prose)),
        "jtw_banned_hits": banned,
        "jtw_banned_total": sum(sum(v.values()) for v in banned.values()),
        "crw_leak_hits": {w: len(re.findall(w, prose)) for w in CRW_LEAK if re.findall(w, prose)},
        "fact_coverage": {k: bool(re.search(p, raw)) for k, p in FACT_KEYS.items()},
    }

if __name__ == "__main__":
    res = [analyze(p) for p in sys.argv[1:]]
    print(json.dumps(res, ensure_ascii=False, indent=1))
