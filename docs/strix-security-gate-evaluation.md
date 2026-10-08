# Strix Evaluation — ADP Security Gate PoC (ADP-069-T06)

Date: 2026-10-08 (JST)
Decision: **Partial — PoC execution blocked in this session; see §7 for the concrete
blocker and recommended path.** Task status, timestamps and Human wait records live
in the Notion task, not here.
Scope: Notion `ADP-069-T06｜Strixを検証しSecurity Gateを設計・PoCする`
(Issue cloud42-labo/ai-development-platform#109).

Acceptance criteria (verbatim from the GitHub Issue, not relaxed): see Issue #109.
This document covers AC1, AC3, AC5 (partial), AC6, and AC8's pre-flight gate result.
AC2, AC4, AC7, AC9, AC10 are deferred to a follow-up pass once AC8 can actually run
(see §7) — this is not a full design doc, it is the primary-source research needed
before the Security Gate design can be written honestly.

## 1. What Strix is (AC1)

Source: https://github.com/usestrix/strix (fetched 2026-10-08 JST; primary/first-party
source per `governance/research-security-policy.md` §3).

- Open-source AI penetration-testing tool. License: **Apache-2.0**.
- Activity: 909 commits on `main`, 67.1k stars, 7.4k forks, 180 open issues, 276 open
  PRs at fetch time — actively maintained. The project's Releases page was empty at
  fetch time, so no specific version/release cadence could be confirmed from that
  page alone (would need `pip`/`npm` registry metadata for a version number; not
  fetched in this pass — out of the AC1 budget).
- Install: `curl -sSL https://strix.ai/install | bash`, or PyPI package
  `strix-agent`. Run with `strix --target ./app-directory`.
- **Docker is a hard prerequisite** — the README lists "Docker (running)" and the
  first run pulls a sandbox image. Strix executes its scanning/exploit-validation
  inside that container, not on the host directly.
- CI/CD: ships a sample GitHub Actions workflow that runs on `pull_request` and
  calls `strix -n -t ./ --scan-mode quick` (`-n`/`--non-interactive` = headless).
  The README states quick PR scans are scoped to changed files.
- Exit codes: README states only "exits with non-zero code when vulnerabilities are
  found" — no documented code-to-severity mapping was found at this fetch depth.
- SARIF: not mentioned on the README. Not confirmed either way — would need to check
  the CLI's `--help` output or a deeper doc page before AC9 KMI design assumes it.
- Agent skills: `npx skills add usestrix/strix` installs nine SKILL.md-compatible
  skills (run pentest, fix findings, CI scanning) usable from Claude Code, Cursor,
  Codex, and other SKILL.md agents.
- Managed cloud (Strix Cloud, `app.strix.ai`): validated findings with PoCs,
  one-click autofix PRs, continuous pentesting, GitHub/GitLab/Slack/Jira
  integrations; separate Enterprise tier (SSO, compliance reports, VPC/self-hosted).

## 2. LLM execution path and billing (AC3, AC6 — the Approach Decision's required gate)

This is the question the Notion task's Approach Decision flagged as mandatory before
anything else: **can Strix run without adding metered, pay-as-you-go API spend?**

| Path | Requires | Billing |
|---|---|---|
| Open-source CLI + `LLM_API_KEY` | A key from OpenAI, Anthropic, Google (Vertex AI, Bedrock, Azure variants also listed) | **Metered / pay-as-you-go.** No bundled-subscription option for Anthropic is documented — the README shows Anthropic models addressed as an API-style identifier (`anthropic/claude-sonnet-4-6`), not a subscription login. |
| Open-source CLI + `strix auth login chatgpt` | A **ChatGPT Plus/Pro subscription login** (OAuth), runs `chatgpt/<model>` | **No separate metered charge** — rides the existing ChatGPT subscription, same category as "bundled product entitlement" in `governance/research-security-policy.md` §5 (worth re-confirming with Owner before relying on it, since that section also says a bundled entitlement does not by itself imply approval for a *different* heavy automated use like repeated pentests). |
| Local model (Ollama/LM Studio via `LLM_API_BASE`) | A self-hosted model, no API key | No external metered charge, but this session has no local model runtime, and local-model finding quality for security analysis is unverified. |
| Strix Cloud (managed) | `app.strix.ai` account | Separate commercial product/pricing, not evaluated here — would be its own Human approval + billing decision, out of scope for a PoC. |

**Finding:** there is no way to run Strix on a bundled **Claude** subscription. A
Claude-side PoC would require Human-approved metered Anthropic/OpenAI API spend,
which `governance/research-security-policy.md` §5 blocks without prior approval
("Do not use an external AI API that can incur metered or pay-as-you-go charges
unless Human approval for that specific paid path exists before the call"). The
only no-additional-charge path identified is `chatgpt auth login` under an existing
ChatGPT subscription — which is Chris's (ChatGPT's) side of this two-AI-actor
organization, not Claude's. See §7 for what this means for who should run the PoC.

## 3. Data flow, by execution path (AC5 — partial)

