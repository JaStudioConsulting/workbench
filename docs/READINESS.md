# Deployment readiness

## Live deployment

- Host: MacBook Air M1 launch agent.
- Local URL: `http://localhost:8092/`.
- Private Tailscale URL: `http://100.121.104.40:8092/`.
- Health endpoint: `/healthz`.
- Authentication: Supabase email magic link.
- Data project: Supabase `abnfffkmxqixrwzackjf`.
- Source tables: read-only Tracker imports.
- Writable records: candidate review actions and drafts under RLS.

## Proven

- The console and gateway are served on one port.
- Live Tracker jobs and linked candidates load from Supabase.
- Candidate decisions, activity drafts, and write-up drafts persist.
- Missing source resumes block resume generation instead of inventing content.
- The full repository check passes before release.

## Not active

- Adzuna search and candidate marketing. See
  [`ADZUNA-MARKET-CANDIDATE.md`](ADZUNA-MARKET-CANDIDATE.md).
- Automatic outreach or automatic Leads creation.
- Public internet hosting. The current URL is private-network only.
