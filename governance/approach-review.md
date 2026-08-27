# Approach Review — Experience-first / Reaction-first

## Purpose

Approach Review exists to prevent theoretically correct methods, controls, and management processes from becoming overhead that is larger than the work itself.

The default is to choose the **simplest reasonable approach that satisfies the objective**. A method written in a Task is a hypothesis, not a commitment. If the objective can be preserved with a simpler path, change the path.

## Core principle

**Theory is an initial condition, not the answer.**

AI is very good at faithfully reproducing known frameworks and best practices. That strength can create a failure mode: a complete process is built before the team has enough real-world experience to know which parts are necessary.

In an unfamiliar domain or an early learning phase, prefer:

**Small Action → Reality / Reaction → Learn → Next Action**

Start lightly. Observe the reaction from users, the market, the system, or the environment. Add technique, measurement, automation, controls, and formal process only when the observed reality justifies them.

## Review criteria

Before approving an execution approach, ask:

1. **Have we touched reality yet?**
   - Are we designing a full method, KPI set, analysis flow, or control structure before performing even one small real-world action?
2. **Is this requirement experiential or merely theoretical?**
   - Was this process introduced because actual experience showed it was needed, or only because a framework says it is good practice?
3. **Can we make a smaller move first?**
   - Is there a cheaper, faster, reversible action that can expose the next useful signal?
4. **Is management overhead larger than learning value?**
   - Do measurement, review, coordination, Human Gates, documentation, or automation cost more than the information or risk reduction they provide?
5. **Can analysis wait for a meaningful reaction?**
   - Do not collect data merely because it can be collected. Analyze when an observed reaction can change the next decision.
6. **Are we pre-building controls for problems that have not occurred?**
   - Add controls where risk or repeated failure demonstrates need. Do not automatically build every theoretically desirable mechanism in the first iteration.

## Decision rule

- `Approved` — the approach is the smallest reasonable action, reaches reality quickly, and its control/measurement overhead is proportionate.
- `Revise` — the approach is over-designed, methodology-driven, prematurely instrumented, or creates management/Human overhead before sufficient real-world learning exists.
- `Pending` — the team does not yet know enough to select an approach; perform a smaller exploratory action first where possible.

## Operating interpretation

The goal is not to reject theory or best practice. Use theory to select a sensible first move, then let reality revise the theory.

A mature operating model therefore grows from observed need:

**Experience → Hypothesis → Small Action → Reaction → Learning → Rule / Process update**

This is especially important for AI-native operations because AI can execute complex process faithfully and cheaply enough that unnecessary process can proliferate unnoticed. The review must therefore optimize not only correctness, but also **total execution overhead**.
