# Standalone Apps Script setup

Use this path when **Extensions → Apps Script** is not available in the Google Sheet UI.

1. Open `https://script.google.com/home` and create a **New project**.
2. In `Code.gs`, paste the full contents of this directory's `Code.gs`.
3. Add a second script file named `StandaloneBootstrap.gs` and paste this directory's `StandaloneBootstrap.gs`.
4. Open **Project Settings → Script Properties** and add `NOTION_TOKEN` with the Notion integration token that can read Stories & Tasks. Do not store the token in GitHub or Sheets.
5. Run `setupStandalone()` once and approve permissions.
6. Run `showSetupInfo()` and note the generated `webhookKey`.
7. Deploy → New deployment → Web app. Execute as yourself and choose an access level that allows Notion to POST without Google sign-in.
8. Register `<WEB_APP_EXEC_URL>?hookKey=<WEBHOOK_KEY>` in the Notion integration's Webhooks settings for `page.properties_updated`.
9. After the verification POST arrives, run `showVerificationToken()` and paste the token into Notion's verification screen.
10. Test a Task with `Ready → In Progress → Review` and confirm the `Time Events` sheet opens and closes one row.

PoC spreadsheet ID is embedded only in `StandaloneBootstrap.gs`; it is not a secret.
