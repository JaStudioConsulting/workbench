# Deployment readiness

## Live M1 deployment

- Host: MacBook Air M1 launch agent; private URL `http://100.121.104.40:8092/`.
- Served source: `main` at `f4f3349027ebe7b9d9e3a44b198825ae2a0a3e4c`.
- `/healthz` returned OK; served `index.html`, manifest and icon byte-match the build.
- Private Tailscale access; this is not a public deployment.
- Authentication: Supabase email magic link. Approved project: `abnfffkmxqixrwzackjf`.
- Tracker source tables remain read-only; existing review actions and drafts use RLS.
- Migrations `008`–`011` and `020`–`022` are applied and ledger-confirmed in approved project `abnfffkmxqixrwzackjf`; database view counts were read successfully.
- Authenticated save/reload, full page acceptance, physical iPad/Pencil behavior and live rollback remain unverified. Prior runtime backup and isolated source/build restore were verified; no live rollback was performed.

## Merged source, awaiting release gates

The source includes candidate editing, presentation tracking, full-text search, Notes/Boards, iPad responsive/touch changes and updated meeting-retention behavior. These do not establish production availability or durable persistence.

Migrations `008`–`011` and `020`–`022` are applied and ledger-confirmed; migration `030` is explicitly deferred and not applied. Database view counts were read, but authenticated save/reload and end-to-end behavior remain unverified. Deployed asset identity is verified; physical iPad/Pencil behavior remains unverified. The Home Screen shortcut does not store recruiting data offline.

## Not active or still gated

- Adzuna search and candidate marketing. See [`ADZUNA-MARKET-CANDIDATE.md`](ADZUNA-MARKET-CANDIDATE.md).
- Automatic outreach or automatic Leads creation. Email is always a draft.
- AI fit check and AI outreach personalization until `ANTHROPIC_API_KEY` is configured in the runtime.
- Gmail draft saving and reply detection unless the existing Google connection already grants those scopes. No new scopes are requested.
- Native system-audio capture and speaker labels until the rebuilt helper is installed and `WORKBENCH_NATIVE_MEETING_ENHANCEMENTS=1` is set. Mic-only stays the fallback.
- Supabase transcript expiry and scheduled cleanup: migration `030` is deferred and not applied. Browser/native cleanup also needs verification on the target runtime; see [`RETENTION.md`](RETENTION.md).
- Public internet hosting.

## Acceptance still required

- Verify authenticated save/reload and full page behavior against the approved project.
- Verify physical iPad and Pencil behavior against the deployed build.
- Keep migration `030` deferred unless separately authorized; retention scheduling and cleanup remain unaccepted.

No deployment, migration, runtime restart or live-data write was performed for this documentation update.
