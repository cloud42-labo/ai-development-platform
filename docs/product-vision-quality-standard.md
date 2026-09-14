# Product Vision Quality Standard

> **Artifact status:** durable quality gate for ADP-044-D.  
> **Applies to:** Company / Business / Product Vision decisions that feed Product Planning, hierarchical refinement, and downstream PRD/Epic design.  
> **Authority boundary:** Owner intent is authoritative for purpose and direction; AI may structure, challenge, compare, and expose assumptions, but must not invent Owner intent.

## 1. Purpose

A Vision is a decision boundary for downstream planning, not a container for every business idea. This standard defines the minimum quality required before a Vision is treated as `Approved` and used to justify Epic / Story / Task structure.

The Gate prevents two recurring failure modes:

1. **Wrong abstraction level** — Company/Business questions are forced into a Product Vision and mixed with customer segments, product form, GTM, pricing, revenue model, UI, or technology.
2. **Premature solution lock-in** — a proposed implementation or simulation is treated as the Vision itself, making later evidence unable to change the solution without appearing to abandon the purpose.

## 2. Vision types and abstraction boundary

| Vision type | Primary question | Valid content | Must remain downstream |
|---|---|---|---|
| Company Vision | What future state should the organization create or become? | purpose, stakeholder value, desired future state, strategic direction | business portfolio, product choices, GTM, implementation |
| Business Vision | What future state should a business/domain create for customers and the enterprise? | problem/opportunity, customer/business outcome, evidence, success measures | product form, pricing/GTM design, detailed business model, implementation |
| Product Vision | What future state should users/business reach because this Product exists? | target context, problem/opportunity, outcome, evidence, success measures, assumptions | feature set, UI, architecture, algorithm, detailed pricing/GTM, implementation |

If the question being answered belongs to a higher or lower layer, classify it there instead of stretching the current Vision type.

## 3. Required structure

An Approved Vision must distinguish the following explicitly.

### 3.1 Purpose
Why this area matters and why the organization is willing to invest attention/resources in it.

### 3.2 Problem
The current undesirable condition experienced by the relevant user/stakeholder/business. Describe the condition, not the proposed remedy.

### 3.3 Opportunity
The meaningful future improvement that becomes possible if the problem is addressed. Opportunity is not a chosen product form.

### 3.4 Evidence
Observed facts supporting the Problem/Opportunity. Separate direct evidence from interpretation. Unknowns must not be written as facts.

### 3.5 Desired future state / Outcome
Describe success as a changed user/business state. The Vision must still make sense if the eventual solution, interface, architecture, or go-to-market method changes.

### 3.6 Success Measures
Measures must be observable and outcome-oriented. Completion of an artifact, feature, document, or implementation is not itself Vision success.

### 3.7 Assumptions / Unknowns
State what is believed but not yet established, and what evidence would reduce uncertainty.

### 3.8 Non-goals
State adjacent outcomes this Vision intentionally does not optimize for.

### 3.9 Owner intent vs AI inference
Mark which statements are explicit Owner intent and which are AI-proposed interpretations/hypotheses. AI inference remains candidate material until the Owner accepts it.

## 4. Solution-neutrality test

A Vision fails the Gate when its core statement requires a specific How to remain meaningful.

Move the following downstream unless they are themselves an externally fixed constraint:

- product/service form or package
- feature list or UI flow
- architecture, model, algorithm, platform, vendor, or implementation technique
- specific simulation/automation mechanism
- detailed pricing, channel, campaign, or GTM design
- detailed revenue model mechanics
- Epic/Story/Task decomposition

A useful test is: **If this proposed solution disappeared tomorrow, would the desired future state still be worth pursuing?** If not, the statement is probably a solution concept rather than a Vision.

## 5. Lifecycle Gate

### Idea
- Human Raw Idea is valid input.
- It may be incomplete, emotional, intuitive, or solution-shaped.
- Do not pretend it is an Approved Vision.

### Experimental
- A provisional Vision may guide exploration.
- Primary information from experiments, prototypes, users, market observation, or direct operation is collected.
- AI may challenge assumptions, produce alternative interpretations, and structure evidence.
- Human × AI dialogue must re-articulate the Vision using the new evidence before promotion.

