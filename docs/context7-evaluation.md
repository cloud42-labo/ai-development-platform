# Context7 Evaluation — Compose / Android Location SDK (ADP-031-D)

Date: 2026-09-26 (JST)
Decision: **not adopted as a version-pinned verification source; allowed as an optional lookup aid under conditions (§6)**. Task status, timestamps and Human wait records live in the Notion task, not here.
Scope: Notion `ADP-031-D｜Context7を導入しCompose・Android SDKを検証する`
(Story ADP-027 / ADP-028). Executed as Thread D of the
`ADP-064-T03` Claude Projects parallel-thread PoC.

Acceptance criteria (verbatim from Notion, not relaxed):

> Context7で対象バージョンのComposeおよびAndroid位置情報API/SDKの一次資料に到達し、
> 既存実装と現行仕様の差分、影響、修正要否を根拠付きで記録して、Context7の採用可否
> または利用条件を判断できる。

Approach Decision (Notion): single-shot PoC on one real Compose/Android SDK problem,
comparing Context7 against reading official docs directly. No standing MCP or new
infrastructure before value is shown.

## 1. Target implementation

`cloud42-labo/serendipity-spot` (ついでにスポット) at `5441166` (2026-09-22 JST),
read-only.

| Item | Version in `android/app/build.gradle.kts` |
|---|---|
| AGP / Kotlin / Compose compiler plugin | 8.7.2 / 2.0.21 / 2.0.21 |
| `compileSdk` / `targetSdk` / `minSdk` | 36 / 36 / 26 |
| `androidx.compose:compose-bom` | 2024.09.03 |
| `com.google.android.gms:play-services-location` | 21.3.0 |
| `com.google.maps.android:maps-compose` | 6.2.1 |
| `androidx.activity:activity-compose` / lifecycle | 1.9.3 / 2.8.7 |

Location surface used: `GeofencingClient` (`location/GeofenceHelper.kt`),
`GeofencingEvent` receiver (`location/GeofenceBroadcastReceiver.kt`), boot
re-registration (`location/BootReceiver.kt`), `FusedLocationProviderClient.lastLocation`
(`ui/MapScreen.kt:180,533`, `ui/SpotViewModel.kt:310`), foreground→background
permission sequence (`MainActivity.kt:87-131`).

## 2. Context7 access attempt (blocked)

| Path | Result |
|---|---|
| `curl https://context7.com/api/v1/search` from the cloud container | CONNECT 403 from the environment network policy (`context7.com:443`) |
| `https://mcp.context7.com/mcp` (hosted MCP) | CONNECT 403 (`mcp.context7.com:443`) |
| `npx @upstash/context7-mcp` (npm 4.1.1 reachable) | Not viable: the local server calls the same `context7.com` API, so it hits the same 403 |
| WebFetch of the Context7 REST API | Refused (`robots.txt` disallows `/api`) |
| WebFetch of the Context7 library page `context7.com/websites/developer_android_develop` | Reachable, but it is only the index page, not the docs query path |
| claude.ai Context7 connector (`resolve-library-id`, `query-docs`) | **Works once the Owner connects it.** All queries in §4 ran through it; the container network policy does not apply on this path |

human-gate-preflight Step 0: no AI-only route reaches Context7's query path. Both
remaining routes are a permission grant (connector OAuth, or network allow-list),
so they are Human-only (tracked as `HUMAN-ADP-031-D-1` in Notion). Enabling the connector needs no network allow-list change.

Research pre-flight (`governance/research-security-policy.md` §6) for the future
Context7 calls: outbound payload is public library names and public API questions
only (no code, no secrets); primary source = official docs indexed by Context7;
budget = the 6 questions in §4; billing = use only the free plan / bundled connector,
no paid plan without separate Owner approval; no write actions.

## 3. Baseline: existing implementation vs official docs (read directly)

This is the comparison baseline required by the Approach Decision. Sources were read
directly on 2026-09-26 JST.

