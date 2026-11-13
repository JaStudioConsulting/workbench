# Operator approval desk

The desk stores recruiter review work in owner-scoped Supabase cases. Home holds daily review and manual Loxo completion; Meetings saves after-call packages; candidate marketing stores MPC research. The Tracker import panel supports explicit CSV/XLSX and Google Sheets preview/confirmation.

## Safety and data handling

- Import previews are saved before confirmation. Confirmation requires explicit row choices and uses caller-scoped Supabase access; Google Sheets remains read-only.
- Candidate identity is tied to stable source IDs. Same-name candidates are never merged.
- Each case binds its canonical sources, artifacts and exact action snapshot. Artifact revisions are appended as human drafts; prior approvals and dependent actions are withdrawn when a new version supersedes them.
- The Loxo control records only the user's explicit report that they entered the reviewed snapshot in Loxo. The app does not call Loxo or imply a verified sync.
- Email and candidate submission remain drafts. The app does not send, submit, or write Tracker data through an approved action.
- After-call outputs require a configured model and source validation. They remain drafts for recruiter review; JD text cannot be used as career evidence. Editing the branded resume checks source references, rechecks the selected candidate, and renders a new PDF draft.

## Release state

- Reviewed source commit: `ac4134bb853d5589bb28544b42638e2e6c7047e6` on `feat/operator-approval-desk`; draft PR [#59](https://github.com/JaStudioConsulting/workbench/pull/59).
- The feature flag `VITE_OPERATOR_CASES_ENABLED` remains off by default in the tested build.
- M1 now serves reviewed commit `ac4134bb853d5589bb28544b42638e2e6c7047e6` from the isolated `workbench-release-50ec7f1` worktree. The HTTPS shell, JS, CSS, and module-preload assets byte-match that worktree's build. `/healthz` is 200 JSON; unknown API routes return JSON 404; unauthenticated meeting/after-call routes return JSON 401. Native meeting enhancements remain enabled (`WORKBENCH_NATIVE_MEETING_ENHANCEMENTS=1`); the pinned PDF interpreter is configured.
- The candidate worktree's `native` link reuses the prior helper/model and recordings. Rollback plist backup is `com.jastudioconsulting.recruiting-workbench.plist.backup-ac4134b` in the user's LaunchAgents directory; it restores the previous `f4f3349` launch configuration. The launch agent runs in the active GUI domain on this M1 account.
- Supabase project `abnfffkmxqixrwzackjf` reports these operator/import migrations applied:

  - `20261113112336` `tracker_imports_024`
  - `20261113112548` `tracker_import_privileges_025`
  - `20261113114616` `lead_identifiers_026`
  - `20261113114750` `operator_cases_023`
  - `20261113115144` `operator_case_history_privileges_027`
  - `20261113122846` `operator_case_mpc_daily_prerequisites` (028)
  - `20261113130559` `operator_case_artifact_supersession_029`
  - `20261113131926` `save_operator_artifact_revision_031`

- Migration `030` remains deferred and is not applied. The code cutover is installed; no new reviews are enabled.

## Remaining release acceptance

- The Supabase email provider is enabled and Supabase Google provider is disabled. The candidate login uses an existing-account email link with user creation disabled; the private HTTPS redirect allowlist and actual email delivery have not been verified. No OTP was sent. Existing Better Auth Google Workspace cookies do not substitute for a Supabase user session.
- The current M1 launch configuration has no Google OAuth client settings or Anthropic API key. Google Sheets and AI-assisted drafting therefore remain unavailable until their existing configurations are recovered. Startup and other unavailable states remain explicit.
- A synthetic M1 PDF was rendered and all six pages inspected; a separate reviewer also inspected a seven-page synthetic PDF. Both used synthetic data. No real candidate data was rendered. The candidate gateway was smoke-checked without authentication or writes.
- Full repository checks passed on the reviewed source: privacy, workspace typecheck, tests, production build and Sites build/tests. Browser sign-in, authenticated save/reload, actual Sheets import, and physical iPad/Pencil behavior remain unverified.
