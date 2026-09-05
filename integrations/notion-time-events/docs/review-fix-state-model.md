# Review Fix state-transition & evidence model

> **Artifact status:** durable design reference. Produced for `ADP-051-A`
> after `ADP-051`'s implementation attempt ([PR #21][pr21], closed/unmerged)
> hit 34 review rounds of counterexamples in this exact area and was
> `Superseded` and re-split into `ADP-051-A`–`E`. This document is the
> contract those follow-on tasks (`B`: Work Type, `C`: Review Source,
> `D`: integration, `E`: E2E/KPI) implement against. No code changes are
> made by this document itself — `main`'s `Code.gs` at the time of writing
> contains none of the machinery described below (see §0).

[pr21]: https://github.com/cloud42-labo/ai-development-platform/pull/21

## 0. Where this sits relative to `main`

`Code.gs` already implements, and this document does not re-litigate:

- The `Stories & Tasks` → `Task Time Events` reconciliation loop
  (`reconcileAuthoritativeTimeEvents_`), Done gate (`enforceDoneGate_`),
  `Type=Story` exclusion (`reconcileStoryTask_`, from `BUG-ADP-TTE-01`), and
  the append-only Sync Log (`logSnapshot_` / `ensureSyncLogSheet_`).

`Code.gs` does **not** yet implement any of: Work Type classification,
Review Source resolution, or the `mostRecent*_` evidence-resolution helpers
named throughout this document. Those all existed only on PR #21's branch
and were never merged. `ADP-051-B`/`C`/`D` are greenfield implementations
against the model below, not a resurrection of PR #21's code as-is — PR
#21's design is the input this document distills, not the target.

## 1. Status model, as it matters to Time Event generation

`Code.gs` treats `Status` as effectively **binary** for Time Event purposes:

- `In Progress` — the only status that keeps a Time Event open. Everything
  about "when did work happen" comes from these intervals.
- Everything else (`Review`, `Blocked`, `Ready`, `Backlog`) — closes every
  open Time Event with `reason='left_in_progress'` and records *which* of
  the four it left for in that close's own `End Status=` field
  (`closeNotionTimeEvent_` writes it; `parseNoteMeta_` exposes it as
  `endStatus`). A close does retain this — see §3 step 1 — so it is not
  true that the distinction only survives in the Sync Log.

What a close's `End Status=` cannot tell you is anything about the *time
in between*: a Task can pass through several non-`In Progress` states with
no Time Event open at all (e.g. `Backlog → Ready → Review`, none of which
open one), and only Sync Log's continuous polling observes those. A close
can also succeed while its paired Sync Log append fails (crash recovery) —
the reverse gap.

`Done` is a separate terminal gate (`enforceDoneGate_`), unaffected by this
model. `Type=Story` is an orthogonal axis, fully excluded upstream of
everything below.

**Consequence for this model:** classifying a freshly-opened `In Progress`
execution as `Initial Work` vs. `Review Fix` needs whichever of the two
independent evidence sources — the most recent genuine Time Event close's
`End Status=`, or the most recent Sync Log row — is actually the more
recent one for this Task, per §3–§5. Neither source alone is sufficient:
each has gaps the other one covers. This reconciliation is the entire
source of PR #21's 34 rounds, and is what §3–§5 specify precisely so it
isn't rediscovered by trial and error again.

## 2. Evidence sources

Two independent records exist for any given moment in a Task's history,
and they disagree about precision and coverage in different ways:

| Source | Covers | Precision | Notes |
|---|---|---|---|
| **Time Event** (`Task Time Events` page) | Only `In Progress` intervals — but its own close records the destination status via `End Status=` | Notion timestamp (minute) | Authoritative for Actor start/end per README; carries `Execution=`/`Boundary=`/`End Status=` tags in its `Note`. |
| **Sync Log** (`logSnapshot_` row) | *Every* observed status, every poll | Notion timestamp (minute) + **must carry an Apps-Script write-time in ms** (see §4) | Append-only; the only place `Review`/`Blocked`/`Ready`/`Backlog` transitions are visible at all. |
| **GitHub Reviews API** | PR review events | Second | External; only consulted for Review Source, never for Work Type. |

