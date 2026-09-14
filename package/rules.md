# Rules

Binding constraints an agent must follow. See `../docs/versioning-policy.md`
for what MAJOR/MINOR/PATCH mean for this class (`rules_version` in
`../adp-package.yaml`).

| File | What it constrains |
|---|---|
| [`../README.md`](../README.md) | Orientation: source-of-truth model (State = Notion / Artifact = GitHub / Memory = brain), repository map |
| [`../AGENTS.md`](../AGENTS.md) | Core lifecycle gate for any agent modifying this repository |
| [`../docs/regulations/README.md`](../docs/regulations/README.md) | Normative regulation hierarchy and precedence for R01–R06 |
| [`../docs/regulations/R01-organization-regulation.md`](../docs/regulations/R01-organization-regulation.md) | Organization and role model |
| [`../docs/regulations/R02-authority-regulation.md`](../docs/regulations/R02-authority-regulation.md) | Authority, reviewer independence, and merge responsibility |
| [`../docs/regulations/R03-approval-regulation.md`](../docs/regulations/R03-approval-regulation.md) | Approval and Human Gate boundaries |
| [`../docs/regulations/R04-document-management-regulation.md`](../docs/regulations/R04-document-management-regulation.md) | Source-of-truth and document-management rules |
| [`../docs/regulations/R05-system-development-management-regulation.md`](../docs/regulations/R05-system-development-management-regulation.md) | System-development quality and lifecycle controls |
| [`../docs/regulations/R06-project-management-regulation.md`](../docs/regulations/R06-project-management-regulation.md) | Product/Epic/Story/Task/Sprint management, including Task/Story State Reconciliation |
| [`../governance/ai-execution-constraints.md`](../governance/ai-execution-constraints.md) | Executable form of most other rules: placement pre-flight, execution pre/post-flight, AI-to-AI stop gate, Human gate pre-flight, Human Queue WIP |
| [`../governance/source-of-truth.md`](../governance/source-of-truth.md) | Authority model (State = Notion / Artifact = GitHub / Memory = brain) |
| [`../governance/research-security-policy.md`](../governance/research-security-policy.md) | External-retrieval, secrets, and metered-billing gate |
| [`../governance/authority-stop-gate-regression-cases.md`](../governance/authority-stop-gate-regression-cases.md) | Regression fixtures for the AI-to-AI stop gate |
| [`../governance/state-transition-pre-check-regression-cases.md`](../governance/state-transition-pre-check-regression-cases.md) | Regression fixtures for the current-gate relevance check within the Human gate pre-flight |
| [`../docs/human-gate-pre-check-examples.md`](../docs/human-gate-pre-check-examples.md) | Worked examples for the Human gate pre-flight (anonymized by design) |
