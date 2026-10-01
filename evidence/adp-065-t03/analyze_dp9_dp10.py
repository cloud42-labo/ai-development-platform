import json
import os
import statistics

BASE = os.path.dirname(os.path.abspath(__file__))
PRICE_PER_MTOK = 0.042  # same rate observed in the DP-4 pass (§9.4)

# --- Corrected ground truth for DP-9, derived in this session from Notion
# Started At / Completed At (or Closed At) wall-clock elapsed time and the
# task's own Result text -- NOT from the anomalous Task Time Events duration
# flagged in §8.5.4. See the new §9.9 writeup for full reasoning per task.
DP9_GROUND_TRUTH = {
    "DP9-01": {"gt": "needs-split", "admit": True, "note": "Owner split into 5 Tasks after 34 review rounds; elapsed Started->Closed ~37h29m."},
    "DP9-02": {"gt": "needs-split", "admit": True, "note": "Split into B4/B5/B6 after 9 review rounds, 20+ real bugs found; elapsed ~17-18h."},
    "DP9-03": {"gt": "needs-split", "admit": True, "note": "CORRECTED from original circular fits-as-is: Result text confirms AC (Work Type judgment) unmet, Superseded; elapsed Started->Completed ~9h38m (>8h)."},
    "DP9-04": {"gt": "fits-as-is", "admit": True, "note": "Done cleanly; elapsed Started->Completed ~5h42m (<8h); frozen AC already reflects the post-split (open-side-only) scope that was actually executed."},
    "DP9-05": {"gt": "needs-split", "admit": True, "note": "CORRECTED from original fits-as-is (PR-proxy-based): Type=Story, Created 2026-09-05 -> Completed 2026-09-21 (16 days, multiple session windows with partial progress each); population mismatch (Story, not an atomic Task) flagged separately."},
    "DP9-06": {"gt": "fits-as-is", "admit": True, "note": "Done cleanly, same-day; elapsed Started->Completed ~5h20m (<8h)."},
    "DP9-07": {"gt": "fits-as-is", "admit": False, "note": "Raw elapsed Started->Completed ~25h01m (>8h) but spans an overnight gap; Waiting time not independently verified/subtracted -- excluded from strict Accuracy per the existing documented caution, not confirmed or contradicted."},
    "DP9-08": {"gt": "needs-split", "admit": True, "note": "CORRECTED from original fits-as-is (PR-proxy-based): elapsed Started->Completed ~8 days (193h); Result text confirms main conflict resolution + 3 unresolved Codex P1 findings fixed across that span, cross-AI (ChatGPT-authored, Claude-reviewed)."},
    "DP9-09": {"gt": "fits-as-is", "admit": False, "note": "Status=Review, not Done; no Completed At exists; no independent completion evidence available this session."},
    "DP9-10": {"gt": "fits-as-is", "admit": False, "note": "Status=Review, not Done; no Completed At exists; no independent completion evidence available this session."},
}

CONF_THRESHOLD = 0.7


def mapped_score_band(score_probs):
    # argmax over indices 0..8; tie-break = highest index among ties (fail to
    # the more-escalating side), per §8.2.3.
    best_idx = None
    best_p = -1.0
    for i in range(9):
        p = score_probs[str(i)]
        if p >= best_p:
            best_p = p
            best_idx = i
    return best_idx + 2, best_idx, best_p


def dp9_final_decision(call):
    choice = call["answers"]["policy_fit_choice"]["choice"]
    choice_conf = call["answers"]["policy_fit_choice"]["confidence"]
    score_probs = call["answers"]["ai_workdays_score"]["probabilities"]
    band, idx, score_conf = mapped_score_band(score_probs)
    no_escalate = (
        choice == "fits-as-is"
        and choice_conf >= CONF_THRESHOLD
        and score_conf >= CONF_THRESHOLD
        and band == 2
    )
    return {
        "choice": choice,
        "choice_confidence": choice_conf,
        "mapped_score_band": band,
        "score_confidence": score_conf,
        "final": "no-escalate" if no_escalate else "escalate",
    }


def load(path):
    with open(path) as f:
        return json.load(f)