A third piece of evidence, **execution identity** (`Execution=<id>` in a
Time Event's `Note`), is not a timeline record but an equality key: two
close/open events that share an `Execution=` value are the *same* episode
of work, regardless of what their timestamps say. This is the strongest
evidence available and takes priority over any timestamp comparison
whenever it applies (see §4, principle 1).

## 3. Decision procedure: classifying a newly-opened execution

Given a Task whose Time Event just opened (a fresh `In Progress` observed),
to classify it as `Initial Work` or `Review Fix`:

1. **Find the candidate boundary from the Time Event side**: the most
   recent *genuine* boundary close for this Task — a close tagged
   `Boundary=left_in_progress` (or the untagged legacy equivalent) —
   excluding any close that is itself churn (reassignment /
   duplicate-reconciliation / `ambiguous_provenance_restart`; see §6).
   Read its `End Status=` field for the status it transitioned to — the
   close itself is the evidence of what status this candidate represents.
2. **Find the candidate boundary from the Sync Log side**: identify the
   most recent *contiguous run* of non-`In Progress` Sync Log rows for
   this Task (`In Progress` rows are mid-execution actor observations,
   never the boundary itself — skip them), then take the **start** of
   that run — its earliest row, not its most recently re-observed one.
   The same status can be logged repeatedly with no real transition
   in between (failure #14); only the run's first row is the actual
   boundary timestamp and the evidence for §4's comparison.
3. **Resolve which candidate is actually more recent** using the priority
   order in §4. This must be a single shared resolver — never let Work
   Type and Review Source each re-derive "the most recent relevant
   evidence" independently (PR #21 round 7/13: doing so let them disagree
   about the same instant).
4. **Classify**: if the winning candidate's status is `Review` →
   `Review Fix`; otherwise (`Blocked`/`Ready`/`Backlog`, or no candidate at
   all) → `Initial Work`.
5. **Carry the winning candidate's timestamp forward** as the lower bound
   for Review Source resolution (§5) — Work Type and Review Source must
   consume the identical evidence instance, not merely the same *kind* of
   evidence re-queried.

## 4. Evidence priority & timestamp-tie resolution

This is the part PR #21 revisited most (rounds 4, 6, 9, 18, 19, 22, 30–34)
and the part future implementations most need to get right the first time.
The generalizable principle those rounds converged on:

> **A same-Notion-minute tie between two candidate boundaries is not
> resolvable from Notion's own data.** Notion timestamps are minute-
> granular; two genuinely different events can round to the same minute,
> and no choice of `>` / `>=` / `<` / `<=` is correct for all cases — each
> direction has a real counterexample (PR #21 #9, #10, #12, #19 all
> instantiate one direction or the other of this exact mistake). Do not
> attempt to fix a tie by flipping the comparison operator; that only
> relocates the bug.

The two legitimate ways to break a tie, in priority order:

1. **Identity equality** (`Execution=`), when the question is "is this the
   *same* execution episode as that one?" — never compare timestamps to
   answer this question; compare the identifier.
2. **A writer-controlled, higher-resolution clock**, when the question is
   "which of these two *different* episodes happened first, given they
   round to the same Notion minute?" Notion cannot answer this; the Apps
   Script process can, by recording its own `Date.now()` (millisecond
   precision) at the moment it writes each Sync Log row and each Time
   Event close, as a `Write=` field. Implementations must add this field
   from the start rather than reconstructing it later (PR #21 round 33).
   Legacy rows written before this field existed have no `Write=` value;
   for those only, and only as a compatibility fallback, "was this
   Snapshot ever logged elsewhere" (`snapshotWasEverLogged_`-style
   inference) may be used — but this fallback is known to guess the wrong
   direction in some cases (PR #21 round 32) and must not be extended to
   any row that could instead carry `Write=`.

Concretely: compare by Notion timestamp first; if tied at minute
granularity, compare by `Write=` milliseconds; only if `Write=` is absent
on legacy data, fall back to the heuristic and treat its answer as
best-effort, not authoritative.

## 5. Review Source resolution

1. Query the GitHub Reviews API for the Task's `Pull Request`, walking
   **every page**, not just the first (PR #21 round 1 — the single most
   basic miss, and the first thing to regression-test).
2. Window the eligible reviews to `[lower bound, upper bound]`:
   - **Lower bound**: the exact timestamp resolved in §3 step 5 — the same
     evidence instance Work Type classification used, not an independent
     Sync Log lookup (PR #21 round 7, round 13).
   - **Upper bound**: the moment this execution's reopen was *actually
     observed*, not the poll's own wall-clock time and not a blind
     "round up to end of minute." If a trusted, second-precision start
     timestamp is available, use it exactly; only when falling back to a
     minute-granular timestamp is rounding up to the end of that minute
     appropriate (PR #21 rounds 21, 23, 34 each got exactly this
     precision-mixing wrong in a different way — treat "is this bound
     second-precision or minute-precision" as a fact to carry explicitly,
     never to infer from the value's shape).
3. Classify the most recent reviewer login inside the window into
   `Codex` / `Claude` / `Human` / `Other`.
4. **Degrade to `Other`, never throw**, on: missing `Pull Request` URL,
   missing `GITHUB_TOKEN`, any GitHub API failure, or an unexpected
   response shape. Reconciliation availability must never depend on
   GitHub being reachable.

## 6. Reassignment / churn inheritance

- A reassignment **within the same execution** (matched by `Execution=`
  identity, regardless of which poll observed the close/reopen — not "same
  poll" and not "same actor", PR #21 round 6) inherits Work Type and
  Review Source from the outgoing sub-interval.
- Only *genuine* churn inherits. A close caused by
  `ambiguous_provenance_restart` (a deliberate "treat as new execution"
  restart for unknown-provenance pages) must **not** inherit — it starts a
  fresh, unclassified execution (PR #21 round 26). Whether the churn-
  history fallback can still reach past such a restart when the filtered
  candidate list is empty was an **open, unresolved thread when PR #21 was
  superseded** (round 27, `is_resolved:false`) — treat this as a required
  test case for `ADP-051-B`, not a solved problem to assume away.

## 7. Failure matrix (from PR #21's 27 review rounds)

Each row is a required regression test for `ADP-051-B`/`C`/`D`. "Principle"
names the section above that prevents it.

| # | State sequence / input | Wrong classification | Principle |
|---|---|---|---|
| 1 | PR has more reviews than one API page | Misses the true latest reviewer | §5.1 |
| 2 | Assignee cleared mid-`In Progress`, boundary stamped retroactively with no open events | Next execution misclassified `Initial Work`; boundary's own status left stale | §3.1, §6 |
| 3 | `Work Type=`/`Review Source=` notes survive many `appendNote_` compactions | Silently dropped once Note exceeds length budget | (implementation note, not evidence-model, but a required regression test) |
| 4 | — | `GITHUB_TOKEN` omitted from Security Model inventory | (docs hygiene, carried into README update) |
| 5 | `Review → Backlog/Ready → (time) → In Progress` | Time-Event-only heuristic reuses stale Review close, misclassifies `Review Fix` | §3.2 (Sync Log must be consulted, not Time Event alone) |
| 6 | Assignee cleared in one poll, reassigned in a **later** poll | Churn inheritance misses it (same-poll-only check), treated as new execution | §6 |
| 7 | A **past, already-closed** execution had internal reassignment | Its churn wrongly adopted by a later, unrelated Review Fix | §6 (must cut off at the most recent genuine close) |
| 8 | `Review → In Progress` observed with unmapped/empty actor, before a mapped actor is assigned | Intermediate row misread as "the" preceding status | §3.2 (must skip `In Progress` rows explicitly, not just take "the previous row") |
| 9 | Two Sync Log rows tie at the same Notion minute (e.g. Review→Backlog then reopen) | `>` keeps the wrong (stale) row | §4 |
| 10 | Current execution's churn ties in the same minute as the prior genuine close | `<=` wrongly excludes the current execution's own legitimate churn | §4, §6 |
| 11 | Review Fix spans a reassignment (2 actor-intervals for 1 human "review round") | Naive interval-count (`COUNTIFS`) over-counts review rounds | Out of scope for this model — see §9 |
| 12 | Reassignment immediately followed by the execution itself leaving to `Review` | `<` wrongly folds a completed execution's own churn into "current" | §4, §6 |
| 13 | Work Type resolves via Sync Log; Review Source lower bound still reads an old Time-Event close | Reviews from the *first* Review period get wrongly attributed | §3.5, §5.2 |
| 14 | Same status re-observed later with no real transition | "Last re-observed row" used instead of "row where the interval actually started" | §3.2 (need interval start, not last touch) |
| 15 | `Review → In Progress → Review → In Progress` (two Review periods) | In-Progress rows excluded wholesale, folding two Review periods into one | §3.2 |
| 16 | Sync Log re-scanned in full per event, per classification pass, at scale | Wall-clock budget exceeded on mature logs | (performance regression test, not correctness) |
| 17 | A review is posted during poll latency, after the actual reopen | Upper-bound-less window credits a review that couldn't have caused the fix | §5.2 |
| 18 | Execution closes to `Review` but crashes before `logSnapshot_`; reopen observed first | Stale Sync Log row wins unconditionally | §4 |
| 19 | Same as #18, but tied at the same minute | `>=` always favors the (stale) Sync Log row | §4 |
| 20 | Retroactive boundary stamp doesn't update its own `Snapshot=` | Legacy-fallback tie heuristic re-reads a stale Snapshot, undoing an earlier fix | §4 (this is exactly the case `Write=` is meant to replace) |
| 21 | Review posted at `:30` seconds, reopen actually at `:50`, bound is minute-rounded | Precision mismatch admits/excludes reviews incorrectly | §5.2 |
| 22 | A genuinely later, correct Sync Log row happens to be logged in the same minute as an interrupted close, with the close's Snapshot never logged | "Never logged ⇒ older" heuristic is not always right — Notion alone can't decide this | §4 (this is *why* `Write=` exists, not merely one more case it fixes) |
| 23 | Trusted second-precision start + fixed `+59999ms` upper bound | Slides up to a minute past a precise value | §5.2 |
| 24 | Symmetric check: whichever of {close, log} genuinely wrote later must win | (regression test confirming `Write=` resolves both directions, not just one) | §4 |
| 25 | Upper bound rounded up to end-of-minute even when the start was already second-precision | Admits reviews that postdate the real fix start | §5.2 |
| 26 | Close reason is `ambiguous_provenance_restart` | Wrongly inherited as ordinary churn instead of starting fresh | §6 |
| 27 | Filtered churn candidates empty after an `ambiguous_provenance_restart`; fallback rescans full history | May reach past the restart to an unrelated old reassignment — **unresolved at supersession** | §6 — required open test case, not an assumed-safe fallback |

## 8. Non-goals (unchanged from `ADP-051`)

- No manual editing of Task Time Events.
- No per-remark manual timer.
- No new effort database — this extends the existing Time Events /
  Sync Log mechanism only.
- No quality scoring beyond Work Type / Review Source classification
  (no P0–P2 severity modeling).
- **Review Round counting via interval/row count is a known
  approximation, not fixed by this model** (failure #11). A Review Fix
  spanning a reassignment counts as more than one "round." Product-level
  resolution (e.g. counting by contiguous Review-Fix episodes instead of
  by row) is deferred to `ADP-051-E`, which owns the KPI formulas.

## 9. Checklist for `ADP-051-B`/`C`/`D`

- [ ] Implement §3's shared resolver (single function both Work Type and
      Review Source call) rather than two independent Sync-Log lookups.
- [ ] Add `Write=` (Apps Script `Date.now()` in ms) to every new Sync Log
      row and every Time Event close, from the first implementation —
      do not defer it to a later round.
- [ ] Every comparison between two *candidates for the same instant*
      resolves by `Execution=` identity, never by timestamp.
- [ ] Every comparison between two *different* instants that tie at the
      Notion minute resolves by `Write=`, with the "ever logged" heuristic
      used only for pre-`Write=` legacy rows.
- [ ] Sync Log reads for classification are scoped/cached per poll run,
      not re-scanned per event (failure #16).
- [ ] Reviews API pagination walks all pages (failure #1).
- [ ] Review Source resolution never throws; missing PR/token/API failure
      all degrade to `Other`.
- [ ] All 27 rows in §7 exist as named regression tests before requesting
      review — do not wait for Codex to rediscover them one at a time.
- [ ] Failure #27 (churn-history fallback past an `ambiguous_provenance_restart`)
      is resolved explicitly, not left as an implicit fallback.

## References

- [`PR #21`][pr21] (closed, unmerged) — the implementation attempt this
  document distills lessons from. Its branch code is not a starting point;
  its review history is the input.
- Notion `ADP-051` (Superseded) → split into `ADP-051-A` (this document) /
  `ADP-051-B` (Work Type) / `ADP-051-C` (Review Source) / `ADP-051-D`
  (integration) / `ADP-051-E` (E2E + KPI formulas).
- `BUG-ADP-TTE-01` — the `Type=Story` exclusion and Sync Log mechanics this
  model builds on, already in `main`.
- [`README.md`](../README.md) — the existing integration's behavior,
  cursor, Done gate and reassignment semantics this model does not change.
