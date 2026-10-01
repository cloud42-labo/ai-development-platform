import json
import os
import time
import requests

API_URL = "https://api.typesafe.ai/v1/systemone"
MODEL = "jev-1.13.0"  # same fixed version identifier as the DP-4 pass (§9.2)

# ---------------------------------------------------------------------------
# DP-9 — Task sizing / 1-AI-working-day fit check (Choice + Score, §8.2.3/§8.5)
# ---------------------------------------------------------------------------

DP9_CHOICE_INSTRUCTIONS = (
    "The following state describes a Task as it stood BEFORE execution began "
    "(title, verbatim Acceptance Criteria, count of prior review rounds if this "
    "is a reattempt, and a summary of similar tasks' split history -- never "
    "including this task's own outcome). Judge whether this Task, as scoped, "
    "fits within a single 1-AI-working-day execution unit. Pick exactly one "
    "choice."
)
DP9_CHOICE_CRITERIA = {
    "fits-as-is": "The task as scoped can be designed, implemented, tested, and reviewed to completion within one AI working day without being split.",
    "needs-split": "The task as scoped is too large for one AI working day and should be split into independent sub-tasks before execution.",
    "needs-more-design": "The task's scope or approach is not yet clear enough to size or execute; a design/approach decision must happen first.",
}

DP9_SCORE_INSTRUCTIONS = (
    "Using the same pre-execution state, estimate how many AI working days "
    "this Task will take to complete, expressed as which of the following "
    "ordered duration bands it falls into. Pick the band whose description "
    "best matches your estimate."
)
DP9_SCORE_CRITERIA = [
    "1日以内（ちょうど1日を含む）",
    "1日超〜1.5日以内",
    "1.5日超〜2日以内",
    "2日超〜3日以内",
    "3日超〜4日以内",
    "4日超〜1週間（5 AI稼働日）以内",
    "1週間超〜2週間以内",
    "2週間超〜1ヶ月以内",
    "1ヶ月超（上限なし）",
]