### Product Registry / Product Planning entry
Before registration/promotion into formal Product Planning, an **Approved Vision is mandatory**. It must pass every Approved condition below. A Raw Idea or provisional Vision cannot be used as the permanent justification for downstream Epics.

### Major pivot
Re-run the Gate when the target user/stakeholder, problem/opportunity, desired future state, or fundamental evidence changes. Do not rewrite merely because implementation details change.

## 6. Approved conditions

`Approved` requires all of the following:

1. Vision type is explicit and abstraction level is appropriate.
2. Purpose, Problem, Opportunity, and Evidence are separated.
3. Desired future state is expressed as a user/business Outcome.
4. Core Vision is solution-neutral; downstream How is not mixed into it.
5. Success Measures are observable Outcomes, not artifact completion.
6. Assumptions, Unknowns, and Non-goals are explicit.
7. Owner intent and AI inference are distinguishable; AI has not silently completed Owner intent.
8. Boundaries to Strategy, Product Concept, PRD, Epic, and implementation are explicit.
9. Evidence is sufficient for the lifecycle transition being requested; unsupported certainty is not introduced.
10. Owner has explicitly accepted the resulting Vision wording for the requested lifecycle transition.

## 7. Revise conditions

Return `Revise` rather than `Approved` when any of the following is true:

- wrong Vision type or mixed abstraction levels
- Problem and proposed Solution are inseparable
- customer, product form, GTM, price, revenue mechanics, UI, or technology are treated as immutable without evidence/constraint
- success is defined as “build/launch/complete X” rather than a changed state
- claims are unsupported or evidence/interpretation are mixed
- important assumptions/unknowns are hidden
- AI-generated intent is presented as Owner intent
- downstream Strategy/Concept/PRD/Epic material is being used to compensate for an unclear Vision
- lifecycle stage requires Approved Vision but the Owner has not accepted it

Use `Unverified` when required evidence cannot be observed. Do not convert missing evidence into `Approved` by inference.

## 8. Downstream boundary

After Vision approval:

- **Strategy** chooses where/how to concentrate to realize the Vision.
- **Product Concept / Business Model** may choose product form, value proposition packaging, pricing/revenue/GTM hypotheses.
- **PRD** defines requirements and constraints.
- **Epic / Story** decomposes outcomes and changes needed to realize the approved direction.
- **Task** defines executable work and its How.

Downstream discoveries may challenge the Vision, but they do not silently rewrite it. A material challenge returns to the Vision Gate and Owner decision.

## 9. Gate output contract

Every Vision review returns:

- `Vision Type`: Company / Business / Product
- `Lifecycle Stage`: Idea / Experimental / Product Planning / Major Pivot
- `Purpose / Problem / Opportunity / Evidence`: Pass / Revise / Unverified
- `Outcome Quality`: Pass / Revise
- `Solution Neutrality`: Pass / Revise
- `Success Measures`: Pass / Revise / Unverified
- `Assumptions / Unknowns / Non-goals`: Pass / Revise
- `Owner Intent Boundary`: Pass / Revise / Unverified
- `Downstream Boundary`: Pass / Revise
- `Owner Acceptance Evidence`: Present / Missing / Not yet required
- `Vision Decision`: Approved / Revise / Unverified / Provisional
- `Revision Notes`

## 10. Regression cases

### Case A — Cloud42-labo business commercialization v0.1

**Failure the Gate must detect:** Company/Business-level questions were forced into a Product Vision-shaped artifact, while target customer, product/service form, GTM, pricing, and revenue-model choices were mixed into the Vision.

Expected decision: `Revise` until the Business/Company future state is separated from downstream business/product choices.

### Case B — Human-capital portfolio Vision v0.1

**Failure the Gate must detect:** a five-year simulation or other specific mechanism was fixed at Vision stage as though it were the desired future state.

Expected decision: `Revise` until the future user/business Outcome is expressed independently of the simulation mechanism; the simulation may remain a Product Concept or experiment hypothesis.

## 11. Usage

- `templates/product-vision.md` must make this structure easy to fill without introducing downstream How.
- `hierarchical-refinement` must invoke this Gate before treating Product Vision as an approved upstream premise.
- Product Planning / Product Registry promotion must require `Vision Decision = Approved` plus Owner acceptance evidence.
- Epic Goal quality review consumes the Approved Vision; it must not compensate for a weak Vision by inventing a better one downstream.
