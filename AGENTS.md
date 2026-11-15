# Repository Instructions

## Current direction

- Workbench runs on Ja's Mac at `http://127.0.0.1:<port>`. There is no owner login, login screen, magic link, or Sign out. The app silently opens a workspace session through `POST /api/auth/local-session`; it is loopback-only, rejects forwarded/proxy requests, and uses a machine secret file. Never add a login, OAuth prompt, or session gate. Tailscale and iPad access are off.
- Data stays in hosted Supabase. Do not use local Supabase or Docker. The Supabase CLI is a dev dependency for managing the hosted database from this Mac.
- Gmail integration is removed. Calendar, Google sign-in, and Google Sheets import by link are off behind default-off flags `VITE_GOOGLE_CALENDAR_ENABLED` and `VITE_GOOGLE_WORKSPACE_ENABLED`. CSV/XLSX import works.
- The interface is one screen: Jobs column, Candidates (People / Swipe / Board), Today, and Meetings. Map, Process, Leads, Settings, and Profile open as panels. The old 12 pages are not pages.
- The top agent decides and delegates; use cheaper workers for hands-on work.
- Open items: slow reads on `candidate_review_feed` and presentations have a draft fix in `apps/gateway/migrations/032`, not applied. Branded resume PDF tests need Python `reportlab`.

## Source of truth and codebase knowledge

1. Treat the current `main` branch and its tests as the source of truth.
2. Use Graphify at `https://api.graphify.com/mcp` for codebase knowledge, code relationships, and prior implementation lookup when it is available.
3. Keep Graphify useful across development and production branch history so earlier code, including rejected code, can be found before new code is written.
4. Graphify is a knowledge aid, not permission to trust stale output. Verify every recommendation against the current Git commit and tests.
5. Search for and reuse existing code before creating a replacement. Do not recreate features merely because an AI session lacks context.

## UI and product direction

1. Ja owns UI and frontend direction. Do not invent dashboard metrics, candidate records, activity, integrations, or product states.
2. Use `google/skills` as the official know-how source for Google Drive, Docs, Sheets, and Calendar workflows when enabled. Google product features are switched off for now; do not turn them on without Ja's direction.
3. Ja may use Nylas products, screens, or documentation to describe a desired workflow or layout. Treat that as a reference unless he explicitly requests a Nylas integration.
4. Do not merge or restore archived synthetic UI wholesale. Reuse only a specifically approved interaction or component idea.

## Google Cloud project lock

All Google Workspace and Google Cloud work for this repository must use this one project:

- Project name: `workdock`
- Project ID: `macro-coil-484621-p1`
- Project number: `755318032067`
- Primary Google account: `emailjanow` + `@gmail.com`
- Approved business Google account: `ja` + `@toptiertalentgroup.com`

The addresses are deliberately split above to satisfy the repository privacy check. Treat both as approved accounts for work on the Google project; do not replace either one with an assumed account. Google product features are switched off for now; this project lock does not enable them.

Before any Google Cloud command or configuration change:

1. Use a named `gcloud` configuration called `workdock`.
2. Verify that the active account matches one of the approved Google accounts above and the active project is `macro-coil-484621-p1`.
3. Pass `--project=macro-coil-484621-p1` explicitly whenever the command supports it.
4. Stop if the account or project does not match. Never fall back to another default project, including `project-tttg`.
5. Keep OAuth secrets, client secrets, service-account keys, and tokens out of the repository.
6. Request the minimum permissions needed and never populate the UI with fabricated Google data or connection states.

## Runner use

Use available subagents as runners for bounded research, audits, and independent verification. The primary agent remains responsible for decisions, edits, integration, and the final result.

## Nylas development

These rules apply only when Nylas is actually being integrated:

1. Use Nylas v3 only. Never use deprecated v2 patterns such as `access_token` and `client_secret`; v3 uses `api_key` and `grant_id`.
2. Use the official [Nylas coding-agent guide](https://developer.nylas.com/docs/v3/getting-started/coding-agents/) as the primary reference.
3. Start documentation lookup with the official [Nylas llms.txt](https://developer.nylas.com/llms.txt). Fetch specific documentation pages as Markdown when useful.
4. Use the official Nylas SDK whenever the repository's language is supported. This repository uses Node.js, so prefer the official Node.js SDK.
5. Consult the official Nylas v3 [OpenAPI specification](https://developer.nylas.com/openapi.json) when exact endpoints, parameters, request bodies, response schemas, or types are needed.
6. Do not recreate functionality already available in the Nylas SDK.
7. Do not build custom HTTP wrappers unless the supported SDK genuinely lacks the required feature. If raw HTTP is necessary, document the SDK gap.
8. Keep Nylas integration code thin, reusable, server-side, and easy to maintain.
9. Prefer official Nylas examples and documented patterns over large custom implementations written from scratch.
10. Never hardcode, commit, log, or expose Nylas API keys. Store secrets in environment variables, and never make authenticated Nylas API calls from client-side code.
11. Follow current official guidance for regional API URIs, pagination, webhook-driven updates, grant lifecycle, and error handling.
