# AI Execution Constraints

This file converts mandatory Vibe Product Development operating rules into pre-execution constraints for AI agents. The Operating Guide remains the policy source; these constraints are the executable guardrails.

## New Task placement pre-flight check

Before creating any new record in Notion Stories & Tasks, the acting AI MUST evaluate placement evidence **before** the create operation.

1. **Explicit Owner placement** — Did the Owner explicitly name the Product / Epic for this task?
2. **Explicit derivation** — If not, is this task an explicit child/derivative of an existing Task or Story whose placement makes the Product / Epic / Parent Story unambiguous?
3. **If either is true** — create the task only in that evidenced placement.
4. **If neither is true** — do not infer placement from topic similarity. Create it as `MISC｜<title>` with `Status = Backlog`, leaving Product / Epic / Parent Story unset until Backlog Refinement.

Creating first and correcting placement afterward does not satisfy this check. The placement decision is a precondition to the write operation.

## Enforcement rule

Any AI workflow or Skill that creates a Stories & Tasks record MUST execute the placement pre-flight check first. A prompt such as “this looks like ADP/AOD/etc.” is not evidence. Only explicit Owner placement or explicit derivation from an already placed Task/Story is sufficient.

If the evidence is ambiguous, default to MISC / Backlog. Weekly Backlog Refinement is responsible for formal placement.

## Related mandatory constraints

- Do not start execution before Definition of Ready is satisfied.
- Record `Status = In Progress` and `Started At` immediately before work.
- Record Task Time Events for active/waiting work where required.
- Respect Human/AI authority boundaries; create a Human Request only when human authority or physical/account action is genuinely required.
- Do not bypass Product/Epic dependency order without an explicit dependency reason or Owner decision.