def analyze_dp9():
    data = load(os.path.join(BASE, "dp9_raw_results.json"))
    print("=" * 80)
    print("DP-9 per-fixture results")
    print("=" * 80)
    rows = []
    all_latencies_first = []
    all_latencies_all = []
    total_input_tokens = 0
    total_input_tokens_first = 0
    for entry in data:
        fid = entry["fixture_id"]
        calls = sorted(entry["calls"], key=lambda c: c["call_index"])
        decisions = [dp9_final_decision(c) for c in calls]
        first = decisions[0]
        choices = [d["choice"] for d in decisions]
        bands = [d["mapped_score_band"] for d in decisions]
        finals = [d["final"] for d in decisions]
        choice_stable = len(set(choices)) == 1
        band_stable = len(set(bands)) == 1
        final_stable = len(set(finals)) == 1
        for i, c in enumerate(calls):
            lat = c["latency_ms"]
            all_latencies_all.append(lat)
            if i == 0:
                all_latencies_first.append(lat)
                total_input_tokens_first += c["input_tokens"]
            total_input_tokens += c["input_tokens"]
        gt = DP9_GROUND_TRUTH[fid]
        rows.append({
            "id": fid,
            "first_choice": first["choice"],
            "first_choice_conf": first["choice_confidence"],
            "first_band": first["mapped_score_band"],
            "first_score_conf": first["score_confidence"],
            "first_final": first["final"],
            "choice_stable_4of4": choice_stable,
            "band_stable_4of4": band_stable,
            "final_stable_4of4": final_stable,
            "gt": gt["gt"],
            "admit": gt["admit"],
            "gt_note": gt["note"],
        })
        print(f"{fid}: choice={first['choice']} (conf={first['choice_confidence']:.2f}) "
              f"band={first['mapped_score_band']} (score_conf={first['score_confidence']:.2f}) "
              f"final={first['final']} | reproducibility: choice_4of4={choice_stable} "
              f"band_4of4={band_stable} final_4of4={final_stable} | gt={gt['gt']} admit={gt['admit']}")

    print()
    admitted = [r for r in rows if r["admit"]]
    correct = [r for r in admitted if r["first_choice"] == r["gt"]]
    print(f"Admitted fixtures (non-circular, independently verified ground truth): {len(admitted)}/10")
    print(f"  -> {[r['id'] for r in admitted]}")
    print(f"Accuracy (raw Choice vs corrected ground truth, admitted only): {len(correct)}/{len(admitted)} = {100*len(correct)/len(admitted):.1f}%")

    # Escalation-attribute based metrics (uses final decision after confidence+score gating)
    expected_escalate = {r["id"]: (r["gt"] != "fits-as-is") for r in admitted}
    fe_denom = [r for r in admitted if not expected_escalate[r["id"]]]  # gt fits-as-is
    fe_num = [r for r in fe_denom if r["first_final"] == "escalate"]
    me_denom = [r for r in admitted if expected_escalate[r["id"]]]  # gt needs-split
    me_num = [r for r in me_denom if r["first_final"] == "no-escalate"]
    print(f"False-escalation rate (gt=fits-as-is denom={len(fe_denom)}): {len(fe_num)}/{len(fe_denom)}"
          + (f" = {100*len(fe_num)/len(fe_denom):.1f}%" if fe_denom else " (denom=0)"))
    print(f"Missed-escalation rate (gt=needs-split denom={len(me_denom)}): {len(me_num)}/{len(me_denom)}"
          + (f" = {100*len(me_num)/len(me_denom):.1f}%" if me_denom else " (denom=0)"))

    print(f"\nReproducibility: choice stable 4/4 in {sum(r['choice_stable_4of4'] for r in rows)}/10 fixtures; "
          f"mapped_score_band stable 4/4 in {sum(r['band_stable_4of4'] for r in rows)}/10; "
          f"final decision stable 4/4 in {sum(r['final_stable_4of4'] for r in rows)}/10")

    lat_first_sorted = sorted(all_latencies_first)
    lat_all_sorted = sorted(all_latencies_all)
    def pct(sorted_list, p):
        k = max(0, min(len(sorted_list) - 1, round(p / 100 * (len(sorted_list) - 1))))
        return sorted_list[k]
    print(f"\nLatency (10 initial calls, wall-clock): p50={pct(lat_first_sorted,50):.0f}ms p95={pct(lat_first_sorted,95):.0f}ms "
          f"min={min(lat_first_sorted):.0f}ms max={max(lat_first_sorted):.0f}ms")
    print(f"Latency (all 40 calls, reference): p50={pct(lat_all_sorted,50):.0f}ms p95={pct(lat_all_sorted,95):.0f}ms "
          f"min={min(lat_all_sorted):.0f}ms max={max(lat_all_sorted):.0f}ms")

    cost_first = total_input_tokens_first * PRICE_PER_MTOK / 1_000_000
    cost_all = total_input_tokens * PRICE_PER_MTOK / 1_000_000
    print(f"\nCost: 10 initial calls = {total_input_tokens_first} input tokens -> ${cost_first:.6f}")
    print(f"Cost: all 40 calls (10 fixtures x 4 reps) = {total_input_tokens} input tokens -> ${cost_all:.6f}")
    return rows, cost_all, total_input_tokens


