# Skill Sync State Model

ADP-066-T01B reference model. Sync state is evaluated per Skill, never from repository HEAD.

## Independent axes

`lifecycle`: `active | deleted | superseded`

`sync_state`: `initial_import | in_sync | notion_ahead | github_ahead | proposal_open | conflict | roundtrip_mismatch | sync_failed | not_applicable`

## Inputs

- `main_path_exists`
- `M_hash`: effective Skill content on GitHub main
- `L_hash`: last successfully synchronized baseline
- `N_hash`: normalized Notion Skill content
- `open_sync_pr`: whether a sync PR is open
- `open_pr_hash`: proposed content of that PR
- `roundtrip_ok`
- `sync_failed`
- `deleted`
- `superseded`

Repository HEAD SHA is explicitly not an input.

## Decision table / precedence

1. `deleted` -> lifecycle `deleted`, sync `not_applicable`; any open sync PR must be closed.
2. `superseded` -> lifecycle `superseded`, sync `not_applicable`; any open sync PR must be closed.
3. `sync_failed` -> `sync_failed`.
4. `roundtrip_ok == false` -> `roundtrip_mismatch`.
5. `open_sync_pr == true` is evaluated before content equality:
   - if `N_hash == M_hash`, the proposal has been withdrawn; close the stale PR, then state becomes `in_sync`.
   - if `open_pr_hash != N_hash`, the open proposal is stale; replace/close it before further sync.
   - otherwise -> `proposal_open`.
6. No baseline (`L_hash` absent):
   - no main path -> `initial_import`;
   - main path and `N_hash == M_hash` -> `in_sync`;
   - otherwise -> `initial_import` until a baseline is established.
7. With baseline:
   - `M_hash == L_hash && N_hash == L_hash` -> `in_sync`.
   - `M_hash == L_hash && N_hash != L_hash` -> `notion_ahead`.
   - `M_hash != L_hash && N_hash == L_hash` -> `github_ahead`.
   - `M_hash != L_hash && N_hash != L_hash && M_hash == N_hash` -> `in_sync` and advance baseline after verification.
   - otherwise -> `conflict`.

## Invariants

- A change to Skill B cannot make Skill A `github_ahead`.
- An open proposal cannot disappear merely because Notion status says Review or because main happens to equal an older baseline.
- Reverting Notion to current main withdraws the proposal; stale PRs must not remain mergeable.
- GitHub direct change makes Notion non-authoritative until reconciliation.
- Markdown round-trip mismatch is a representation failure, not a content conflict.
- Deleted/superseded Skills are never displayed as `in_sync`.
- Sync PR authority and quality gates remain governed by R02; this model does not grant merge authority.

## Acceptance examples

| Case | Expected |
|---|---|
| first import, no main | initial_import |
| first import, equal main/notion | in_sync |
| unchanged | in_sync |
| Notion-only edit | notion_ahead |
| GitHub-only edit | github_ahead |
| both edit differently | conflict |
| both converge identically | in_sync |
| valid open proposal | proposal_open |
| Notion reverts to main with open PR | close PR -> in_sync |
| open PR content differs from latest Notion | stale proposal: replace/close before sync |
| round-trip mismatch | roundtrip_mismatch |
| sync transport/write failure | sync_failed |
| deleted | not_applicable |
| superseded/renamed old Skill | not_applicable |

T02/T03/T04 implementations must implement this precedence exactly and add table-driven tests before changing operational sync behavior.