| # | Topic | Official guidance (source) | Existing implementation | Diff / impact | Fix needed |
|---|---|---|---|---|---|
| B1 | **Re-register after `GEOFENCE_NOT_AVAILABLE`** (chosen real problem) | "The app must re-register geofences … The app has received a GEOFENCE_NOT_AVAILABLE alert. This typically happens after NLP … is disabled." ([Geofencing](https://developer.android.com/develop/sensors-and-location/location/geofencing)) | `GeofenceBroadcastReceiver.kt` logs `エラー code=…` and returns. `resync()` is only called from `BootReceiver` and from `SpotViewModel.loadSpots()` after a signed-in network load. | After the user turns location off and on, geofences stay gone until the next reboot or a successful signed-in load. Notifications stop silently (the diagnostic string is the only trace). | **Yes (P2)**. Re-register from `SpotLocalCache` when location becomes available again. Separate serendipity-spot Task; not changed here. |
| B2 | Reboot re-registration | "The device is rebooted. The app should listen for the device's boot complete action, and then re-register" (same page) | `BootReceiver` + `RECEIVE_BOOT_COMPLETED`, re-registers from local cache | Matches | No |
| B3 | PendingIntent flags | `FLAG_UPDATE_CURRENT`; "Starting on Android S+ the pending intent has to be mutable" (same page) | `FLAG_UPDATE_CURRENT or FLAG_MUTABLE` | Matches | No |
| B4 | Limit 100 / app | "a limit of 100 per app, per device user" (same page) | `takeLast(100)` (newest first) | Matches | No |
| B5 | Initial trigger | Docs suggest `INITIAL_TRIGGER_DWELL` to reduce alert spam (same page) | `setInitialTrigger(0)` + ENTER/DWELL, deliberate "notify on approach, not presence" | Intentional product choice, documented in code | No |
| B6 | Radius | "minimum radius … between 100 - 150 meters" (same page) | Default 150 m (`data/Spot.kt:16`) | Matches | No |
| B7 | Background permission | `ACCESS_BACKGROUND_LOCATION` required when targeting API 29+ (same page) | Separate request after foreground grant | Matches | No |
| B8 | Current location | `getLastLocation()` can be `null` (location off, no fix yet, Play services restart); `getCurrentLocation()` "is the recommended way to get a fresh location" ([Retrieve current location](https://developer.android.com/develop/sensors-and-location/location/retrieve-current)) | `lastLocation` for initial camera and for walking-route origin | Route silently not fetched when `null` (`SpotViewModel.kt:311`) | **Recommended (P3)**, `getCurrentLocation` fallback for the route origin |
| B9 | `play-services-location` version | 21.4.0 (2026-06-25): "Changed IMPLICIT_MIN_UPDATE_INTERVAL to represent half of the requested interval." ([Release notes](https://developers.google.com/android/guides/releases)) | 21.3.0, no `requestLocationUpdates` | No impact | No |
| B10 | `maps-compose` version | Latest 8.6.0 (2026-09-03); `rememberMarkerState` is `@Deprecated` in favour of `rememberUpdatedMarkerState` ([source](https://github.com/googlemaps/android-maps-compose/blob/main/maps-compose/src/main/java/com/google/maps/android/compose/Marker.kt)) | 6.2.1; `remember(id, lat, lng) { MarkerState(...) }` (not the deprecated API) | Two majors behind (7.0.0, 8.0.0). README does not state breaking changes | Upgrade decision out of scope; no bug found |
| B11 | Compose BOM mapping | The mapping is **determinable**: the published POM `androidx.compose:compose-bom:2024.09.03` (Google Maven) and the app's resolved Gradle graph both state it. In this environment neither could be read: `dl.google.com` / `maven.google.com` are blocked by the network policy and disallowed by robots.txt for WebFetch, Gradle cannot resolve without Google Maven, and the [BOM mapping](https://developer.android.com/develop/ui/compose/bom/bom-mapping) page renders its table with JavaScript | 2024.09.03 | Not a spec gap, only an environment gap. The ground truth is still one POM read away | Open: close it with `./gradlew :app:dependencies --configuration releaseRuntimeClasspath` on a machine with Google Maven access |

Direct-docs friction observed: B10 needed a source clone (README silent), and B11
could not be read from this environment (the authoritative POM host is blocked; the docs page needs a browser). These are the concrete points where Context7 is
expected to help.

## 4. Context7 results

Same questions as planned before the run. Context7 offered **no version selection**
for any Android / Compose documentation library (`resolve-library-id` listed no
`Versions`), so none of the answers could be pinned to the app's versions.

| Q | Question | Context7 library used | Result | vs baseline |
|---|---|---|---|---|
| Q1 | material3 / ui versions in BOM 2024.09.03 | `/websites/developer_android_develop_ui_compose` | **Fail.** Returns BOM setup snippets (for 2026.08.00, one release behind the live page's 2026.09.00) and a description of the mapping page, not the mapping rows | Neither path produced the rows here. Scoring Q1 does not need the ground-truth values: Context7 returned no mapping rows for any BOM version, so it fails regardless of what the POM says |
| Q2 | Re-registration after `GEOFENCE_NOT_AVAILABLE` | `/websites/developer_android`, `/websites/developer_android_develop`, `/websites/developer_android_guide` | **Fail.** "No documentation matched" / "Could not fetch" on all 3 attempts | Direct read (B1) found it on the first page |
| Q3 | `getCurrentLocation` vs `lastLocation` | `/websites/developer_android_guide` (3rd attempt) | **Pass.** Cites `developer.android.com/guide/topics/location/strategies`: null cases and "getCurrentLocation() … the recommended and safer approach" | Matches B8 |
| Q4 | maps-compose MarkerState / 6→8 changes | `resolve-library-id` ×2, `/googlemaps/android-maps-utils` | **Fail.** `android-maps-compose` is not indexed; closest hits were other map SDKs | Direct read needed a source clone (B10) |
| Q5 | `collectAsState` vs `collectAsStateWithLifecycle` | `/websites/developer_android_develop_ui_compose` | **Pass.** Cites `developer.android.com/develop/ui/compose/state`: "collectAsStateWithLifecycle … is the recommended way to collect flows in Android apps" | **New diff N1** (not in baseline) |
| Q6 | Android 16 (API 36) changes affecting location | `/android/skills` | **Partial.** No API 36 geofencing change returned. Returned Play Location Access Policy matrix (official `android/skills` repo): background location disclosure must say "location" and "when closed or not in use" | **New check N2** |

New findings from Context7:

| # | Topic | Source cited by Context7 | Existing implementation | Impact | Fix needed |
|---|---|---|---|---|---|
| N1 | Flow collection in Compose | [State and Jetpack Compose](https://developer.android.com/develop/ui/compose/state) | `viewModel.uiState.collectAsState()` (`MainActivity.kt:67`) | Collection continues while the Activity is in the background (resource use only; no functional bug found) | Recommended (P3) |
| N2 | Background location prominent disclosure | [android/skills play-policy-insights](https://github.com/android/skills/blob/main/play/play-policy-insights/resources/goal_permissions_and_apis.md) | `OnboardingIntro.kt:66` states location use "アプリを閉じているときや…" before the OS dialog | Meets the stated condition | No |

Usage: 14 Context7 calls (4 `resolve-library-id`, 10 `query-docs`) on the connector's
free plan. No code or secrets were sent; queries contained public library names and
API questions only.

## 5. Adoption criteria (decision rule, fixed before running)

- **Adopt as optional connector for SDK-dependent tasks** if Context7 answers Q1
  and Q4 correctly with a citable primary source and does not contradict B1–B8.
- **Adopt with conditions** (always cross-check the cited official page) if it
  answers but cannot pin versions or cites non-official sources.
- **Do not adopt** if it cannot reach version-specific primary sources or gives
  answers that contradict the official pages above.

AGENTS.md "Verify current primary documentation" stays the rule either way;
Context7 is a retrieval aid, not a new source of truth.

## 6. Result and decision

Score: 2 pass (Q3, Q5), 1 partial (Q6), 3 fail (Q1, Q2, Q4). No answer
contradicted the official pages.

**Decision: not adopted as a version-specific verification source for ADP.**
Q1 and Q4 both failed, and no Android/Compose library in Context7 offers version
pinning, so the "Do not adopt" condition applies to the task's core question
("対象バージョンの一次資料"). It also missed the one real defect (B1) that a direct
read found on the first page.

**Usage conditions (optional aid, not a gate):**

1. Use it for "what is the current recommended API" questions on well-indexed
   official docs (developer.android.com Compose/guide). It surfaced one diff (N1)
   and one policy check (N2) that the baseline had not covered.
2. Always open the cited URL and quote it in evidence; Context7 output alone is
   not evidence under AGENTS.md.
3. Do not use it for version mapping, release notes, or libraries it does not
   index (android-maps-compose). Read the release notes / source directly.
4. Budget: at most 3 `query-docs` calls per question (the tool's own limit); a
   miss after that means switch to direct reading.
5. No standing MCP setup or new infrastructure (Approach Decision). The claude.ai
   connector is enough and needs no network allow-list change.

Fix candidates for `serendipity-spot` (not changed by this task): B1 (P2),
B8 (P3), N1 (P3).