DP9_FIXTURES = [
    {
        "id": "DP9-01",
        "task_id": "ADP-051",
        "task_title": "ADP-051｜レビュー修正コストをTask Time Eventsで自動計測する",
        "task_description": (
            "Task Time EventsはStories & Tasksの更新から自動生成され、Human/AIによる直接編集を必要としない。"
            "初回In Progressで生成されるActive EventはInitial Work、Review→In Progressの再着手で生成される"
            "Active EventはReview Fixとして自動分類される。Review FixではPRレビュー履歴等からReview Sourceを"
            "Codex / Claude / Human / Otherで自動判定する。既存の工数計測・Done gate・polling冪等性を壊さない。"
            "Task単位でInitial Work時間とReview Fix時間を集計でき、Codex起因の修正工数比率を算出できる。"
        ),
        "prior_review_rounds_if_reattempt": 0,
        "similar_task_split_history": "Split From無し（独自起票のオリジナルTask）。",
    },
    {
        "id": "DP9-02",
        "task_id": "ADP-051-B2/B3",
        "task_title": "ADP-051-B2｜Work Type resolverを実装・回帰テストする／ADP-051-B3｜Work Type resolverをTime Event生成へ配線する",
        "task_description": (
            "[ADP-051-B2] 1 AI稼働日以内。状態モデルを契約としてInitial Work / Review Fix resolverを"
            "孤立実装し、対象ケースを回帰テスト化する。Review Source取得・本番配線は含めない。既存テストgreen"
            "を維持する。\n"
            "[ADP-051-B3] 1 AI稼働日以内。B2で検証済みresolverをTime Event生成経路へnon-blockingで配線する。"
            "判定不能時は未分類として処理を継続し、既存Done gate・polling冪等性・回帰テストgreenを維持する。"
        ),
        "prior_review_rounds_if_reattempt": 0,
        "similar_task_split_history": (
            "Split From: ADP-051-B（ADP-051-Bはさらに遡るとADP-051（34ラウンド末にSuperseded・5分割）"
            "から分割されたTask）。二世代目の分割産物であり、分割系譜を持つ。"
        ),
    },
    {
        "id": "DP9-03",
        "task_id": "ADP-051-B",
        "task_title": "ADP-051-B｜Work Type判定を状態モデルに沿って実装する",
        "task_description": (
            "1 AI稼働日以内。ADP-051-Aで確定した状態モデルだけを根拠にInitial Work / Review Fixを判定する。"
            "Review Source取得ロジックは含めない。状態遷移・retry/interruption・reassignment・"
            "ambiguous provenanceの代表ケースを独立した回帰テストとして通す。既存Done gate/polling冪等性を変えない。"
        ),
        "prior_review_rounds_if_reattempt": 0,
        "similar_task_split_history": "Split From: ADP-051（オリジナルTask、34レビューラウンドの末にSupersededとなり5分割されたうちの1つ）。",
    },
    {
        "id": "DP9-04",
        "task_id": "BUG-ADP-TTE-01-B",
        "task_title": "BUG-ADP-TTE-01-B｜Actor実行境界でExecution Eventをstart/stopする",
        "task_description": (
            "Chris/Claude/Codex/Humanの実作業開始境界で明示的Execution Eventをopenできる。Status=In Progress"
            "滞留時間からActive の開始境界を推定しない。同一Task/Actorで重複openを発生させず、異常openは"
            "reconcileで収束する。回帰テストを追加する。（停止側=self-closeは本Taskの範囲外。Code.gs側に"
            "pause-aware close機構がないと安全に実装できないことがCodexレビューで判明したため、別Taskへ切り出す。）"
        ),
        "prior_review_rounds_if_reattempt": 0,
        "similar_task_split_history": "Split From: BUG-ADP-TTE-01（親TaskはBlockerに残存課題を記したままSupersededとなり、複数Subtaskへ分割された）。",
    },
    {
        "id": "DP9-05",
        "task_id": "ADP-057",
        "task_title": "ADP-057｜Instruction / Skill Debtを削減し公式変更監視を標準化する",
        "task_description": (
            "1) ADPが参照するAGENTS.md、CLAUDE.md、Skills、Routine/Scheduler、永続Prompt・運用ルールを棚卸しする。"
            "2) 各指示をKeep / Project-local / Skill Procedure / Duplicate / Conflict / Obsoleteへ分類する。"
            "3) グローバル指示は最小・一貫したSource of Truthへ統合し、同一Policy本文の重複を除去する。"
            "4) CLAUDE.md等の互換入口は本文複製を避け、必要な参照だけにする。"
            "5) 代表Taskで簡素化前後の自律実行、不要確認、停止、レビュー反復、品質を検証する。"
            "6) OpenAI・Anthropic・Googleの公式Release Notes / Changelog / Deprecation / model migration情報を"
            "週1回確認するUpstream Change Watchを実装する。7) X等のSNSはDiscovery Source、公式一次情報を"
            "Source of Truthとし、公式確認前にADPルール変更を確定しない。8) 公式変更をModel / Agent / Skill / "
            "Prompt-Instruction / API / Deprecation / Cost-Safetyへ分類し、ADPへの影響があるものだけTask化する。"
            "9) Weekly RefinementにInstruction / Skill DebtレビューとUpstream Change Watch結果の影響判定を"
            "組み込む。10) 公式更新がない週は新規Taskを作らず、監視自体がルール肥大化を生まない構造にする。"
        ),
        "prior_review_rounds_if_reattempt": 0,
        "similar_task_split_history": "Split From無し、Superseded By無し（標準的な独立Task）。",
    },
    {
        "id": "DP9-06",
        "task_id": "ADP-053",
        "task_title": "ADP-053｜AI Work Sessionsを廃止しTask Time Eventsへ運用を一本化する",
        "task_description": (
            "1) ai-development-platformのgovernance/ai-execution-constraints.mdからAI Work Sessions "
            "open/close必須ゲート、recording節、degradation/検査view依存を除去し、Task Time Events・Task "
            "Result・PR/Commitを既存の実行証跡として扱う。2) Notion Operating Guide、Architecture Stack、"
            "Mission Control/日報など現行運用でAI Work Sessionsを必須または集計元としている参照を洗い出し、"
            "現行運用から除去する。3) Claude/Chris日次自律実行がAI Work Sessionsへ新規rowを作成・更新しないことを"
            "確認する。4) Task Time Eventsの既存運用は壊さず、新規DB/専用ジョブ/代替セッションログを追加しない。"
            "5) AI Work Sessions DBは履歴保持のため即削除せず、書き込み・必須参照がゼロになった後に名称または"
            "説明でDEPRECATED/READ ONLYを明示する。6) 既存AI Work Sessionsデータの移行は行わない。7) GitHubの"
            "変更は通常のレビュー/マージフローでmainへ反映し、Notion Resultに変更箇所と廃止完了証跡を記録する。"
        ),
        "prior_review_rounds_if_reattempt": 0,
        "similar_task_split_history": "Split From無し、Superseded By無し（標準的な独立Task）。",
    },
    {
        "id": "DP9-07",
        "task_id": "ADP-055",
        "task_title": "ADP-055｜月初に前月AI Organization KPIレポートを自動生成する",
        "task_description": (
            "毎月1日に前月のJST 00:00〜月末24:00を対象として自動集計が起動する。Task Time EventsからActive/"
            "Waiting、Actor別、Work Type別、Review Fix Ratioを集計する。Stories & TasksからProduct別の完了"
            "Task数、Lead Time、Blocked/Human Gate関連指標を集計する。GitHubから前月のPR作成数・Merge数を"
            "取得し、可能な限りNotion TaskのProduct relationへ帰属させる。レポートはProduct別を主軸、"
            "Repository別を補助軸とし、PR数やTask数を目標KPIとして扱わない。出力先はAI Organization KPI "
            "Framework配下、タイトルは `AI Organization KPI｜YYYY-MM` とする。同月を再実行した場合は既存ページを"
            "更新し重複作成しない。データ欠損やProduct帰属不能はUnknown/未分類として明示し推測補完しない。"
            "Job Schedule / Routineに月初トリガーを反映し、2026-10-01に2026-09分が自動生成できる状態にする。"
        ),
        "prior_review_rounds_if_reattempt": 0,
        "similar_task_split_history": (
            "Split From無し、Superseded By無し。ただしADP-055-FU／ADP-055-VT／ADP-055-KMIという命名上の"
            "後続Taskが存在する——いずれもSplit From relationでは本Taskに接続されておらず、命名規約が示唆する"
            "系譜と実際のrelationデータが一致しない既知のギャップ。"
        ),
    },
    {
        "id": "DP9-08",
        "task_id": "ADP-044-D",
        "task_title": "ADP-044-D｜Product Vision Quality Standardと承認Gateを定義する",
        "task_description": (
            "Product Visionの品質標準と策定プロセスを定義し、Vision策定・Owner承認・hierarchical-refinementで"
            "共通利用できるGateにする。最低限①Vision種別（Company/Business/Product）と抽象度が適切、"
            "②Purpose/Problem/Opportunity/Evidenceが分離されている、③成功した未来状態がユーザー/事業の"
            "Outcomeとして記述されている、④Solution-neutralで商品形態・UI・技術方式・実装方式・価格/GTM等の"
            "Howを混ぜない、⑤Success Measuresが観測可能で成果物完成を成功としない、⑥Assumption/Unknown/"
            "Non-goalを明示する、⑦Ownerの意思とAI推論を区別しAIが意思を補完しない、⑧戦略・Product Concept・"
            "PRD・Epicへ落とす情報との境界を定義する、⑨Approved条件とRevise条件を明文化する、⑩Cloud42-labo"
            "事業化v0.1と人財ポートフォリオVision v0.1をRegression Caseとして現行の問題を検出できる、"
            "⑪Lifecycle Gateを定義し、Idea/ExperimentalではHuman Raw Ideaと暫定Visionを許容する一方、"
            "Experimentalで得た一次情報を使ってHuman×AI対話でVisionを再言語化し、Products Registry登録／"
            "Product Planning移行前にはQuality Gateを通過したApproved Visionを必須とする、を満たす。"
            "Operating Guide/Product Visionテンプレート/関連Skillへ反映可能な成果物にする。"
        ),
        "prior_review_rounds_if_reattempt": 0,
        "similar_task_split_history": "Split From無し、Superseded By無し（標準的な独立Task）。",
    },
    {
        "id": "DP9-09",
        "task_id": "ADP-059-E",
        "task_title": "ADP-059-E｜Operating Guideを規程体系入口へ縮退しSkills・基準・記録への参照を正規化する",
        "task_description": (
            "個別規程への移管完了後、Operating Guide本文の重複ルールを除去して規程体系への入口/互換リンクに"
            "縮退する。Skills=手順、governance配下のCriteria=基準、Notion/GitHub/brain=記録の参照関係を明示し、"
            "古いPolicy参照を残さない。"
        ),
        "prior_review_rounds_if_reattempt": 0,
        "similar_task_split_history": (
            "Split From無し、Superseded By無し——ただしADP-059自体が最初からA〜Eの独立Subtaskとして設計された"
            "という経緯があり、これは事後的なSplit Fromではなく着手前のApproach Decision時点での意図的な"
            "事前分割というもう一つの正当な値。"
        ),
    },
    {
        "id": "DP9-10",
        "task_id": "BUG-ADP-TTE-01-A",
        "task_title": "BUG-ADP-TTE-01-A｜日報Active集計からProcess Occupancyを分離する",
        "task_description": (
            "日報/KPIのActive集計はSourceだけで判定しない。①明示的Execution Eventは計上する。"
            "②Source=notion_reconcileでも、Actor=Human、State=Active、Started At/Ended Atが観測可能で、"
            "End Status=DoneかつReason=completion_evidenceとして現行Taskの完了証跡と一致するClosed Eventは"
            "Human実働として計上する。③それ以外のStatus滞留由来notion_reconcile EventはProcess Occupancy"
            "として除外する。④Open Eventは合計をN/A化せずClosed Eventのみ合算し品質警告を別表示する。"
            "⑤9/11 AOD第9号note公開（18:12–18:45 JST）を回帰例としてHuman Active=0.55hになることを確認する。"
        ),
        "prior_review_rounds_if_reattempt": 0,
        "similar_task_split_history": "Split From: BUG-ADP-TTE-01（DP9-04と同じ親からの分割）。",
    },
]