- **Local CLI (open-source, any LLM path):** target code is read from the local
  filesystem/Docker mount; prompts/code excerpts relevant to each finding are sent
  to whichever LLM endpoint is configured (OpenAI/Anthropic/Google API, or the
  ChatGPT subscription endpoint, or a local model with no egress). Findings/PoCs are
  written to local output (not confirmed whether anything is phoned home by default
  for the open-source CLI outside of the LLM call itself — not verified in this pass).
- **GitHub Actions:** same as local CLI, but running inside the CI runner; the LLM
  API key would need to be a repo/org secret, which itself is a credential-handling
  decision this policy's §2 governs (never place it in prompts/logs; use the
  platform's encrypted secrets store only, and only once a billing approval exists).
- **Strix Cloud:** code and findings leave Cloud42's infrastructure to Strix's
  managed service (`app.strix.ai`) by design — a materially different trust boundary
  than the two self-hosted paths above. Not evaluated further here; would need its
  own data-processing/terms review before any code is sent to it.

This is not yet a complete AC5 answer (e.g., whether the open-source CLI makes any
non-LLM network calls, telemetry, etc. was not checked) — flagged as follow-up.

## 4. PoC pre-flight gate result (AC8) — blocked, not run

Per `governance/research-security-policy.md` §6, the pre-flight gate was run before
attempting any PoC execution in this session:

1. Data class — target would be Cloud42's own non-production repo code: OK (public/owned).
2. Secrets — no secrets would be placed in prompts/logs: OK if executed per policy.
3. Source — primary source used for all findings above: OK.
4. Budget — one fetch of the upstream README; no broad crawl performed: OK.
5. **Billing — fails.** Running the open-source CLI needs a metered Anthropic/OpenAI/
   Google key with no existing Human approval on file for this specific use. The only
   no-additional-charge path (`chatgpt auth login`) is not this session's identity.
6. Write authority — N/A (no external write attempted).

Gate result: **stop before execution** (§6: "If any answer is unknown [or fails],
the gate fails and execution stops"). Separately and independently, this session's
container has **no running Docker daemon** (`docker info` / `docker ps` both fail
with "no such file or directory" on the daemon socket) — Strix cannot run its
sandbox here even if the billing question were resolved. Both blockers were
confirmed directly, not assumed.

**No PoC was executed. No finding-validity/false-positive/runtime/cost/token/
data-exposure evidence exists yet for AC7/AC8 — do not treat this document as
satisfying those two items.**

## 5. Overlap with existing controls (AC4 sketch, not full AC4)

`cloud42-labo/skills`'s `external-security-skill-selector` already curates a
narrower, pre-vetted set of *defensive* skills (DevSecOps scanning, prompt-injection
defense, SBOM analysis) from Anthropic's own published security-skills repo, with a
default-deny on offensive/exploitation categories and Human approval required before
loading any skill body. Strix is a different category: a general-purpose *agentic
pentesting* tool (it actively probes and validates exploits, not just a static
scanner), run via a third-party CLI/cloud product rather than a vetted skill
registry. The two are complementary candidates, not duplicates — but adopting Strix
would need its own authority/billing/Docker decision independent of that selector,
not a re-use of its approval.

## 6. Current recommendation (AC10 — provisional, not final)

**Defer**, not Reject or Adopt, pending two Owner decisions this evaluation cannot
make on its own:

1. **Who runs the PoC.** Since the only no-additional-charge LLM path is the ChatGPT
   subscription login, the PoC is a better fit for a Chris/ChatGPT-side session (with
   a container that has a working Docker daemon) than for this Claude session. Or:
   Owner explicitly approves a small, bounded metered API spend (e.g., Anthropic API,
   single PoC run, cost capped) so Claude can run it directly — either is fine, but
   one of the two has to be decided before AC7/AC8 can produce real evidence.
2. **Docker-enabled execution environment.** Whichever actor runs the PoC needs a
   session/runner with an actual Docker daemon (this Claude cloud session's container
   does not have one running). A GitHub Actions runner would have Docker available
   and matches Strix's own documented CI integration — worth considering as the PoC
   environment instead of an interactive session either AI actor runs locally.

Once either path above is unblocked, the remaining work is: run the PoC on one
non-production Cloud42 repo (AC7/AC8 — e.g., `store-survival-simulator` or
`kids-oekaki` are small, low-risk, non-production targets already in this
organization's repo set), then come back to this document to fill in AC2
(Gate placement design), AC4 (fail-open/fail-closed boundaries), AC9 (KMI set),
and finalize AC10.

## 7. What this session did and did not do

Did: primary-source research (AC1, AC3, AC6), a first pass at data-flow mapping
(AC5), and the mandatory research-security pre-flight gate for AC8 (confirmed it
fails on billing, independently confirmed Docker is also unavailable here).

Did not: install or run Strix, touch any target repo's code, spend any metered API
budget, or make the Adopt/Reject call final. AC2, AC4, AC7, AC8 (execution), AC9,
and the final AC10 decision remain open and are not claimed as done in the Notion
task Result.