def analyze_dp10():
    data = load(os.path.join(BASE, "dp10_raw_results.json"))
    print()
    print("=" * 80)
    print("DP-10 per-fixture results")
    print("=" * 80)
    gt = {
        "DP10-06": True,
        "DP10-07": True,
        "DP10-08": False,
        "DP10-09": False,
    }
    rows = []
    all_lat_first = []
    all_lat_all = []
    total_tokens = 0
    total_tokens_first = 0
    for entry in data:
        fid = entry["fixture_id"]
        calls = sorted(entry["calls"], key=lambda c: c["call_index"])
        nouls = [c["answers"]["duplicate_noul"]["noul"] for c in calls]
        first = nouls[0]
        flag = first >= CONF_THRESHOLD
        stable = (max(nouls) - min(nouls)) < 0.02  # effectively identical across reps
        flags_all_same = all((n >= CONF_THRESHOLD) == flag for n in nouls)
        for i, c in enumerate(calls):
            all_lat_all.append(c["latency_ms"])
            total_tokens += c["input_tokens"]
            if i == 0:
                all_lat_first.append(c["latency_ms"])
                total_tokens_first += c["input_tokens"]
        rows.append({"id": fid, "noul_first": first, "flag": flag, "gt": gt[fid],
                      "nouls_all": nouls, "stable": stable, "flag_stable_4of4": flags_all_same})
        print(f"{fid}: noul(yes-prob)={first:.2f} -> flag={'duplicate' if flag else 'not-duplicate'} "
              f"(threshold 0.7) | reps={nouls} | gt_duplicate={gt[fid]}")

    correct = [r for r in rows if r["flag"] == r["gt"]]
    print(f"\nAccuracy (4/4 admissible, population-mismatch caveat noted in §9.9): {len(correct)}/4 = {100*len(correct)/4:.1f}%")
    fe_denom = [r for r in rows if not r["gt"]]  # gt=No
    fe_num = [r for r in fe_denom if r["flag"]]
    me_denom = [r for r in rows if r["gt"]]  # gt=Yes
    me_num = [r for r in me_denom if not r["flag"]]
    print(f"False-escalation rate (gt=No denom={len(fe_denom)}): {len(fe_num)}/{len(fe_denom)} = {100*len(fe_num)/len(fe_denom):.1f}%")
    print(f"Missed-escalation rate (gt=Yes denom={len(me_denom)}): {len(me_num)}/{len(me_denom)} = {100*len(me_num)/len(me_denom):.1f}%")
    print(f"Reproducibility: noul value effectively stable (range<0.02) in {sum(r['stable'] for r in rows)}/4 fixtures; "
          f"threshold-flag stable 4/4 in {sum(r['flag_stable_4of4'] for r in rows)}/4 fixtures")

    def pct(sorted_list, p):
        k = max(0, min(len(sorted_list) - 1, round(p / 100 * (len(sorted_list) - 1))))
        return sorted_list[k]
    lf = sorted(all_lat_first)
    la = sorted(all_lat_all)
    print(f"\nLatency (4 initial calls): p50={pct(lf,50):.0f}ms p95={pct(lf,95):.0f}ms min={min(lf):.0f}ms max={max(lf):.0f}ms")
    print(f"Latency (all 16 calls, reference): p50={pct(la,50):.0f}ms p95={pct(la,95):.0f}ms min={min(la):.0f}ms max={max(la):.0f}ms")

    cost_first = total_tokens_first * PRICE_PER_MTOK / 1_000_000
    cost_all = total_tokens * PRICE_PER_MTOK / 1_000_000
    print(f"\nCost: 4 initial calls = {total_tokens_first} input tokens -> ${cost_first:.6f}")
    print(f"Cost: all 16 calls (4 fixtures x 4 reps) = {total_tokens} input tokens -> ${cost_all:.6f}")
    return rows, cost_all, total_tokens


if __name__ == "__main__":
    _, dp9_cost, dp9_tokens = analyze_dp9()
    _, dp10_cost, dp10_tokens = analyze_dp10()
    print()
    print("=" * 80)
    print(f"TOTAL cost this pass (DP-9 + DP-10, all calls): ${dp9_cost + dp10_cost:.6f} "
          f"({dp9_tokens + dp10_tokens} input tokens)")
    print(f"Combined with prior DP-4 pass ($0.001043): ${dp9_cost + dp10_cost + 0.001043:.6f}")