# ---------------------------------------------------------------------------
# DP-10 — MISC duplicate / supersede detection (Noul, §8.3.3/§8.6)
# ---------------------------------------------------------------------------

DP10_INSTRUCTIONS = (
    "new_item_text describes a newly-considered item (a candidate new Task to "
    "file). candidate_existing_task_text (with candidate_existing_task_status, "
    "its status at decision time) describes an existing Open Task it might "
    "duplicate or supersede. If candidate_existing_task_text is empty, no "
    "candidate existing task was found at all. Judge whether new_item_text "
    "duplicates or would be superseded by candidate_existing_task_text."
)
DP10_CRITERIA = {
    "true": "new_item_text duplicates, or would be superseded by, candidate_existing_task_text; filing it as a new Task would be redundant.",
    "false": "new_item_text is distinct from candidate_existing_task_text (or no candidate exists); filing it as a new Task is appropriate.",
}

DP10_FIXTURES = [
    {
        "id": "DP10-06",
        "new_item_text": (
            "2026-09-20 Daily Close時点で検討された、ai-development-platform PR #53（ADP-044-Dのペア"
            "PR、skills#26は既にmerge済みだがPR #53自身はmain conflictで未完了）の conflict解消フォローアップ用の"
            "新規Task。"
        ),
        "candidate_existing_task_text": (
            "ADP-044-D｜Product Vision Quality Standardと承認Gateを定義する——Acceptance Criteriaに定義された"
            "Vision品質基準・承認Gateの策定が目的で、PR #53はこのTaskの成果物。"
        ),
        "candidate_existing_task_status": "Review相当（2026-09-20時点。ADP-044-DはStarted At 2026-09-14、Completed At 2026-09-22のため、判定時点ではまだ未完了）",
    },
    {
        "id": "DP10-07",
        "new_item_text": "2026-09-22 Daily Close時点で検討された、ADP-065 Jev PoC（T03）の採否・本番導入検討用の新規Task起票案。",
        "candidate_existing_task_text": (
            "ADP-065-T04｜Decision Canonical接続方式とJev採否を確定する——T03のPoC結果を受けてDecision "
            "Adapterの接続方式・Jev採否を確定するためのTask。T03への依存（Dependency: ADP-065-T03）を明示して"
            "既に存在していた。"
        ),
        "candidate_existing_task_status": "Backlog/Ready相当（2026-09-22時点でT03から見た既存の後続依存Task）",
    },
    {
        "id": "DP10-08",
        "new_item_text": (
            "2026-09-25 Daily Close PR Flow Gateで検出された、cloud42-labo/skills PR #51（head 230aa011fb、"
            "Codex P1指摘1件未解決）を紐づける新規Task起票案。"
        ),
        "candidate_existing_task_text": "",
        "candidate_existing_task_status": "",
    },
    {
        "id": "DP10-09",
        "new_item_text": (
            "2026-09-26 Daily Close PR Flow Gateで検出された、cloud42-labo/skills PR #52（生成元変更要求/Task"
            "との対応未確定）を紐づける新規Task起票案。"
        ),
        "candidate_existing_task_text": "",
        "candidate_existing_task_status": "",
    },
]


