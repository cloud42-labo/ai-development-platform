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
   recent close tagged `Boundary=left_in_progress` (or the untagged
   legacy equivalent). Two different situations write this tag, and they
   do **not** carry equally trustworthy status/timestamp evidence:
   - **Genuine** (`Reason=left_in_progress`): its `End Status=` is
     accurate — read it directly. Its `Ended At` is **not** guaranteed
     accurate to the second, even though it's the "genuine" case: per
     README's "Recorded boundary timestamps carry a backlog-dependent
     imprecision", `Ended At` is set from the *page's* `last_edited_time`,
     which an unrelated edit after the real transition (but before the
     next poll) inflates — a documented, structural gap in the underlying
     polling model, not something this evidence model can fix by being
     more careful. Treat a genuine close's `Ended At` as minute-granular
     evidence like everything else, never as an implicitly-trusted
     second-precision value, unless it independently carries one (e.g. a
     `Write=`-style capture at the moment of closing, if a future
     implementation adds one) (failure #38, found during this document's
     own review).
   - **Retroactively stamped** (`Reason=reassignment` or
     `duplicate_reconciliation`, with `Boundary=left_in_progress` added
     *later* by `stampExecutionBoundary_` because no open Time Event
     existed to close when the Task actually left): only the fact that
     *a* boundary occurred by this point is reliable. Its `End Status=`
     and `Ended At` are **stale** — `stampExecutionBoundary_` never
     rewrites them, so they still hold whatever the original reassignment
     close wrote (typically `End Status=In Progress` and the
     reassignment's own timestamp), not the real destination status or
     the real time the Task actually left. **Do not read status or
     timestamp from this candidate** — see step 3. This staleness also
     makes the original close's `Write=` (§4) the wrong value for
     *ordering* this candidate against a Sync Log row: it timestamps the
     original reassignment, not the discovery of the boundary.
     `stampExecutionBoundary_` must write its own fresh `Write=` at the
     moment it performs the retroactive stamp (overwriting, not
     preserving, any `Write=` left by the original close) — that stamp
     time, not the stale close time, is this candidate's comparison
     timestamp in step 3 (failure #31, found during this document's own
     review).
2. **Find the candidate boundary from the Sync Log side**: identify the
   most recent **same-status run** of Sync Log rows for this Task — rows
   sharing one non-`In Progress` status value, contiguous going backward,
   stopping at either an `In Progress` row or a row with a *different*
   non-`In Progress` status (not only at `In Progress`: `Review →
   Backlog → In Progress` is two runs, and only the later one — `Backlog`
   — is the candidate; failure #5 misclassifies this if the two are
   merged into one run). Take the **start** of that run — its earliest
   row, not its most recently re-observed one; the same status can be
   logged repeatedly with no real transition in between (failure #14).
3. **Resolve which candidate is actually more recent** using the priority
   order in §4. This must be a single shared resolver — never let Work
   Type and Review Source each re-derive "the most recent relevant
   evidence" independently (PR #21 round 7/13: doing so let them disagree
   about the same instant). **If the Time Event candidate is *genuine*
   (step 1) and it reports the same status as the Sync Log candidate
   (step 2) but the two disagree on timestamp, this is not resolvable
   from the evidence available and must be surfaced as ambiguous, not
   silently coalesced or compared.** An earlier draft of this document
   tried to discriminate the two possible readings — "same transition
   observed twice" (genuine close at t1, Sync Log merely re-observing the
   Task still sitting in that status at a later t2; take t1) versus
   "genuinely different periods of the same status label" (e.g. `Review`
   → unmapped `In Progress` → `Review` again; take the newer Sync Log
   run per §4) — by checking whether any Sync Log row with a *different*
   status exists between t1 and t2, treating "no such row found" as proof
   of the first case. **That discriminator does not work**: per README's
   documented polling model, a Task can pass through several states
   inside one poll interval and only its *final* observed state is ever
   logged — an intervening transition can be entirely **unobserved**, not
   merely under-logged, so "no intervening row found" is equally
   consistent with "no intervening transition happened" and "one
   happened but no poll ever landed inside it to see it." No amount of
   additional row-scanning distinguishes these from Notion-side evidence
   alone (failure #39, found during this document's own review — this
   is what failures #35/#36's fix actually got wrong, not one more case
   it missed). Treat this case exactly like failure #28's "no reliable
   status source": surface it as an explicit unresolved/ambiguous case
   for review, never silently default to either candidate's timestamp.
   (The genuine close's `End Status=` remains readable on its own — this
   ambiguity is only about *which timestamp* is the true transition
   boundary when a Sync Log run reports the same status later, not about
   whether the status itself is known.) §4's "more recent wins"
   comparison still applies as before to genuinely *different* candidate
   transitions (e.g. a later Sync Log run reporting a *different* status
   than a stale Time Event close); this ambiguity rule applies only when
   both candidates agree on the status. **If the winning candidate is a
   retroactively-stamped Time Event boundary** (step 1), its own
   `End Status=`/`Ended At` cannot supply the classification — fall back
   to the Sync Log candidate from step 2 for the actual status and
   timestamp, even though the Time Event boundary is what proved a
   boundary exists at all. **But first verify that Sync Log candidate is
   not itself stale relative to this boundary**: apply §4's comparison
   between the Sync Log candidate's timestamp and the boundary's own
   discovery time (its fresh `Write=` from step 1) exactly as if they
   were competing candidates. A Sync Log run that predates the boundary's
   discovery is evidence from a *different, earlier* cycle — e.g. an old
   logged `Review` run left over from before a run of logged
   `In Progress` rows, with the current reopen's own transition never
   logged (crash) — and must be rejected the same as having no Sync Log
   row at all, not trusted merely because a same-status run technically
   exists somewhere in the log (failure #32, found during this document's
   own review). Only once the Sync Log candidate is confirmed to
   postdate the boundary's discovery may its status be used. If no such
   Sync Log row exists — none at all, or only stale ones — there is no
   reliable status source: implementations must surface this as an
   explicit unresolved/ambiguous case for review, never silently default
   to `Initial Work` or `Review Fix` as if it were an ordinary confident
   result (failure #28, found during this document's own review — not
   one of PR #21's original 27).
4. **Classify**: if the winning status is `Review` → `Review Fix`;
   otherwise (`Blocked`/`Ready`/`Backlog`, or no candidate at all) →
   `Initial Work`.
5. **Carry the winning timestamp forward** as the lower bound for Review
   Source resolution (§5) — Work Type and Review Source must consume the
   identical evidence instance, not merely the same *kind* of evidence
   re-queried.

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
   any row that could instead carry `Write=`. **`Write=` must be added to
   `appendNote_`'s protected-field list alongside `Execution=`/
   `Boundary=`/`Task Origin=`/`End Status=`** — otherwise a later note
   compaction on a closed Time Event can evict it, silently downgrading
   that event back to the legacy fallback this field exists to retire
   (failure #29, found during this document's own review).

Concretely: compare by Notion timestamp first; if tied at minute
granularity, compare by `Write=` milliseconds; only if `Write=` is absent
on legacy data, fall back to the heuristic and treat its answer as
best-effort, not authoritative.

## 5. Review Source resolution

1. Query the GitHub Reviews API for the Task's `Pull Request`, walking
   **every page**, not just the first (PR #21 round 1 — the single most
   basic miss, and the first thing to regression-test).
2. Window the eligible reviews to `[lower bound, upper bound]`:
   - **Lower bound**: the timestamp resolved in §3 step 5 — the same
     evidence instance Work Type classification used, not an independent
     Sync Log lookup (PR #21 round 7, round 13). **Carry its precision
     explicitly, the same as the upper bound below.** When it is only
     minute-granular, the whole clock-minute is inherently ambiguous —
     Notion's precision cannot say whether the true transition happened
     early or late within it, so **neither rounding direction is
     correct in general**, mirroring §4's tie-resolution principle:
     - Treating the bound as exact (no rounding) wrongly admits a review
       submitted earlier in the same minute but before the true
       transition (e.g. transition at `12:00:50`, review at `12:00:20` —
       not causal).
     - Rounding up to end-of-minute wrongly excludes a review submitted
       later in the same minute, after a transition that happened early
       in it (e.g. transition at `12:00:10`, review at `12:00:40` —
       genuinely causal; this was this document's own first, wrong
       attempt at this fix).
     Because this is the *older* edge of the window, a reviewer clearly
     outside (after) the ambiguous minute is always safe to prefer when
     one exists: an ambiguous-minute review can only ever be *older than
     or equal to* one that's definitely inside the window, so it can
     never become "the most recent reviewer" except when it is the
     *only* candidate at all — that is the one case to degrade to
     `Other` rather than assert a specific reviewer without the
     precision to justify it. Use the lower bound exactly, with no
     ambiguity window, only when a trusted, second-precision timestamp is
     available (failure #30, found during this document's own review —
     not one of PR #21's original 27).
   - **Upper bound**: the moment this execution's reopen was *actually
     observed*, not the poll's own wall-clock time. If a trusted,
     second-precision start timestamp is available, use it exactly. When
     only a minute-granular timestamp is available, **do not round up to
     end-of-minute** — that reintroduces failure #17 in the opposite
     direction: a review posted after the real (sub-minute) reopen but
     before the rounded-up minute boundary gets wrongly credited as
     causal, even though it postdates the actual resumption of work (e.g.
     reopen at `12:00:10`, review at `12:00:40` — not causal, yet an
     end-of-minute `12:00:59` bound admits it).

     **Unlike the lower bound, "prefer a reviewer clearly outside the
     ambiguous window" is not automatically safe here**, because this is
     the *newer* edge of the window — an ambiguous-minute review can be
     more recent than an outside-window candidate and thus change which
     reviewer is "most recent" depending on the unknown sub-minute
     ordering. Concretely: Bob reviewed at a time definitely inside the
     window; Alice reviewed later, inside the ambiguous upper-bound
     minute. If the true reopen happened before Alice's review, Alice is
     outside the valid window and Bob is the answer; if it happened
     after Alice's review, Alice is inside it and is the (more recent,
     correct) answer. Preferring Bob regardless asserts a specific
     answer in a case where it can genuinely go either way (failure #37,
     found during this document's own review). The correct rule: after
     picking the best candidate reviewer from clearly inside the window,
     check whether any review *inside the ambiguous minute* has a
     timestamp later than that candidate's. If none does, the candidate
     is safe — no possible sub-minute ordering changes the answer. If one
     does, the outcome is genuinely ambiguous: degrade to `Other`.
     Treat "is this bound
     second-precision or minute-precision" as a fact to carry explicitly,
     never to infer from the value's shape (PR #21 rounds 21, 23, 34 each
     got this precision-mixing wrong in a different way; this document's
     own first attempt at the upper bound repeated the same rounding
     mistake the lower-bound fix above already corrected — failure #34,
     found during this document's own review).
3. Classify the most recent reviewer login inside the window into
   `Codex` / `Claude` / `Human` / `Other`, applying the ambiguous-minute
   degradation from step 2 (lower bound) and/or above (upper bound) when
   either applies (prefer a reviewer outside the ambiguous window(s);
   degrade to `Other` if none exists).
4. **Degrade to `Other`, never throw**, on: missing `Pull Request` URL,
   missing `GITHUB_TOKEN`, any GitHub API failure, or an unexpected
   response shape. Reconciliation availability must never depend on
   GitHub being reachable.

## 6. Reassignment / churn inheritance

- A reassignment **within the same execution** (matched by `Execution=`
  identity, regardless of which poll observed the close/reopen — not "same
  poll" and not "same actor", PR #21 round 6) inherits Work Type and
  Review Source from the outgoing sub-interval.
- **When the outgoing event has no `Execution=` at all** (legacy: it
  predates the field, and `Code.gs` deliberately never backfills one for
  a legacy reassignment replacement — see `reconcileAuthoritativeTimeEvents_`'s
  own comment on why manufacturing an identity here is worse than none),
  identity matching cannot apply. Fall back to the **same Reason/Boundary
  legacy heuristic `Code.gs` already trusts for Done-gate current-execution
  membership** (`isExecutionBoundary = Reason=left_in_progress OR
  Boundary=left_in_progress`, `Code.gs` ~1913), not a new rule: the
  outgoing event is treated as part of the current execution only if
  `!isExecutionBoundary` AND its `Reason` is `reassignment` or
  `duplicate_reconciliation`. **Both forms of boundary stop this
  inheritance — a plain `Reason=left_in_progress` close, and a
  retroactively-stamped `Boundary=left_in_progress` on an otherwise
  `reassignment`/`duplicate_reconciliation` close** (checking `Reason`
  alone misses the retroactive case entirely, since its `Reason` still
  reads `reassignment`). This is required for failures #6 and #7 to
  have an implementable outcome, since both involve exactly this
  legacy-matching gap (failure #33, found during this document's own
  review).
- Only *genuine* churn inherits. A close caused by
  `ambiguous_provenance_restart` (a deliberate "treat as new execution"
  restart for unknown-provenance pages) must **not** inherit — it starts a
  fresh, unclassified execution (PR #21 round 26).
- **`ambiguous_provenance_restart` is a hard history cutoff, decided here
  rather than left to `ADP-051-B`'s implementation** (PR #21 round 27,
  `is_resolved:false` at supersession, left open): the churn-history
  fallback must never scan past the most recent
  `ambiguous_provenance_restart` for this Task, full stop, even when the
  filtered candidate list on the near side of it is empty. If no genuine
  churn candidate remains after applying that cutoff, this execution has
  **no** Time-Event-side churn candidate at all — it does not inherit
  from anything on the far side of the restart, consistent with the
  restart's own purpose of starting a fresh, unclassified execution.
  Required regression test: an `ambiguous_provenance_restart` with an
  empty near-side candidate set must not inherit Work Type/Review Source
  from an older execution that predates it.

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
| 27 | Filtered churn candidates empty after an `ambiguous_provenance_restart`; fallback rescans full history | May reach past the restart to an unrelated old reassignment — was **unresolved at supersession**; resolved here (§6): the restart is a hard cutoff, no history-crossing fallback | §6 — required regression test |

Found during this document's own review (`ADP-051-A`, not PR #21's history):

| # | State sequence / input | Wrong classification | Principle |
|---|---|---|---|
| 28 | Assignee cleared mid-`In Progress` (reassignment close, `End Status=In Progress`), no open event exists when the Task later actually reaches `Review`, so `stampExecutionBoundary_` retroactively tags that same reassignment close `Boundary=left_in_progress` — and the paired Sync Log row for the real `Review` transition is missing (crash) | Reading `End Status=`/`Ended At` directly from this candidate reports `Initial Work` (or a wrong timestamp) instead of surfacing that the true destination status is unknown | §3 step 1/3 |
| 29 | A closed Time Event's `Write=` field survives long enough to matter, but a later note compaction (`appendNote_`) runs on it | Silently evicted like an ordinary low-priority field, downgrading that event to the legacy `snapshotWasEverLogged_` fallback (known to guess wrong per §4) | §4 |
| 30 | A GitHub review lands at `12:00:20`; the Task's actual transition to `Review` (minute-granular in Sync Log) is at `12:00:50` — or the reverse, transition at `12:00:10` and review at `12:00:40` | Treating the minute-granular lower bound as exact admits the non-causal `:20` review; rounding it up to end-of-minute instead wrongly excludes the genuinely causal `:40` review — neither fixed rounding direction is correct | §5 |
| 31 | `stampExecutionBoundary_` retroactively tags an old reassignment close as the boundary; a Sync Log row exists from around the same real time | Comparing the stale original close's `Write=` (timestamped at the reassignment, not at the retroactive stamp) against the Sync Log row's `Write=` has no principled answer — the retroactive candidate's only valid comparison timestamp doesn't exist yet | §3 step 1/3 |
| 32 | Sync Log logs `Review`, then several `In Progress` rows (all logged normally); a *later* execution's assignee is cleared and it leaves for `Backlog`, but crashes before that transition is logged. The Time Event side retroactively stamps the reassignment close as the boundary | Step 2 still returns the old, unrelated `Review` run as "the" Sync Log candidate merely because it exists and is non-`In Progress`; using it reports `Review Fix` for a transition that was actually to `Backlog` | §3 step 3 |
| 33 | An outgoing reassignment replacement's Time Event predates `Execution=` (mid-upgrade legacy event), which `Code.gs` deliberately never backfills | Identity-only matching (§6's first bullet) cannot recognize the two sub-intervals as one execution, silently losing Work Type/Review Source across the reassignment | §6 |
| 34 | Reopen actually happens at `12:00:10` (minute-granular in Sync Log); a review lands at `12:00:40`, after work resumed | Rounding the upper bound up to `12:00:59` admits the `:40` review as if it caused the reopen it postdates — the same rounding mistake the lower-bound fix (failure #30) already corrected, repeated on the other bound | §5 |
| 35 | A genuine close to `Review` at t1 succeeds but its paired `logSnapshot_` fails; the Task is edited again while still `Review` at t2 (this edit *does* get logged) before the next reopen | Step 2 returns t2 as the run's earliest available row; comparing "more recent" against the genuine t1 close picks t2, excluding causal reviews submitted between t1 and t2 — failure #14's defect through a different mechanism | §3 step 3 |
| 36 | A mapped execution closes to `Review` (genuine, t1); an unmapped-actor `In Progress` spell follows (opens no Time Event) and returns to `Review` again before the current mapped reopen | The unconditional same-status coalescing rule (failure #35's fix) treats t1 and the new `Review` run as one transition and uses the older t1, moving the lower bound back into the *wrong, earlier* review period | §3 step 3 |
| 37 | Bob reviews at a time definitely inside the Review Source window; Alice reviews later, inside the ambiguous upper-bound minute | Unconditionally preferring the outside-window candidate (Bob) asserts an answer that depends on an unknowable sub-minute ordering — if the true reopen followed Alice's review, she is the correct (more recent) answer | §5 |
| 38 | A genuine close (`Reason=left_in_progress`) records `End Status=Review`, but an unrelated edit lands on the Task page after the real transition and before the next poll | Treating the close's `Ended At` as accurate to the second (because it's the "genuine" case) understates the documented backlog-dependent imprecision that applies to *all* Notion-timestamp evidence, genuine or not | §3 step 1 |
| 39 | A genuine close to `Review` at t1 succeeds and is logged; a later Sync Log row also reports `Review` at t2, with no differently-labeled row observed in between — but the polling model can silently skip an intervening transition inside one interval, so the *absence* of an intervening row cannot distinguish "t1/t2 are the same transition re-observed" from "a real, unobserved `Review`→other→`Review` round-trip happened between them" | The round-7 fix (failures #35/#36) treated "no intervening row found" as proof of the first case and confidently picked t1 — but that inference is unsound given documented polling collapse, so it can silently pick the wrong lower bound in either direction | §3 step 3 |

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
- [ ] A retroactively-stamped Time Event boundary (`Reason=reassignment`/
      `duplicate_reconciliation` + added `Boundary=`) never has its
      `End Status=`/`Ended At` read directly; Sync Log supplies the real
      status/timestamp instead, and a genuine crash-before-log gap is
      surfaced as unresolved, not silently classified (failure #28).
- [ ] `Write=` is in `appendNote_`'s protected-field list, verified by a
      regression test that compacts a closed event and checks `Write=`
      survives (failure #29).
- [ ] A minute-granular Review Source lower bound treats reviews inside
      that ambiguous minute as degraded evidence (prefer a reviewer
      outside the window; degrade to `Other` if none exists) rather than
      resolving the ambiguity by rounding in either direction
      (failure #30).
- [ ] **`ADP-051-C`** (Review Source), when implemented, updates
      `integrations/notion-time-events/README.md`'s Security Model and
      Success Criteria sections — both currently state `NOTION_TOKEN` is
      the *only* secret, which stops being true the moment `GITHUB_TOKEN`
      is added (PR #21 round 2 already had to make this exact README
      update once; this document introducing the plan for `GITHUB_TOKEN`
      without a corresponding README change was itself flagged as
      inconsistent during review).
- [ ] All 39 rows in §7 exist as named regression tests before requesting
      review — do not wait for Codex to rediscover them one at a time.
- [ ] A minute-granular Review Source **upper** bound degrades to `Other`
      whenever an ambiguous-minute review could outrank the best
      outside-window candidate — not a blanket "prefer outside the
      window" (that rule is only unconditionally safe for the *lower*
      bound; failure #37).
- [ ] When a genuine Time Event close and a Sync Log candidate report the
      *same* status at *different* timestamps, this is surfaced as an
      explicit unresolved/ambiguous case (same treatment as failure #28),
      never resolved by inferring transition identity from the presence
      or absence of an intervening Sync Log row — the polling model can
      silently skip an intervening transition entirely, so that inference
      is unsound in either direction (failure #39; supersedes the
      row-scanning discriminator originally proposed for failures #35/#36).
- [ ] A genuine Time Event close's `Ended At` is treated as
      minute-granular, best-effort evidence — never as an implicitly
      trusted second-precision value — unless it independently carries a
      `Write=`-style capture (failure #38).
- [ ] The legacy-inheritance stopping condition (§6) checks for *either*
      `Reason=left_in_progress` or a retroactively-stamped
      `Boundary=left_in_progress`, matching `Code.gs`'s own
      `isExecutionBoundary` — not `Reason` alone (failure #33 update,
      round 6).
- [ ] Failure #27 (churn-history fallback past an `ambiguous_provenance_restart`)
      implements the hard-cutoff rule decided in §6 — no scanning past the
      restart under any circumstances.
- [ ] `stampExecutionBoundary_` writes a fresh `Write=` at the moment it
      retroactively stamps a boundary, distinct from (and overwriting) the
      original close's `Write=` — verified by a regression test comparing
      a retroactive stamp against a Sync Log row written around the same
      time (failure #31).
- [ ] The step-3 fallback to a Sync Log candidate (for a retroactively-
      stamped Time Event boundary) verifies that candidate postdates the
      boundary's own discovery `Write=` before trusting its status — a
      stale Sync Log run from an earlier cycle is rejected the same as no
      Sync Log data at all (failure #32).
- [ ] Legacy (no-`Execution=`) reassignment replacements use the same
      Reason/Boundary legacy heuristic already trusted for Done-gate
      membership to inherit Work Type/Review Source, not identity
      matching alone (failure #33; required for failures #6/#7 to have an
      implementable outcome).

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
