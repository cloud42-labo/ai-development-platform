"""Decision Point registry for the v1 Decision Adapter (ADP-065-T05).

Each entry here is a `DecisionPointSpec`: a typed question plus the
threshold/fallback metadata `decide()` needs, scoped to exactly the
Decision Points named in this Task's Acceptance Criteria and GitHub issue
#94's Phase 1 list. This registry does not include DP-9 (Task sizing) or
DP-10 (MISC duplicate detection) -- Acceptance Criterion 10 excludes both
from Auto Decision for now, and `docs/jev-decision-point-inventory.md`
section 9.7 records that neither has enough frozen fixture data to run
even a shadow evaluation yet. Adding them here is future work once that
fixture gap (tracked in that section) is closed, not a Phase 1 deliverable.

Every spec's `auto_decision_eligible` is hardcoded `False`. Per Acceptance
Criterion 11 and `docs/jev-decision-point-inventory.md` section 5 point 4,
promoting any Decision Point out of shadow mode requires its own
independent-holdout promotion Gate -- a separate, later decision this
module does not make for itself by existing.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from decision_adapter import TypedQuestion


@dataclass(frozen=True)
class DecisionPointSpec:
    decision_point_id: str
    version: str
    question: Optional[TypedQuestion]  # None when the question is state-dependent -- see the `build_*` functions below
    confidence_threshold: float
    threshold_version: str
    fallback_route: str  # "claude" | "chris" | "human"
    auto_decision_eligible: bool
    source: str  # pointer to the inventory section / issue item this spec implements


# --- DP-4: Ambiguous action -> policy-category classification -------------
# Reuses the exact criteria dict validated live in
# `evidence/adp-065-t03/jev_dp4_poc.py` (6/6 fixtures, 100% accuracy on the
# 4 objective cases -- docs/jev-decision-point-inventory.md section 9.4).
# Threshold 0.7 is this inventory's own stated default
# (section 9.4's "thresholded final decision" discussion uses 0.7).

DP4_POLICY_RULES = {
    "read-connected-resources": {
        "service": "*", "action": "read", "resource": "scoped", "decision": "allow",
    },
    "notion-managed-task-update": {
        "service": "notion",
        "action": ["update_task_status", "update_task_result", "create_task"],
        "resource": "stories_and_tasks",
        "conditions": ["execution_constraints_passed", "placement_evidence_required_for_create"],
        "decision": "allow",
    },
    "github-working-branch": {
        "service": "github",
        "action": ["create_branch", "commit", "push", "create_pr", "update_pr"],
        "resource": "allowed_repositories",
        "conditions": ["non_protected_branch", "managed_task_exists"],
        "decision": "allow",
    },
    "github-protected-merge": {
        "service": "github", "action": "merge", "resource": "protected_branch", "decision": "approve",
    },
    "production-change": {
        "service": "*",
        "action": ["production_deploy", "publish", "production_config_change"],
        "resource": "production",
        "decision": "approve",
    },
    "destructive-delete": {
        "service": "*", "action": ["delete", "purge", "destroy"], "resource": "durable", "decision": "approve",
    },
    "credential-or-authority-change": {
        "service": "*",
        "action": ["change_secret", "change_credential", "change_permission", "change_policy"],
        "resource": "security_control",
        "decision": "approve",
    },
    "self-authority-escalation": {
        "service": "policy", "action": "expand_own_authority", "resource": "agent_policy", "decision": "deny",
    },
}

DP4_INSTRUCTIONS = (
    "The following event tuple (actor, service, action, resource, environment, "
    "task_context, repo_specific_authority_note) describes one action actually "
    "taken inside the ADP organization. Classify which single rule id in "
    "`criteria` it falls under, using each rule's literal service/action/resource/"
    "decision predicate (given as the criteria description), not just the rule "
    "id's name. Pick exactly one rule id."
)

DP4_POLICY_CATEGORY = DecisionPointSpec(
    decision_point_id="dp4_policy_category",
    version="1.0.0",
    question=TypedQuestion(output_kind="choice", instructions=DP4_INSTRUCTIONS, criteria=DP4_POLICY_RULES),
    confidence_threshold=0.7,
    threshold_version="1.0.0",
    # DP-4's own fallback per the inventory ("below threshold -> deny/
    # require_approval once fail-closed lands -> Human/LLM adjudication")
    # is the acting AI's existing LLM-run classification, not a blanket
    # Human escalation for every miss.
    fallback_route="claude",
    auto_decision_eligible=False,
    source="docs/jev-decision-point-inventory.md DP-4; evidence/adp-065-t03/jev_dp4_poc.py",
)


# --- DP-1: Acceptance-Criterion Human-only triage --------------------------

DP1_CRITERIA = {
    "ai_verifiable": (
        "The criterion can be checked by the acting AI alone using tools it already "
        "has (reading code/docs/CI logs, running a test, querying Notion/GitHub), "
        "with no step that requires a human body, account, or legal/financial "
        "identity to act."
    ),
    "human_evidence_exists": (
        "The criterion requires human evidence, but that evidence already exists "
        "in the Task's current Result/Decisions/attachments -- no new human action "
        "is needed, only citing what is already recorded."
    ),
    "human_only": (
        "The criterion itself names or structurally requires a human action that "
        "cannot be substituted by an AI-controlled change without altering the "
        "Outcome: physical/device confirmation, an account/identity/legal/financial "
        "act, or an explicit Owner judgment call."
    ),
}

DP1_INSTRUCTIONS = (
    "Classify the given Acceptance Criterion text (plus the Task's current "
    "evidence state, if provided) into exactly one of the three categories in "
    "`criteria`. Apply the 'Outcome-before-procedure' substitution test: could an "
    "AI-controlled change remove the manual step without changing the Outcome? If "
    "yes, it is not human_only."
)

DP1_ACCEPTANCE_CRITERION_TRIAGE = DecisionPointSpec(
    decision_point_id="dp1_ac_triage",
    version="1.0.0",
    question=TypedQuestion(output_kind="choice", instructions=DP1_INSTRUCTIONS, criteria=DP1_CRITERIA),
    confidence_threshold=0.85,  # high-only, per the inventory's DP-1 "Confidence threshold" note
    threshold_version="1.0.0",
    fallback_route="claude",  # "the full LLM-run pre-flight procedure as it exists today"
    auto_decision_eligible=False,
    source="docs/jev-decision-point-inventory.md DP-1; governance/ai-execution-constraints.md Human gate pre-flight",
)


# --- DP-3: Backlog -> Epic/Story placement routing -------------------------
# State-dependent (the option set is "whatever Epics/Stories are currently
# active"), so this is a builder, not a static spec like DP-1/DP-4/DP-6.

DP3_INSTRUCTIONS = (
    "Given a new Backlog/MISC item's title and description, and the set of "
    "currently active Epics/Stories in `criteria` (each described by its own "
    "Objective/Acceptance Criteria text), choose the single existing Epic/Story "
    "it belongs under. If none fits without stretching its stated Objective, "
    "choose `none_fit` -- do not force a placement."
)


def build_dp3_placement_spec(candidate_targets: dict) -> DecisionPointSpec:
    """`candidate_targets`: {target_id: objective_or_acceptance_criteria_text}.

    Always include a `none_fit` option in the caller-supplied dict (the
    inventory's DP-3 "none fit" branch is structural and LLM-driven
    regardless of score -- see the module docstring and DP-3's own
    "Confidence threshold" note); this builder does not add it implicitly
    so the caller cannot forget it is also subject to the same high-only
    threshold for the *routing* decision, not the new-Epic-creation
    decision itself.
    """
    if "none_fit" not in candidate_targets:
        raise ValueError("candidate_targets must include an explicit 'none_fit' option")
    return DecisionPointSpec(
        decision_point_id="dp3_backlog_placement",
        version="1.0.0",
        question=TypedQuestion(output_kind="choice", instructions=DP3_INSTRUCTIONS, criteria=candidate_targets),
        confidence_threshold=0.85,
        threshold_version="1.0.0",
        fallback_route="claude",  # "unrouted items stay MISC... until the next Backlog Refinement pass"
        auto_decision_eligible=False,
        source="docs/jev-decision-point-inventory.md DP-3",
    )


# --- DP-6: Postmortem severity & escalation-category triage ----------------

DP6_CRITERIA = {
    "accept_monitor": "Low residual risk; no new control needed, continue monitoring as-is.",
    "strengthen_control": "An existing control exists but needs tightening/clarifying to prevent recurrence.",
    "escalate_owner_human": "Meets a mandatory-escalation category (secret/credential exposure, unapproved "
                              "metered spend, external publication/reputation risk, irreversible production "
                              "change, or repeated violation after an implemented control) -- route to Owner "
                              "regardless of any score.",
    "close": "Root cause fully addressed and verified; no further action needed.",
}

DP6_INSTRUCTIONS = (
    "Given a Postmortem's recurrence history, affected rule/control family, and "
    "current preventive-task status, choose the single triage category in "
    "`criteria` that best fits. Note: this is a pre-sort only -- it never "
    "substitutes for the mandatory-escalation list, which is checked by the "
    "caller before this classification is even used (see Fallback below)."
)

DP6_POSTMORTEM_TRIAGE = DecisionPointSpec(
    decision_point_id="dp6_postmortem_triage",
    version="1.0.0",
    question=TypedQuestion(output_kind="choice", instructions=DP6_INSTRUCTIONS, criteria=DP6_CRITERIA),
    confidence_threshold=0.85,
    threshold_version="1.0.0",
    # Chris prepares the portfolio view; Owner makes escalation/acceptance
    # decisions (inventory DP-6 "Authority"). The fallback actor for a
    # below-threshold/failed call is Chris's existing manual review, not
    # Claude -- DP-6 is Chris's Decision Point, not Claude's.
    fallback_route="chris",
    auto_decision_eligible=False,
    source="docs/jev-decision-point-inventory.md DP-6; governance/monthly-risk-management-review.md",
)


# --- PR Review Necessity Router (GitHub issue #94 Phase 1 item 3) ----------

PR_REVIEW_NECESSITY_CRITERIA = {
    "NO_SUBSTANTIVE_REVIEW": "Change is non-functional (typo/comment/formatting/docs-only with no "
                              "behavior change) -- no review pass is needed beyond CI.",
    "LIGHT_REVIEW": "Small, low-risk, single-concern change in a well-understood area -- a quick pass "
                     "suffices, full Codex review is not required.",
    "FULL_CODEX_REVIEW": "Default case: change touches logic, control flow, data, or multiple files in a "
                          "way that needs the standard Codex Automatic Review pass.",
    "HUMAN_REVIEW": "Change touches security/authority/policy/production/destructive/credential paths, "
                     "or any area this repository's governance reserves for Human review regardless of "
                     "Codex's own findings.",
}

PR_REVIEW_NECESSITY_INSTRUCTIONS = (
    "Given a PR's diff summary, changed-file list, and stated purpose, choose the single "
    "review-necessity category in `criteria`. This is a shadow pre-filter only: per "
    "`governance/review-loop-control.md` and `AGENTS.md` 'Finding Admission Gate', the "
    "existing Codex Automatic Review and any Human review this repository already "
    "requires are NOT skipped based on this classification in Phase 1 -- see README.md "
    "'Hard constraints'."
)

PR_REVIEW_NECESSITY_ROUTER = DecisionPointSpec(
    decision_point_id="pr_review_necessity",
    version="1.0.0",
    question=TypedQuestion(
        output_kind="choice", instructions=PR_REVIEW_NECESSITY_INSTRUCTIONS, criteria=PR_REVIEW_NECESSITY_CRITERIA
    ),
    confidence_threshold=0.85,
    threshold_version="1.0.0",
    fallback_route="chris",  # Chris/ChatGPT control-plane owns PR Flow Gate today
    auto_decision_eligible=False,
    source="GitHub issue #94 Phase 1 item 3",
)


# --- PR Flow classifier (GitHub issue #94 Phase 1 item 4; Notion AC 3) -----

PR_FLOW_CRITERIA = {
    "MERGE_READY": "Mergeable=true, required CI green, no unresolved review thread, author != merger "
                    "where that rule applies, and no external blocker -- ready for the authorized "
                    "integrator to merge.",
    "REVIEW_FIX": "Has at least one unresolved, actionable review finding (human reviewer or bot) that "
                   "is not yet addressed.",
    "CONFLICT_STALE": "Merge conflict with the base branch, or mergeability is false for a structural "
                       "reason (stale branch, diverged history).",
    "WAITING_REVIEW": "No unresolved blocking finding, but still waiting on a required human reviewer "
                       "or review pass that has not completed yet.",
    "BLOCKED_EXTERNAL": "Blocked by something outside this PR's own content: a dependency PR not yet "
                         "merged, an external service outage, or an explicit Blocker note.",
    "ORPHAN": "No recent activity and no clear next actor -- neither author nor reviewer nor CI is "
               "currently the blocking party.",
}

PR_FLOW_INSTRUCTIONS = (
    "Given structured PR evidence (mergeability, CI/check status, unresolved review-thread "
    "count, latest and current-head review state, PR age, author/merger identity, and any "
    "external-blocker note), choose the single PR Flow category in `criteria`. This is a "
    "shadow classifier: it never overrides a deterministic hard gate "
    "(CI failure, an unresolved thread, mergeability=false, an author=merger rule, or "
    "protected-branch merge authority) -- those are checked by the existing deterministic "
    "procedure before or regardless of this call, per README.md 'Hard constraints', and Jev "
    "itself has no merge authority under any output."
)

PR_FLOW_CLASSIFIER = DecisionPointSpec(
    decision_point_id="pr_flow_classification",
    version="1.0.0",
    question=TypedQuestion(output_kind="choice", instructions=PR_FLOW_INSTRUCTIONS, criteria=PR_FLOW_CRITERIA),
    confidence_threshold=0.85,
    threshold_version="1.0.0",
    fallback_route="chris",
    auto_decision_eligible=False,
    source="GitHub issue #94 Phase 1 item 4; Notion ADP-065-T05 Acceptance Criterion 3",
)


# --- Task intake: Value Type classification (GitHub issue #94 item 7) -----
# Options are the live `Value Type` select options on the Notion
# `Stories & Tasks` data source (fetched 2026-10-03; see README.md).

VALUE_TYPE_CRITERIA = {
    "Research / Learning": "The Task's primary output is understanding/evidence, not a shippable artifact.",
    "Knowledge Asset": "The Task's primary output is a durable, reusable document/design/standard.",
    "Platform Capability": "The Task's primary output is infrastructure/tooling/governance capability "
                             "used by other work, not an end-user-facing product change.",
    "Application Delivery": "The Task's primary output is a shippable change to an end-user-facing product.",
    "Business / Outcome": "The Task's primary output is a business decision, experiment result, or "
                            "commercial outcome rather than a technical artifact.",
}

VALUE_TYPE_INSTRUCTIONS = (
    "Given a Task's title, description, and Acceptance Criteria, choose the single Value "
    "Type in `criteria` that best describes its primary output."
)

VALUE_TYPE_CLASSIFIER = DecisionPointSpec(
    decision_point_id="task_value_type",
    version="1.0.0",
    question=TypedQuestion(output_kind="choice", instructions=VALUE_TYPE_INSTRUCTIONS, criteria=VALUE_TYPE_CRITERIA),
    confidence_threshold=0.8,
    threshold_version="1.0.0",
    fallback_route="claude",  # Backlog Refinement / Task intake is Claude-run today
    auto_decision_eligible=False,
    source="GitHub issue #94 Phase 1 item 7 (Value Type設定率 6.0% baseline)",
)


STATIC_DECISION_POINTS = {
    spec.decision_point_id: spec
    for spec in (
        DP4_POLICY_CATEGORY,
        DP1_ACCEPTANCE_CRITERION_TRIAGE,
        DP6_POSTMORTEM_TRIAGE,
        PR_REVIEW_NECESSITY_ROUTER,
        PR_FLOW_CLASSIFIER,
        VALUE_TYPE_CLASSIFIER,
    )
}

# DP-3 is intentionally absent from STATIC_DECISION_POINTS -- its spec is
# state-dependent (see build_dp3_placement_spec above) and must be built
# per-call with the caller's current candidate Epic/Story set, not reused
# as a module-level singleton that could go stale.

# DP-9 and DP-10 are deliberately absent from this registry entirely -- see
# the module docstring.
