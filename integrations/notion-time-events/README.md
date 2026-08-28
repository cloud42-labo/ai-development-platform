# Notion Status → Google Sheets Time Events PoC

## Purpose

Keep Notion as the system of record for Product / Epic / Story / Task and store only effort/time events in Google Sheets.

Flow:

`Notion Stories & Tasks Status change` → `Notion page.properties_updated webhook` → `Apps Script web app` → `Google Sheets Time Events`

## PoC behavior

- `Status = In Progress` opens one Time Event for the Task's `Assigned Agent`.
- `Status = Review / Done / Blocked` closes the matching open Time Event.
- Actor mapping:
  - `ChatGPT` → `Chris`
  - `Claude Opus / Sonnet / Haiku` → `Claude`
  - `Codex` → `Codex`
  - `Human` → `Human`
- Other task property changes are ignored.
- Webhook event IDs are deduplicated in a hidden `Webhook Log` sheet.
- A Task + Actor cannot have two simultaneous open events.

## Google Sheet

PoC spreadsheet:

https://docs.google.com/spreadsheets/d/1tjzjNqHEnPkzQGqB_ydxdWSKsdth27IUJaRrm_5xGks/edit

Tabs:

- `Time Events` — authoritative effort log for the PoC.
- `Summary` — Actor totals and open-event counts.
- `Config` — non-secret configuration reference.
- `Webhook Log` — hidden delivery/idempotency log.

Spreadsheet timezone must remain `Asia/Tokyo`.

## One-time setup

### 1. Create the Apps Script project

Open the PoC Google Sheet → **Extensions → Apps Script**.

Copy `Code.gs` from this directory into the bound Apps Script project.

### 2. Configure the Notion token

In Apps Script **Project Settings → Script Properties**, add:

- `NOTION_TOKEN` = the token for the Notion connection that can read Stories & Tasks.

Do not put the token in GitHub or the spreadsheet.

### 3. Initialize

Run `setup()` once from the Apps Script editor and approve the requested permissions.

Then run `showSetupInfo()` and read the execution log. It prints the generated `webhookKey` plus the configured data source/property IDs.

Current defaults:

- Stories & Tasks data source: `fc5e770f-c68e-4799-afe7-ec4bff0dab59`
- Status property ID: `RWN3TQ`

### 4. Deploy as a Web App

Apps Script → **Deploy → New deployment → Web app**.

- Execute as: **Me**
- Who has access: select the option that allows Notion's servers to POST without Google sign-in.

Copy the deployment `/exec` URL.

The Notion webhook URL is:

`<WEB_APP_EXEC_URL>?hookKey=<WEBHOOK_KEY>`

The random query key is a PoC guard because Apps Script web-app event objects do not expose incoming HTTP headers, so this implementation cannot validate Notion's `X-Notion-Signature` HMAC header.

### 5. Create the Notion webhook subscription

In the Notion connection settings, create a webhook subscription with:

- URL: the URL above
- Event: `page.properties_updated`

Notion sends a one-time `verification_token` to the endpoint.

After that POST arrives, run `showVerificationToken()` in Apps Script (or visit `<WEB_APP_EXEC_URL>?hookKey=<WEBHOOK_KEY>&action=verification-token`) and paste the returned token into Notion's verification UI.

### 6. Test

Use a non-production test Task whose `Assigned Agent` is one of the mapped actors.

1. Change `Ready → In Progress` in Notion.
2. Confirm a row appears in `Time Events` with `Started At` and no `Ended At`.
3. Change `In Progress → Review`.
4. Confirm the same row receives `Ended At`, `End Status = Review`, and a calculated duration.
5. Repeat once for an AI-driven status change to confirm human UI edits and API edits use the same webhook path.

## Known PoC limitations

### Aggregated webhook delivery

Notion documents `page.properties_updated` as an aggregated event. Very fast status transitions may be collapsed before delivery. The PoC must test whether this matters for real Cloud42 task durations.

### Signature validation

Notion recommends validating `X-Notion-Signature`. Apps Script web-app `doPost(e)` exposes query parameters and post body but not the incoming request headers needed for that validation. This PoC therefore uses a high-entropy `hookKey` query parameter.

If the PoC becomes production infrastructure, move the public webhook receiver to an endpoint that can validate headers (for example a small Cloudflare Worker) and forward validated events to the same Sheet-writing logic.

## Success criteria

- Human Notion Status edits create/close Time Events without pressing a separate button.
- Chris / Claude / Codex Status edits through Notion API create/close Time Events through the same path.
- Duplicate webhook retries do not duplicate Time Events.
- Normal conversation and non-Task activity produce no Time Event.
- Actor totals in `Summary` reconcile with Time Events.
- No material status-change events are lost during the PoC window.
