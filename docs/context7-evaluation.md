# Context7 Evaluation — Compose / Android Location SDK (ADP-031-D)

Date: 2026-09-26 (JST)
Status: **Partial — baseline complete, Context7 side blocked on `HUMAN-ADP-031-D-1`**
Scope: Notion `ADP-031-D｜Context7を導入しCompose・Android SDKを検証する`
(Story ADP-027 / ADP-028, Approach Review = Approved). Executed as Thread D of the
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
| claude.ai connector directory | Official **Context7** connector exists (`resolve-library-id`, `query-docs`), not connected |

human-gate-preflight Step 0: no AI-only route reaches Context7's query path. Both
remaining routes are a permission grant (connector OAuth, or network allow-list),
so they are Human-only → `HUMAN-ADP-031-D-1` (Notion, Status Ready, Assigned Human).

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
| B11 | Compose BOM mapping | Latest BOM 2026.09.00 listed, but the per-library mapping table is rendered by JavaScript and **could not be read** by direct fetch ([BOM mapping](https://developer.android.com/develop/ui/compose/bom/bom-mapping)) | 2024.09.03 | Unknown: which `material3` / `ui` version the app runs on cannot be confirmed from docs alone | Open (Context7 question Q1) |

Direct-docs friction observed: B10 needed a source clone (README silent), and B11
was unreadable without a browser. These are the concrete points where Context7 is
expected to help.

## 4. Context7 comparison plan (to run after `HUMAN-ADP-031-D-1`)

Same questions, answered through Context7 `resolve-library-id` → `query-docs`,
pinned to the app's versions where Context7 offers version selection.

| Q | Library (target version) | Question | Compare against |
|---|---|---|---|
| Q1 | Compose BOM 2024.09.03 | material3 / ui versions in this BOM | B11 (direct docs failed) |
| Q2 | play-services-location 21.3.0 | Required handling of `GEOFENCE_NOT_AVAILABLE` / re-registration | B1 |
| Q3 | play-services-location 21.3.0 | `getCurrentLocation` vs `lastLocation` | B8 |
| Q4 | maps-compose 6.2.1 vs 8.6.0 | MarkerState creation guidance and breaking changes 6→8 | B10 |
| Q5 | Compose (BOM 2024.09.03) | `collectAsState` vs `collectAsStateWithLifecycle` for `MainActivity.kt:67` | New |
| Q6 | Android 16 (API 36) | Location / background behavior changes affecting geofencing | New |

Per question, record: reached the primary source? (Y/N + URL Context7 cites),
version-correct? , matches or contradicts the baseline, time and tool calls used.

## 5. Adoption criteria (decision rule, fixed before running)

- **Adopt as optional connector for SDK-dependent tasks** if Context7 answers Q1
  and Q4 correctly with a citable primary source and does not contradict B1–B8.
- **Adopt with conditions** (always cross-check the cited official page) if it
  answers but cannot pin versions or cites non-official sources.
- **Do not adopt** if it cannot reach version-specific primary sources or gives
  answers that contradict the official pages above.

AGENTS.md "Verify current primary documentation" stays the rule either way;
Context7 is a retrieval aid, not a new source of truth.

## 6. Result

_Pending `HUMAN-ADP-031-D-1`._ The acceptance criterion is **not yet met**: the
baseline (differences, impact, fix need) is recorded above, but Context7 has not
reached the primary sources, so the adoption decision cannot be made yet.
