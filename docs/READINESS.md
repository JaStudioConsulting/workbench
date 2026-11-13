# Deployment readiness

## Live M1 deployment

- Host: MacBook Air M1 launch agent; private URL `https://jcs-macbook-air.tail8a223f.ts.net/` (Tailscale Serve).
- Previously served source: `f4f3349027ebe7b9d9e3a44b198825ae2a0a3e4c`. Current source: `ac4134bb853d5589bb28544b42638e2e6c7047e6` on `feat/operator-approval-desk`.
- `/healthz` returns 200 JSON; the HTTPS shell and JS, CSS, and module-preload hashes match the candidate build. Unknown API routes return JSON 404; unauthenticated meeting and after-call requests return JSON 401. Release details and rollback location are in [`OPERATOR-APPROVAL-DESK.md`](OPERATOR-APPROVAL-DESK.md).
- Private Tailscale access; this is not a public deployment.
- Authentication: existing Supabase sessions are restored; candidate also offers existing-account email link with signup disabled. Supabase project: `abnfffkmxqixrwzackjf`. Private HTTPS redirect allowlist and actual email delivery remain unverified; no OTP was sent.
- Tracker source tables remain read-only; existing review actions and drafts use RLS.
- Migrations `008`–`011`, `020`–`022`, and operator/import migrations `023`–`029`, `031` are applied and verified in project `abnfffkmxqixrwzackjf`. Migration `030` remains deferred and is not applied.
- Authenticated save/reload, actual Sheets import, real candidate rendering, and physical iPad/Pencil behavior remain unverified. Synthetic PDF and transcription checks passed. The previous launch plist is preserved for rollback; rollback has not been exercised.

## Reviewed source and release gates

The source includes candidate editing, presentation tracking, full-text search, Notes/Boards, iPad responsive/touch changes and updated meeting-retention behavior. These do not establish production availability or durable persistence.

The operator approval desk is reviewed on draft PR #59 and remains behind `VITE_OPERATOR_CASES_ENABLED` (default off). It cannot send email, submit candidates, or write Tracker through an approval action. The Loxo control records only the user's report of manual entry. The Home Screen shortcut does not store recruiting data offline.

## Not active or still gated

- Adzuna search and candidate marketing. See [`ADZUNA-MARKET-CANDIDATE.md`](ADZUNA-MARKET-CANDIDATE.md).
- Automatic outreach or automatic Leads creation. Email is always a draft.
- AI fit check, outreach personalization, and AI-assisted after-call drafting until `ANTHROPIC_API_KEY` is configured in the runtime.
- Gmail draft saving and reply detection unless the existing Google connection already grants those scopes. No new scopes are requested.
- Google Sheets access until the existing Google OAuth configuration is recovered. Native meeting enhancements are enabled on M1; synthetic local transcription passed, while real-call/device acceptance remains open.
- Supabase transcript expiry and scheduled cleanup: migration `030` is deferred and not applied. Browser/native cleanup also needs verification on the target runtime; see [`RETENTION.md`](RETENTION.md).
- Public internet hosting.

## Acceptance still required

- Verify existing-account email-link delivery/redirect and authenticated save/reload against the approved project.
- Verify live Google OAuth/Sheets and model configuration when available.
- Verify physical iPad and Pencil behavior against the deployed build.
- Keep migration `030` deferred unless separately authorized; retention scheduling and cleanup remain unaccepted.

No migration or live-data write was performed for this documentation update.
