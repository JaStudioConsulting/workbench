# Deployment readiness

## Live M1 deployment

- Host: MacBook Air M1 launch agent; local URL `http://localhost:8092/`.
- The M1 checkout and service remain on older revision `1eb2099`. This document describes newer merged source separately and does not claim it is deployed.
- Private Tailscale access; this is not a public deployment.
- Authentication: Supabase email magic link. Approved project: `abnfffkmxqixrwzackjf`.
- Tracker source tables remain read-only; existing review actions and drafts use RLS.
- The earlier M1 release had verified one-port serving, live Tracker reads, candidate decisions and drafts, resume builds, rules-based fit and the listed work areas. This docs draft does not revalidate them against the live service.

## Merged source, awaiting release gates

The source includes candidate editing, presentation tracking, full-text search, Notes/Boards, iPad responsive/touch changes and updated meeting-retention behavior. These do not establish production availability or durable persistence.

Migrations `008`–`011`, `020`–`022` and `030` are present in `apps/gateway/migrations/` but unapplied. Their tables, RLS policies, search RPC and cron job have not been verified in the deployed project. Until migration and deployment are separately reviewed, newer routes may be unavailable or fail against the old schema. The iPad assets likewise require deployment; the Home Screen shortcut does not store recruiting data offline.

## Not active or still gated

- Adzuna search and candidate marketing. See [`ADZUNA-MARKET-CANDIDATE.md`](ADZUNA-MARKET-CANDIDATE.md).
- Automatic outreach or automatic Leads creation. Email is always a draft.
- AI fit check and AI outreach personalization until `ANTHROPIC_API_KEY` is configured in the runtime.
- Gmail draft saving and reply detection unless the existing Google connection already grants those scopes. No new scopes are requested.
- Native system-audio capture and speaker labels until the rebuilt helper is installed and `WORKBENCH_NATIVE_MEETING_ENHANCEMENTS=1` is set. Mic-only stays the fallback.
- Supabase transcript expiry and scheduled cleanup until migration `030` is applied and verified. Browser/native cleanup also needs verification on the target runtime; see [`RETENTION.md`](RETENTION.md).
- Public internet hosting.

## Release verification still required

- Review and apply the intended migrations through the separate database gate; verify schema, RLS, search and retention behavior.
- Deploy the reviewed source build independently of the docs PR.
- Reopen the live M1 service and verify each shipped workflow and durable read-after-write behavior against the approved project.
- Verify iPad access against the deployed build.

No deployment, migration, runtime restart or live-data write was performed for this documentation draft.
