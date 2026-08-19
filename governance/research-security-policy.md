# Research Security & External Communication Policy

This policy defines pre-execution controls for AI research, external retrieval, external communication, credentials, and metered services used in ADP work.

## 1. Public-information default

Research and external retrieval MUST use public information unless the governing Notion task explicitly authorizes a different data class and the acting agent has authority to access it.

Do not upload, paste, quote, summarize, or otherwise transmit company-confidential material, private workspace content, personal data, unpublished source material, or other non-public information to an external service unless the task explicitly authorizes that transfer.

When the classification of input data is unclear, treat it as non-public and stop before external transmission.

## 2. Secrets and authentication material

Never place credentials or secrets in prompts, source files, Notion text, GitHub issues/PRs, URLs, logs, screenshots, or external requests. This includes API keys, access tokens, refresh tokens, passwords, session cookies, private keys, signing secrets, and equivalent authentication material.

Use connector-managed authentication, approved secret stores, or environment injection where available. Do not copy a secret from one system into another merely to make an integration work.

If secret exposure is suspected:
1. stop the affected workflow;
2. do not repeat or quote the exposed value;
3. record only the type and location of the suspected exposure;
4. escalate to Human for revocation/rotation and impact review before resuming.

## 3. External retrieval and extraction budget

Before fetching, crawling, or extracting external material, define the minimum scope needed for the task.

- Prefer primary/first-party sources: official documentation, original research, standards, vendor documentation, or the authoritative publisher.
- Fetch only the sections or files required to answer the task.
- Set an explicit extraction budget before broad retrieval. The default is the smallest practical number of pages/files and the smallest text/token window needed for the acceptance criteria.
- If the first pass is insufficient, expand deliberately and record why; do not perform unbounded crawling.
- Do not retrieve a large corpus merely because the tool permits it.

The purpose of the budget is to reduce unnecessary data transfer, token consumption, accidental sensitive-data collection, and research noise.

## 4. External communication and write authority

External reads and external writes are different authority classes.

Reading a public source does not grant authority to publish, message, email, post, submit a form, create an account, change a remote configuration, or write to a third-party system.

Before any external write, confirm all of the following:
- the current Notion task requires the write;
- the acting agent is authorized for that action;
- the target account/organization identity is correct;
- the write is reversible, or the task explicitly permits the irreversible action;
- any required Human approval or final review gate has passed.

If any condition is false or unclear, stop and create/route to a Human Request or the authorized agent instead of bypassing the boundary.

## 5. Metered services and external AI APIs

Do not use an external AI API that can incur metered or pay-as-you-go charges unless Human approval for that specific paid path exists before the call.

A subscription UI or bundled product entitlement does not imply approval to use a separately metered API.

Do not silently fail over from a subscription/bundled tool to a paid API when quota, rate limit, authentication, or feature availability blocks the preferred path. Record the blocker and use a no-additional-charge alternative where one is already authorized; otherwise stop and escalate.

If pricing or billing behavior is uncertain, treat the service as potentially metered and do not call it until confirmed.

## 6. Research / external-call pre-flight gate

Before the first external retrieval or communication in a task, the acting AI MUST answer:

1. **Data class** — Is every outbound input public or explicitly authorized for external transfer?
2. **Secrets** — Are credentials, tokens, cookies, personal data, and confidential material absent from the outbound payload and logs?
3. **Source** — Is a primary/authoritative source being used where available?
4. **Budget** — Is the retrieval/extraction scope bounded to what the acceptance criteria require?
5. **Billing** — Could this call incur metered charges? If yes, is prior Human approval recorded?
6. **Write authority** — Is this a write/post/send/change action? If yes, does the task and agent authority explicitly permit it?

If any answer is unknown, the gate fails and execution stops before the external action.

## 7. Evidence and completion

For material research or external actions, record enough evidence in Notion/GitHub to reconstruct:
- authoritative sources used;
- any deliberate expansion of retrieval scope;
- whether a Human authority or billing gate was required;
- outbound write targets and resulting URLs/identifiers when applicable;
- blockers or suspected policy violations.

Never record the secret itself as evidence.

## Relationship to other controls

`governance/ai-execution-constraints.md` defines general execution and task-placement gates. This document adds the security, retrieval, external-communication, and billing gates that apply before an AI crosses a system or trust boundary.
