# Epic Goal Quality Standard

> **Artifact status:** durable quality gate for ADP-054-T19.
> **Applies to:** Epic `Objective` / `Success Metric` review inside `hierarchical-refinement`, for every Epic regardless of lifecycle Stage.
> **Authority boundary:** Owner intent is authoritative for what an Epic pursues; AI may structure, challenge, compare, and expose assumptions, but must not invent Owner intent and must not fix a solution to compensate for an unclear Epic Goal.

## 1. Purpose

An Epic Goal (`Objective` + `Success Metric`) is the decision boundary between an Approved Vision and the Story/Task decomposition that implements it. This standard defines the minimum quality required before an Epic Goal is treated as sound enough to let its Story/Task work reach `Approved` / `Ready`.

The Gate prevents the recurring failure mode this standard's regression cases (Section 10) reproduce: **an Epic Goal locks in a specific solution, mechanism, or product form before that solution has been validated**, so that later evidence cannot change the solution without appearing to abandon the Epic itself. `docs/product-vision-quality-standard.md` §11 names this consumption relationship directly: "Epic Goal quality review consumes the Approved Vision; it must not compensate for a weak Vision by inventing a better one downstream." This document is that consuming Gate.

## 2. Relationship to the Vision Gate

This Gate runs **after** the Product Vision Quality Gate (`docs/product-vision-quality-standard.md`) and only against an Epic whose upstream Vision is `Approved` for the relevant lifecycle transition, or `Provisional` on the Provisional Exploration path defined there. An Epic cannot repair a `Revise` / `Unverified` Vision by writing a stronger Epic Goal; `hierarchical-refinement` stops at the Vision layer in that case and this Gate is not reached.

## 3. The seven checks

Evaluate every Epic `Objective` and `Success Metric` against all seven checks before deciding Keep / Revise for that Epic in `hierarchical-refinement` step 2.

### 3.1 Vision causality
Does the Epic Goal trace to a specific statement in the Approved (or Provisional-exploration) Vision? An Epic Goal that cannot be connected to an upstream Purpose/Problem/Opportunity/Outcome is either mis-scoped or is quietly substituting for a Vision gap.

### 3.2 Solution-neutral problem framing
Is the problem to solve / state to change expressed independent of how it will be solved? A goal that only makes sense assuming one particular mechanism, screen, or system is a solution statement wearing a goal's grammar.

### 3.3 Why now / Evidence / prior facts
Does the Epic state the observed fact or event that makes this Epic timely (a trial result, a failed real-device check, a market signal, an Owner decision), separated from interpretation? An Epic with no stated Why-now cannot be distinguished from an arbitrary backlog re-shuffle.

### 3.4 Outcome-shaped Success Metric
Is the Success Metric a user/business/learning Outcome that can be false even after every Story is marked Done, rather than "N Stories are complete" or "the artifact exists"? Artifact completion is a proxy, not the Outcome itself; a Success Metric that equals a checklist of deliverables fails this check.

### 3.5 Assumptions / Unknowns / Non-goals stated
Does the Epic name what it assumes but has not verified, and what it deliberately excludes? An Epic silent on its own Unknowns cannot be distinguished from an Epic that has none, and both cases block honest risk sequencing.

### 3.6 No pre-validation solution lock-in
Does the Epic avoid fixing the product form, UI, architecture, specific simulation/automation mechanism, or implementation technique before that choice has been validated? This is the sharpest of the seven checks and the one both regression cases in Section 10 fail: a Success Metric or Objective that names a concrete mechanism ("this cockpit UI", "this game structure", "this priced package") has already spent the Epic's decision budget on a How the Epic has not earned the right to fix yet.

### 3.7 Delivery-vs-Discovery routing
When the Epic's central Assumption/Unknown is high-uncertainty (the underlying concept, identity, or mechanism itself is unvalidated — not merely its implementation details), does the Epic route to a Discovery/Research Epic rather than a Delivery Epic? Committing full Delivery-grade Story/Task structure to a goal that is still an untested hypothesis reproduces the same failure this Gate exists to catch, one layer down.

