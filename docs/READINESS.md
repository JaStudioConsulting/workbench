# Deployment readiness

## Current local setup

- Workbench runs on Ja's Mac at `http://127.0.0.1:<port>`. There is no owner login. `POST /api/auth/local-session` silently opens the workspace session on loopback and rejects forwarded/proxy requests.
- Data stays in hosted Supabase project `abnfffkmxqixrwzackjf`; local Supabase and Docker are not used.
- Tailscale and iPad access are off. Gmail integration is removed. Calendar, Google sign-in, and Google Sheets import by link are disabled by default; CSV/XLSX import works.
- Tracker source tables remain read-only; existing review actions and drafts use RLS.
- Migrations `008`–`011`, `020`–`022`, and operator/import migrations `023`–`029`, `031` are applied and verified in project `abnfffkmxqixrwzackjf`. Migration `030` remains deferred and is not applied.
- Slow database reads on `candidate_review_feed` and presentations have a draft fix in `apps/gateway/migrations/034_rls_initplan_tracker_policies.sql` and `apps/gateway/migrations/035_rls_initplan_remaining_policies.sql`; they are not applied.

## Reviewed source and release gates

The interface is one screen: Jobs column, Candidates (People / Swipe / Board), Today, and Meetings. Map, Process, Leads, Settings, and Profile open as panels.

Branded PDF and Word files are built from saved resume text by a deterministic formatter with no AI or network calls.

The operator approval desk remains behind `VITE_OPERATOR_CASES_ENABLED` (default off). It cannot send email, submit candidates, or write Tracker through an approval action. The Loxo control records only the user's report of manual entry.

## Not active or still gated

- Adzuna search and candidate marketing. See [`ADZUNA-MARKET-CANDIDATE.md`](ADZUNA-MARKET-CANDIDATE.md).
- Automatic outreach or automatic Leads creation. Email is always a draft.
- AI fit check, outreach personalization, and AI-assisted after-call drafting until `ANTHROPIC_API_KEY` is configured in the runtime.
- Google Calendar, Google sign-in, and Google Sheets import by link are off behind default-off flags `VITE_GOOGLE_CALENDAR_ENABLED` and `VITE_GOOGLE_WORKSPACE_ENABLED`.
- Supabase transcript expiry and scheduled cleanup: migration `030` is deferred and not applied. Browser/native cleanup also needs verification on the target runtime; see [`RETENTION.md`](RETENTION.md).
- Public internet hosting.

## Acceptance still required

- Apply and verify migrations `034` and `035` only through the approved hosted-database workflow.
- Keep migration `030` deferred unless separately authorized; retention scheduling and cleanup remain unaccepted.

No migration or live-data write was performed for this documentation update.
