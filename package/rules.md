# Rules

Binding constraints an agent must follow. See `../docs/versioning-policy.md`
for what MAJOR/MINOR/PATCH mean for this class (`rules_version` in
`../adp-package.yaml`).

| File | What it constrains |
|---|---|
| [`../README.md`](../README.md) | Orientation: source-of-truth model (State = Notion / Artifact = GitHub / Memory = brain), repository map |
| [`../AGENTS.md`](../AGENTS.md) | Core lifecycle gate for any agent modifying this repository |
| [`../governance/ai-execution-constraints.md`](../governance/ai-execution-constraints.md) | Executable form of most other rules: placement pre-flight, execution pre/post-flight, AI-to-AI stop gate, Human gate pre-flight, Human Queue WIP |
| [`../governance/source-of-truth.md`](../governance/source-of-truth.md) | Authority model (State = Notion / Artifact = GitHub / Memory = brain) |
| [`../governance/research-security-policy.md`](../governance/research-security-policy.md) | External-retrieval, secrets, and metered-billing gate |
| [`../governance/authority-stop-gate-regression-cases.md`](../governance/authority-stop-gate-regression-cases.md) | Regression fixtures for the AI-to-AI stop gate |
| [`../governance/state-transition-pre-check-regression-cases.md`](../governance/state-transition-pre-check-regression-cases.md) | Regression fixtures for the current-gate relevance check within the Human gate pre-flight |
| [`../docs/human-gate-pre-check-examples.md`](../docs/human-gate-pre-check-examples.md) | Worked examples for the Human gate pre-flight (anonymized by design) |
