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
     second-precision value (failure #38, found during this document's
     own review). **`Write=` does not rescue this**: it is the Apps
     Script's own write time (useful only for §4's tie-breaking between
     two *competing* candidates), not a capture of the real-world
     transition moment — a delayed reconciliation cycle (e.g. a backlog
     that defers processing a 12:00 transition until 12:15) produces a
     precise `Write=12:15`, which is precise about *when the script ran*,
     not about when the Task actually changed status. Nothing in the
     mechanisms this document specifies can currently produce a trusted,
     second-precision transition-boundary timestamp — that would require
     a different capture (e.g. a webhook, or a field written by whatever
     changed the status itself), which is out of scope for `ADP-051-B`/
     `C`/`D` as specified here (failure #41, found during this document's
     own review — corrects an implication in the failure #38 fix above
     that a future `Write=`-style capture could supply this).
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
   Two further corrections to this candidate construction, both found
   during this document's own review:
   - **A `Type=Story` observation is a hard history cutoff for this
     scan, not merely an ineligible row to skip past.** `logSnapshot_`
     records `Type` (`Code.gs` ~628) and logs *every* observation
     regardless of Type, including a Story's own reduced handling
     (`reconcileStoryTask_`) — it is not limited to executable Task
     rows. A page reclassified from `Type=Story` directly to
     `Type=Task, Status=In Progress` can therefore have an older,
     Story-era `Review` row sitting in its Sync Log history; scanning
     for "the most recent non-`In Progress` status" without a Type
     filter picks that Story-era row up and wrongly labels the Task's
     very first executable interval `Review Fix` (failure #45). Merely
     *excluding* Story-era rows from eligibility while continuing the
     backward scan past them is not enough: if the page was an
     executable Task before its Story spell too (e.g. `Task, Review` →
     `Story` → back to `Task, In Progress`), the scan reaches across the
     Story spell to that older, pre-Story `Review` row and coalesces it
     with the current reopen, exactly the same class of mistake
     failure #27 already ruled out for `ambiguous_provenance_restart` in
     §6 (failure #48, found during this document's own review — corrects
     failure #45's fix, which excluded Story-era rows from eligibility
     but didn't stop the scan from crossing them). The correct rule:
     the most recent `Type=Story` observation is a hard cutoff, same as
     an `ambiguous_provenance_restart`; the scan never crosses it under
     any circumstances. **This same cutoff must also apply directly to
     this §3 step 2 scan for `ambiguous_provenance_restart` itself, not
     only to §6's separate churn-history fallback**: §6 already stops
     churn *inheritance* at the most recent restart, but this step 2
     boundary/Sync-Log scan is a different mechanism that had no
     awareness of the restart marker at all, so it could still reach
     past it to an older, pre-restart `Review` row and classify the
     explicitly fresh, unclassified replacement execution as
     `Review Fix` — reusing an old Review Source even though churn
     inheritance correctly refused to (failure #51, found during this
     document's own review — the restart cutoff decided in §6 for churn
     inheritance was never wired into this separate scan). This step's
     hard cutoff is therefore the most recent of: a `Type=Story`
     observation, **or** an `ambiguous_provenance_restart` close,
     whichever is more recent. Only rows logged with an executable Type
     strictly *after* that cutoff are eligible candidates (a page with
     neither kind of cutoff in its history has none, and the scan simply
     covers its whole history as before); if a cutoff exists and no
     eligible row exists between "now" and it, there is no Sync Log
     candidate at all, the same as if none were ever logged.
   - **Interpret a `done_gate_rejected:...:rollback=<Status>` row by its
     rollback status, not its logged `Status` column.** `logSnapshot_`
     is called with the page's *pre-reconciliation* status (`Code.gs`
     ~561, ~628), but `enforceDoneGate_` can reject an invalid `Done`
     attempt and roll the Task back to `Review` or `In Progress` in that
     same pass (`Code.gs` ~2042–2046), recording the rollback in the
     `outcome` field, not the `status` field. The logged row therefore
     reads `Status=Done` even though the Task's actual effective status
     immediately after that poll is the rollback status. Treating the
     raw `Done` value as this candidate's status — rather than parsing
     `rollback=` out of a `done_gate_rejected:` outcome and using that —
     can hide a genuine `Review` (or `In Progress`) observation behind a
     status this model was never meant to see as a candidate at all
     (`Done` is a terminal gate result, out of scope per §1) and fall
     through to the wrong default classification (failure #46).
3. **Resolve which candidate is actually more recent** using the priority
   order in §4. This must be a single shared resolver — never let Work
   Type and Review Source each re-derive "the most recent relevant
   evidence" independently (PR #21 round 7/13: doing so let them disagree
   about the same instant). **If the Time Event candidate is *genuine*
   (step 1) and it reports the same status as the Sync Log candidate
   (step 2) but the two disagree on timestamp**, first check whether any
   Sync Log row with a *different* status (including `In Progress`, e.g.
   an unmapped-actor spell that opens no Time Event) exists between the
   genuine close's timestamp and the Sync Log run's own start:
   - **If such a row *exists***, it is positive, actually-observed
     evidence of a real intervening transition — a poll captured it, so
     polling collapse cannot have hidden it. The two candidates are
     therefore genuinely different periods of the same status label
     (e.g. `Review` → unmapped `In Progress` → `Review` again before the
     current reopen); apply §4's ordinary "more recent wins" comparison,
     which correctly prefers the newer Sync Log run in this case
     (failure #36, found during this document's own review).
   - **If no such row exists**, this is *not* proof the two candidates
     are the same transition observed twice — an earlier draft of this
     document treated "no intervening row found" as exactly that proof
     and coalesced to the genuine close's earlier timestamp, but that
     discriminator does not work: per README's documented polling model,
     a Task can pass through several states inside one poll interval and
     only its *final* observed state is ever logged, so an intervening
     transition can be entirely **unobserved**, not merely under-logged.
     "No intervening row found" is therefore equally consistent with "no
     intervening transition happened" and "one happened but no poll ever
     landed inside it to see it," and no amount of additional row-scanning
     distinguishes these from Notion-side evidence alone (failure #39,
     found during this document's own review — this is what failures
     #35/#36's original fix got wrong for this specific sub-case, not a
     new case it missed; the *other* sub-case, above, where an
     intervening row does exist, remains correctly resolved by §4 and is
     not affected — failure #40, found during this document's own
     review, corrects failure #39's fix from over-generalizing "no row
     found is ambiguous" into "same status, different timestamp is
     always ambiguous regardless of what evidence exists"). Only this
     no-intervening-row sub-case is genuinely unresolvable: treat it
     exactly like failure #28's "no reliable status source" and surface
     it as an explicit unresolved/ambiguous case for review, never
     silently default to either candidate's timestamp. (The genuine
     close's `End Status=` remains readable on its own in this sub-case
     too — the ambiguity is only about *which timestamp* is the true
     transition boundary, not about whether the status itself is known.)

   §4's "more recent wins" comparison also applies, as before, to
   genuinely *different* candidate transitions (e.g. a later Sync Log
   run reporting a *different* status than a stale Time Event close);
   the two sub-cases above are specifically about same-status,
   different-timestamp candidates. **If the winning candidate is a
   retroactively-stamped Time Event boundary** (step 1), its own
   `End Status=`/`Ended At` cannot supply the classification — fall back
   to the Sync Log candidate from step 2 for the actual status and
   timestamp, even though the Time Event boundary is what proved a
   boundary exists at all. **But first verify that Sync Log candidate is
   not itself stale relative to this boundary**: apply §4's comparison
   between the Sync Log candidate's timestamp and the boundary's own
   discovery time (its fresh `Write=` from step 1) — **but this specific
   comparison must be `Write=`-to-`Write=` directly, not §4's general
   "Notion timestamp first, `Write=` as tie-break" hierarchy.** §4's
   hierarchy answers "which of two candidate *real-world transitions*
   happened first"; this check answers a different question — "did this
   Sync Log write happen at or after that boundary-discovery write" —
   which is a write-ordering question between two Apps Script actions,
   not a transition-recency question. Mediating it through the Sync Log
   candidate's own Notion-side timestamp breaks exactly the common case
   this check exists to allow: when a backlogged poll cycle both
   discovers the boundary (`stampExecutionBoundary_`, `Write=` at the
   real reconciliation time) and appends the correct Sync Log row for
   the same, delayed transition in the same pass, that row's own
   Notion-side timestamp reflects the transition's *logical* time, which
   can be well before the reconciliation cycle's (and thus the
   boundary's) real `Write=` time — comparing it against the boundary's
   `Write=` as if both were the same kind of evidence wrongly rejects
   this same-cycle row as "predating discovery," reintroducing the
   unresolved verdict this check was built to avoid, for the single
   most common case (an ordinary delayed poll) rather than the crash
   case it targets (failure #42, found during this document's own
   review — corrects failure #32's fix, which specified the comparison
   direction but not that it must use `Write=` on both sides rather than
   routing through §4). A Sync Log run that predates the boundary's
   discovery **by this `Write=`-to-`Write=` comparison** is evidence
   from a *different, earlier* cycle — e.g. an old logged `Review` run
   left over from before a run of logged `In Progress` rows, with the
   current reopen's own transition never logged (crash) — and must be
   rejected the same as having no Sync Log row at all, not trusted
   merely because a same-status run technically exists somewhere in the
   log (failure #32, found during this document's own review). Only
   once the Sync Log candidate's `Write=` is confirmed to postdate the
   boundary's discovery `Write=` may its status be used. (A legacy Sync
   Log row with no `Write=` at all falls back to the same best-effort
   "ever logged" heuristic §4 already prescribes for legacy timestamp
   ties — not to this direct comparison, which requires `Write=` on both
   sides.) If no such
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

     **This "one ambiguous minute" framing itself understates the
     uncertainty when the lower bound comes from a genuine Time Event
     close's `Ended At`** (failure #38's evidence). Per README's
     documented backlog-dependent imprecision, the inflation is **not**
     capped at one poll interval: a sustained write-backlog can defer
     the reconciler's observation of the true transition by
     `ceil(backlog / MAX_TASKS_PER_RUN)` poll cycles, and if an unrelated
     edit lands on the page during that whole deferred span, `Ended At`
     is inflated by that many intervals, not just one. Treating this
     case as "ambiguous only within the recorded minute" can still admit
     or exclude reviews incorrectly across a wider real gap — e.g. the
     true transition at `12:00`, a causal review at `12:05`, and the
     unrelated edit landing at `12:15` recording `Ended At=12:15`: the
     "same-minute" rule above only questions reviews near `12:15`, so it
     wrongly treats the `12:05` review as definitively excluded when it
     is, in fact, causal. Without independent corroboration (an adjacent
     Sync Log row observed closer to the true transition, or a
     `Write=`-style capture, per failure #41's constraint that `Write=`
     itself cannot supply this), the safe lower bound is not "this
     minute" but the **last independently corroborated evidence point
     before this close** — e.g. the Time Event's own `Started At`, or an
     earlier Sync Log row confirming the Task was still `In Progress` —
     through the close's `Ended At`. Any review submitted anywhere in
     that whole span must be treated as potentially causal and cannot be
     safely excluded on timestamp alone; only reviews strictly before
     that earlier corroborated point are safe to exclude (failure #50,
     found during this document's own review — the backlog can span
     multiple poll cycles, not just one minute, so the ambiguity window
     for this specific evidence source must scale with that, not with
     Notion's minute granularity alone).
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
     found during this document's own review). The correct rule requires
     a definite candidate to exist in the first place: **if every review
     in the window falls inside the ambiguous upper-bound minute — no
     review is clearly outside it — there is no "best candidate clearly
     inside the window" to compare anything against.** Whether such a
     review counts at all depends on the unknown sub-minute reopen time
     exactly as in the Bob/Alice case, so this is unresolvable the same
     way an all-ambiguous case is: degrade to `Other` outright, never
     fall through to treating the latest ambiguous-minute review as if
     it were a definite candidate (failure #47, found during this
     document's own review). Otherwise, after picking the best candidate
     reviewer from clearly inside the window,
     check whether any review *inside the ambiguous minute* has a
     timestamp later than that candidate's. If none does, the candidate
     is safe — no possible sub-minute ordering changes the answer. If one
     or more do, **check every one of them, not only the single latest
     one** — each such review is "potentially the latest eligible
     review" under some possible sub-minute reopen time, not just
     whichever happens to be latest overall: with ambiguous reviews at,
     say, `Codex` then `Human` (both after the definite candidate,
     `Human`), a reopen between the two makes `Codex` the latest
     *eligible* one, while a reopen after both makes the second `Human`
     review the latest eligible one — inspecting only the overall-latest
     ambiguous review (`Human`) and finding it matches the definite
     candidate's category would wrongly call this safe, missing that the
     intermediate ordering produces `Codex` instead (failure #49, found
     during this document's own review — corrects failure #44's fix,
     which checked only the single latest ambiguous-minute review).
     Check whether every ambiguous-minute review with a timestamp later
     than the definite candidate's classifies into the **same source
     category** (`Codex`/`Claude`/`Human`/`Other`, per §5 step 3) as that
     definite candidate — the persisted value is the category, not a
     specific reviewer's identity, so if *all* of them agree with the
     definite candidate's category, the result is safe regardless of
     which sub-minute ordering actually happened (this is the case
     failure #44 established: e.g. Bob and Alice both `Human`), and
     asserting that category is not the unjustified specific-reviewer
     guess failure #37 was about. If **any** later ambiguous-minute
     review's category differs from the definite candidate's — even one
     that isn't the single latest by timestamp — the outcome is
     genuinely ambiguous: degrade to `Other`.
     Treat "is this bound
     second-precision or minute-precision" as a fact to carry explicitly,
     never to infer from the value's shape (PR #21 rounds 21, 23, 34 each
     got this precision-mixing wrong in a different way; this document's
     own first attempt at the upper bound repeated the same rounding
     mistake the lower-bound fix above already corrected — failure #34,
     found during this document's own review).
3. Classify the most recent reviewer login inside the window into
   `Codex` / `Claude` / `Human` / `Other`, applying step 2's two
   ambiguous-minute degradation rules **exactly as specified there — they
   are not symmetric, and restating them as one shared rule loses the
   upper bound's stricter condition** (failure #43, found during this
   document's own review — an earlier draft of this summary line
   collapsed both into "prefer a reviewer outside the ambiguous
   window(s); degrade to `Other` if none exists," which is only the
   lower bound's rule and silently drops the upper bound's requirement
   to also degrade when an outside candidate *does* exist but an
   ambiguous-minute review could still outrank it):
   - **Lower bound**: prefer a reviewer clearly outside the ambiguous
     minute; degrade to `Other` only if none exists.
   - **Upper bound**: if no review is clearly outside the ambiguous
     minute at all, there is no definite candidate to begin with —
     degrade to `Other` outright (failure #47). Otherwise, after picking
     the best candidate clearly outside the ambiguous minute, check
     **every** review *inside* the ambiguous minute with a timestamp
     later than that candidate's — not only the single latest one, since
     each is potentially the latest eligible reviewer under some
     sub-minute reopen time (failure #49) — even though an outside-window
     candidate exists (failure #37). Degrade to `Other` if **any** of
     them classifies into a **different** source category than the
     definite candidate; only if all of them classify into the same
     category do both possible orderings agree and no degradation is
     needed (failure #44).
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
| 40 | Same as failure #36's scenario: a genuine close to `Review` (t1), an unmapped-actor `In Progress` spell (opens no Time Event) that *is* logged, then `Review` again (t2) | The failure #39 fix over-corrected: it made *every* same-status/different-timestamp pair ambiguous, including this one, where an actually-observed intervening row positively proves two distinct periods and §4's ordinary comparison resolves it cleanly — blanket ambiguity here wrongly discards a resolvable case | §3 step 3 |
| 41 | A real transition happens at `12:00`, but a backlogged reconciliation cycle doesn't process it until `12:15`, writing `Write=12:15` on the close | Treating that `Write=` as a trusted, second-precision transition-boundary timestamp (as the failure #38 fix implied a future implementation might) reports `12:15` as when the Task changed status, when it actually changed at `12:00` — `Write=` timestamps the script's write, not the real-world transition, and is only valid for §4's tie-breaking between competing *candidates*, never as a substitute transition-boundary capture | §3 step 1 |
| 42 | A backlogged poll both discovers a retroactive boundary (`stampExecutionBoundary_`, real reconciliation time 12:15) and appends the correct Sync Log row for the same delayed transition (logical/Notion timestamp ~12:00) in the same pass | Comparing the Sync Log candidate's own Notion-side timestamp (12:00) against the boundary's `Write=` (12:15) via §4's general hierarchy wrongly rejects this same-cycle row as "predating discovery," reintroducing the unresolved verdict for the single most common case (an ordinary delayed poll), not just the crash case it targets | §3 step 3 |
| 43 | Bob reviews at a time definitely inside the Review Source window; Alice reviews later, inside the ambiguous upper-bound minute (same scenario as failure #37) | The §5 step 3 summary line restated the lower and upper bound degradation rules as one shared rule ("prefer outside window; degrade only if none exists"), silently dropping the upper bound's extra condition (failure #37) that also degrades when an outside candidate exists but an ambiguous-minute review could still outrank it — reintroducing failure #37's exact defect through the summary rather than the detailed rule | §5 step 3 |
| 44 | Bob (definite candidate) and Alice (ambiguous upper-bound-minute review) are both classified as `Human` | The failure #37 fix degrades to `Other` whenever an ambiguous-minute review's timestamp could outrank the definite candidate's, regardless of category — but since the persisted value is the source *category*, not the specific reviewer, both possible orderings here produce `Human` either way; degrading loses information the evidence actually supports | §5 step 2/3 |
| 45 | A page logged as `Type=Story, Status=Review`, later reclassified to `Type=Task, Status=In Progress` | §3 step 2's unfiltered same-status-run scan picks up the Story-era `Review` row as the Task's Sync Log candidate, labeling the Task's first executable interval `Review Fix` instead of `Initial Work` | §3 step 2 |
| 46 | An invalid `Done` attempt with no open Time Event: `enforceDoneGate_` rolls the Task back to `Review`, but `logSnapshot_` (called with the pre-reconciliation status) logs `Status=Done` with outcome `done_gate_rejected:...:rollback=Review` | Reading the row's raw `Status=Done` instead of parsing its `rollback=` outcome hides the genuine `Review` observation behind a status this model was never meant to see as a candidate (`Done` is a terminal gate result, out of scope per §1), falling through to the wrong default classification | §3 step 2 |
| 47 | Every review in the Review Source window falls inside the ambiguous upper-bound minute — none is clearly outside it | With no "best candidate clearly inside the window" to compare against, the procedure as specified has no defined answer and could wrongly persist the latest ambiguous-minute reviewer regardless of whether it actually postdates the true (unknown, sub-minute) reopen | §5 step 2/3 |
| 48 | A page was `Task, Review`, then spent time as `Story`, then converted directly back to `Task, In Progress` | The failure #45 fix excludes Story-era rows from eligibility but doesn't stop the backward scan from continuing past them, so it reaches the older pre-Story `Review` row and coalesces it with the current reopen — the same class of mistake failure #27 already ruled out for `ambiguous_provenance_restart` | §3 step 2 |
| 49 | A definite `Human` review, then in the ambiguous upper-bound minute a `Codex` review, then another `Human` review | The failure #44 fix inspects only the single overall-latest ambiguous-minute review (`Human`, matching the definite candidate) and calls the result safe — but a reopen between the two ambiguous reviews makes `Codex` the latest *eligible* one instead, an outcome the single-review check never considers | §5 step 2/3 |
| 50 | A genuine close's `Ended At` is inflated across multiple deferred poll cycles under a sustained write-backlog (per README's `ceil(backlog / MAX_TASKS_PER_RUN)` bound): true transition at `12:00`, a causal review at `12:05`, an unrelated edit finally observed at `12:15` recording `Ended At=12:15` | Treating the ambiguity as confined to "the recorded minute" (`12:15`) wrongly excludes the genuinely causal `12:05` review, which falls well outside that one-minute window but well inside the real, backlog-dependent uncertainty span | §5 step 2 |
| 51 | An `ambiguous_provenance_restart` close exists, followed by an unrelated executable-Task `In Progress` reopen; an older, pre-restart `Review` row also exists in Sync Log | §6 correctly stops churn *inheritance* at the restart, but §3 step 2's boundary/Sync-Log scan has no awareness of the restart marker and can still reach the older `Review` row, classifying the explicitly fresh, unclassified replacement as `Review Fix` and reusing a stale Review Source | §3 step 2 |

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
- [ ] All 51 rows in §7 exist as named regression tests before requesting
      review — do not wait for Codex to rediscover them one at a time.
- [ ] The retroactive-boundary-vs-Sync-Log staleness check (§3 step 3,
      failure #32) compares `Write=` directly against `Write=` on both
      sides — never routes through §4's general "Notion timestamp first"
      hierarchy, which wrongly rejects a same-cycle Sync Log row whose
      own logical timestamp predates the boundary's `Write=` even though
      both were written in the same reconciliation pass (failure #42).
- [ ] Any summary or restatement of §5's lower/upper-bound ambiguous-
      minute degradation rules keeps them asymmetric — never collapses
      them into one shared "prefer outside window, degrade if none
      exists" rule, which silently drops the upper bound's extra
      degrade-even-with-an-outside-candidate condition (failure #37,
      restated correctly per failure #43).
- [ ] The upper-bound degrade rule (failure #37) degrades to `Other`
      only when the ambiguous-minute review's classified source
      *category* differs from the definite candidate's — not merely
      because their timestamps could tie in either order. Two
      reviewers in the same category (e.g. both `Human`) never need
      degradation, since the persisted value is the category, not the
      specific reviewer (failure #44) — but this check covers **every**
      ambiguous-minute review with a timestamp later than the definite
      candidate's, not only the single overall-latest one, since any of
      them can be "the latest eligible reviewer" under some sub-minute
      reopen ordering (failure #49).
- [ ] §3 step 2's Sync Log candidate scan treats the most recent
      `Type=Story` observation as a hard history cutoff — like
      `ambiguous_provenance_restart` in §6 — never merely excluding
      Story-era rows while letting the scan continue past them to an
      older, pre-Story executable-Task row (failure #45; hard-cutoff
      correction failure #48).
- [ ] §3 step 2's Sync Log candidate scan also applies the
      `ambiguous_provenance_restart` hard cutoff directly to itself, not
      only relying on §6's separate churn-inheritance cutoff — the scan
      never reaches past the most recent restart to an older, pre-restart
      status row (failure #51).
- [ ] The Review Source lower bound, when sourced from a genuine Time
      Event close's `Ended At` with no independent corroboration, treats
      the ambiguity window as spanning back to the last independently
      corroborated evidence point (e.g. the event's own `Started At`, or
      an earlier confirming Sync Log row) — never as confined to "the
      recorded minute," since README's documented backlog-dependent
      imprecision can span multiple poll cycles, not just one
      (failure #50).
- [ ] §3 step 2's Sync Log candidate construction interprets a
      `done_gate_rejected:...:rollback=<Status>` row by its parsed
      rollback status, never by the row's raw logged `Status` column,
      which reflects the pre-reconciliation (rejected) `Done` value
      (failure #46).
- [ ] The Review Source upper bound explicitly degrades to `Other` when
      no review is clearly outside the ambiguous minute at all (no
      definite candidate exists to compare against), rather than
      leaving that case undefined (failure #47).
- [ ] A minute-granular Review Source **upper** bound degrades to `Other`
      whenever an ambiguous-minute review could outrank the best
      outside-window candidate — not a blanket "prefer outside the
      window" (that rule is only unconditionally safe for the *lower*
      bound; failure #37).
- [ ] When a genuine Time Event close and a Sync Log candidate report the
      *same* status at *different* timestamps, check for an intervening
      Sync Log row with a *different* status between them: if one
      **exists**, it is positive evidence of a real intervening
      transition and §4's ordinary "more recent wins" comparison resolves
      it (failure #36); if **none exists**, the two readings ("same
      transition re-observed" vs. "an unobserved round-trip that polling
      collapsed") are indistinguishable from Notion-side evidence alone,
      and this sub-case only is surfaced as an explicit
      unresolved/ambiguous case (same treatment as failure #28) — never
      resolved by inferring transition identity from the mere absence of
      a row (failure #39), and never generalized into treating *every*
      same-status/different-timestamp pair as ambiguous regardless of
      whether an intervening row exists (failure #40).
- [ ] A genuine Time Event close's `Ended At` is treated as
      minute-granular, best-effort evidence — never as an implicitly
      trusted second-precision value (failure #38). This holds even when
      the close also carries a `Write=`: `Write=` is the script's own
      write time, valid only for §4's tie-breaking between competing
      candidates, and must never be promoted to a trusted transition-
      boundary capture — a backlogged reconciliation cycle can write a
      precise `Write=` long after the real transition (failure #41).
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