## 4. Gate output contract

For every Epic reviewed in `hierarchical-refinement` step 2, record:

- `Vision Causality`: Pass / Revise
- `Solution-Neutral Problem Framing`: Pass / Revise
- `Why Now / Evidence`: Pass / Revise / Unverified
- `Success Metric Outcome Quality`: Pass / Revise
- `Assumptions / Unknowns / Non-goals`: Pass / Revise
- `Pre-validation Solution Lock-in`: Pass / Revise
- `Delivery vs Discovery Routing`: Pass / Revise / N-A (N-A when uncertainty is already low enough that Delivery is the correct routing)
- `Epic Goal Gate Result`: Pass / Revise / Unverified
- `Gate Notes`

`Epic Goal Gate Result = Pass` requires all seven checks to be `Pass` (or `N-A` for 3.7 only). Any single `Revise` makes the overall result `Revise`. Use `Unverified` only when the Epic Goal's own wording is too sparse to evaluate a check at all (not as a softer alternative to `Revise` when the wording is present but fails the check).

## 5. Gate Rule tie-in

This Gate feeds directly into `hierarchical-refinement`'s existing Epic decision (`Keep / Revise / Add / Merge / Stop / Reorder / Exploration Keep / Exploration Add / Exploration Revise`): an Epic whose `Epic Goal Gate Result` is `Revise` or `Unverified` cannot be decided `Keep` (or an `Exploration Keep`) on this pass. Per the Skill's own Gate Rule ("上位がRevise / Stop / Unverifiedなら、その配下をApproved / Readyにしない"), a `Revise` / `Unverified` Epic Goal Gate Result keeps every Story and Task under that Epic out of `Approved` / `Ready` until the Epic Goal itself is rewritten and re-passes this Gate. Do not let a locally well-formed Story or Task compensate for an Epic Goal that fails this Gate.

## 6. Non-goals

- This Gate does not re-litigate the Vision layer; a Vision defect surfaces as a `Revise` at the Vision Gate, not as a `Pre-validation Solution Lock-in` finding here.
- This Gate does not select the correct solution on the Epic's behalf. Failing Check 3.6 means "remove the solution commitment from the Goal," not "AI should decide which solution belongs there instead."
- This Gate does not require a Discovery Epic for every uncertainty. Check 3.7 only triggers when the central, load-bearing Assumption is unvalidated — ordinary implementation-detail uncertainty inside an otherwise valid Delivery Epic does not force a re-route.

## 7. Regression cases

The fixtures below are deterministic Gate inputs, reproducing two defect shapes this project actually shipped and later had to unwind, so a reviewer cannot pass the regression by restating the expected answer alone. Both are drawn from `Vibe Product Development` history (Notion `Roadmap & Epics`); wording is paraphrased from the actual Objective/Success Metric fields, not invented.

### Case A — EPIC-HPM-02 (management simulation cockpit lock-in)

**Input fixture:**

```text
Epic: EPIC-HPM-02｜事業目標から逆算した戦略的人財配置と業績連動を設計する
Objective: 事業目標とKPIから必要な人財ポートフォリオを逆算し、限られた予算を人数・スキル・
  年齢構成・モチベーションのどこへ投下するかを判断でき、その結果が5年間のKPIと決算へ
  どう連動したか説明できるシンプルなゲームへ再設計する。
Success Metric: プレイヤーが、事業目標→KPI目標→必要人財ポートフォリオ→現状ギャップ→
  投資可能予算→採用・育成・配置・モチベーション施策→5年間の人財変化→KPI→決算、の
  因果を追え、経営コックピット上で複数視点を同時に比較して投資判断できる。
```

**Required Gate behavior:**