def call_systemone(questions):
    payload = {"model": MODEL, "state": questions["state"], "questions": questions["questions"]}
    t0 = time.monotonic()
    resp = requests.post(API_URL, json=payload, timeout=60)
    elapsed_ms = (time.monotonic() - t0) * 1000.0
    return resp, elapsed_ms


def build_dp9_request(fx):
    state = {
        "task_id": fx["task_id"],
        "task_title": fx["task_title"],
        "task_description": fx["task_description"],
        "prior_review_rounds_if_reattempt": fx["prior_review_rounds_if_reattempt"],
        "similar_task_split_history": fx["similar_task_split_history"],
    }
    questions = {
        "policy_fit_choice": {
            "type": "choice",
            "instructions": DP9_CHOICE_INSTRUCTIONS,
            "criteria": DP9_CHOICE_CRITERIA,
        },
        "ai_workdays_score": {
            "type": "score",
            "instructions": DP9_SCORE_INSTRUCTIONS,
            "criteria": DP9_SCORE_CRITERIA,
        },
    }
    return {"state": state, "questions": questions}


def build_dp10_request(fx):
    state = {
        "new_item_text": fx["new_item_text"],
        "candidate_existing_task_text": fx["candidate_existing_task_text"],
        "candidate_existing_task_status": fx["candidate_existing_task_status"],
    }
    questions = {
        "duplicate_noul": {
            "type": "noul",
            "instructions": DP10_INSTRUCTIONS,
            "criteria": DP10_CRITERIA,
        }
    }
    return {"state": state, "questions": questions}


def run_batch(fixtures, build_request_fn, out_path, reps=4):
    results = []
    # Resume-safe checkpointing, same per-call-index protocol as jev_dp4_poc.py.
    prior_by_id = {}
    if os.path.exists(out_path):
        with open(out_path) as f:
            try:
                prev = json.load(f)
            except json.JSONDecodeError:
                prev = []
        for entry in prev:
            fx_id = entry.get("fixture_id")
            if fx_id:
                prior_by_id[fx_id] = [
                    c for c in entry.get("calls", [])
                    if c.get("status") == 200 and c.get("call_index") in range(reps)
                ]

    calls_by_id = {}
    for fx in fixtures:
        calls = list(prior_by_id.get(fx["id"], []))
        calls_by_id[fx["id"]] = calls
        results.append({"fixture_id": fx["id"], "fixture": fx, "calls": calls})

    def checkpoint():
        with open(out_path, "w") as f:
            json.dump(results, f, indent=2, ensure_ascii=False)

    for fx in fixtures:
        calls = calls_by_id[fx["id"]]
        done = {c["call_index"] for c in calls}
        if done == set(range(reps)):
            print(f"=== {fx['id']} === (skipped: already complete)")
            continue
        print(f"=== {fx['id']} ===")
        req = build_request_fn(fx)
        for i in range(reps):
            if i in done:
                print(f"  call {i}: skipped (already succeeded)")
                continue
            resp, elapsed_ms = call_systemone(req)
            ok = resp.status_code == 200
            try:
                body = resp.json()
            except ValueError:
                body = {"raw_text": resp.text[:2000]}
            if ok:
                calls.append({
                    "call_index": i,
                    "status": resp.status_code,
                    "latency_ms": round(elapsed_ms, 1),
                    "answers": body.get("answers"),
                    "model_used": body.get("model"),
                    "input_tokens": body.get("usage", {}).get("input_tokens"),
                    "output_tokens": body.get("usage", {}).get("output_tokens"),
                })
                print(f"  call {i}: status={resp.status_code} latency={elapsed_ms:.0f}ms "
                      f"in_tok={body.get('usage', {}).get('input_tokens')} answers={body.get('answers')}")
            else:
                calls.append({
                    "call_index": i,
                    "status": resp.status_code,
                    "latency_ms": round(elapsed_ms, 1),
                    "error_body": body,
                })
                print(f"  call {i}: status={resp.status_code} ERROR={body}")
            checkpoint()
    return results


def main():
    base = os.path.dirname(os.path.abspath(__file__))
    dp9_out = os.path.join(base, "dp9_raw_results.json")
    dp10_out = os.path.join(base, "dp10_raw_results.json")

    print("##### DP-9 #####")
    run_batch(DP9_FIXTURES, build_dp9_request, dp9_out, reps=4)
    print("\n##### DP-10 #####")
    run_batch(DP10_FIXTURES, build_dp10_request, dp10_out, reps=4)

    print(f"\nSaved {dp9_out} and {dp10_out}.")


if __name__ == "__main__":
    main()