- `Solution-Neutral Problem Framing = Revise`: "シンプルなゲームへ再設計する" and "経営コックピット上で" name the delivery mechanism (a game, a specific cockpit UI pattern) inside the Objective/Success Metric themselves, not as downstream Story/Task decomposition.
- `Pre-validation Solution Lock-in = Revise`: the causal chain (事業目標→KPI→人財ポートフォリオ→…→決算) and the "経営コックピット" interface were fixed before real-device play testing validated that this chain and this interface were the right teaching mechanism for the underlying learning outcome.
- `Delivery vs Discovery Routing = Revise`: the central Unknown — whether this specific decision-chain-plus-cockpit design actually teaches strategic workforce allocation — was still unvalidated, yet the Epic proceeded as full Delivery (37 Tasks) rather than a smaller Discovery/prototype pass.
- A passing rewrite states the Outcome independent of the mechanism (for example: decision-makers can learn to trace how workforce investment choices affect multi-year business results) and defers "is a game the right vehicle, and is a cockpit UI the right layout" to Story-level validation before committing to full implementation.
- `Epic Goal Gate Result = Revise` until the Objective/Success Metric are rewritten to the Outcome above. This is exactly what happened in practice: EPIC-HPM-03 ("経営ゲーム体験をコンセプトから再設計する") had to be opened after a 2026-09-12 real-device evaluation forced a from-scratch concept redesign of EPIC-HPM-02's game structure, variables, and cockpit — the cost this Gate exists to avoid paying after Delivery has already started.

### Case B — BUS-00〜03 (Cloud42-labo commercialization before identity)

**Input fixture:**

```text
Epic: BUS-01｜損益分岐点を明らかにし、事業目標を設定する（and sibling BUS-02/BUS-03）
Objective (as actually pursued): AODを90分・5万円の診断/ワークショップとして商品化し、
  市場検証へ進む。
Success Metric (as actually pursued): 損益分岐点と事業目標を確定し、当該商品パッケージの
  市場検証を完了する。
```

**Required Gate behavior:**

- `Vision Causality = Revise`: at the time these Epics ran, Cloud42-labo's own事業アイデンティティ（Product Company / Research Lab / Consulting / Hybrid等）had not been decided. A commercialization Epic cannot trace to an upstream Vision decision that does not yet exist.
- `Pre-validation Solution Lock-in = Revise`: "90分・5万円の診断/ワークショップ" is a fully specified product form, price, and packaging — exactly the kind of downstream How Section 3.6 asks the Epic Goal to leave unfixed — committed before the prior question ("what kind of business is Cloud42-labo, and does it even sell workshops") was answered.
- `Delivery vs Discovery Routing = Revise`: the central Unknown was the business identity itself, a Discovery-grade question, yet the Epic ran a full commercialization Delivery pass (cost structure, pricing, market validation) on top of it.
- A passing rewrite keeps BUS-01〜03's cost/market findings as reusable evidence (per BUS-00's own stated principle: "既存BUS-01〜03の成果は廃棄せず、仮説・市場調査・コスト情報として再利用する") but does not let a Success Metric assume the 90分/5万円 package is the answer before BUS-00's identity work (Purpose/Mission/Vision/Values → 事業アイデンティティ → ドメイン → 資産 → ビジネスモデル案) exists.
- `Epic Goal Gate Result = Revise` until Purpose/business-identity precedes product-form commitment. This is exactly the sequencing BUS-00 was opened to restore: "『何者として、どの価値を、どのビジネスモデルで提供するか』という上位設計と、個別商品仮説の順序が逆転した" — the Epic Goal Gate's job is to catch that inversion before an Epic starts, not after a redesign Epic has to be opened to undo it.

## 8. Usage

- `hierarchical-refinement` step 2 ("Epic") invokes this Gate for every Epic under review and records the Section 4 output contract alongside its existing Epic decision.
- `templates/epic-brief.md`'s Outcome/Scope/Non-goals sections should be filled so this Gate can be evaluated directly from the Epic Brief without additional interviewing.
- A `Revise` / `Unverified` `Epic Goal Gate Result` is itself the finding to report back to the Epic's owner (Human or AI PM); it is not silently downgraded to a Story-level note.
