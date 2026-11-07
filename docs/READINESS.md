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
- Branded resumes build from the resume on file, or from existing profile
  fields when there is no resume. With neither, the card says "Not enough
  data to build a resume".
- Rules-based fit levels, Canada filter, reject with reason, outreach drafts
  (copy, mail link, Gmail draft), Pipeline board moves, Home queues, Leads,
  Mail follow-ups, Process counts, Settings status and Profile signature.
- Meetings: recruiter templates, Markdown and PDF export, and candidate notes
  through the after-call workflow.
- The full repository check passes before release.

## Not active

- Adzuna search and candidate marketing. See
  [`ADZUNA-MARKET-CANDIDATE.md`](ADZUNA-MARKET-CANDIDATE.md).
- Automatic outreach or automatic Leads creation. Email is always a draft.
- AI fit check and AI outreach personalization until `ANTHROPIC_API_KEY` is set
  in the M1 runtime environment.
- Gmail draft saving and reply detection unless the existing Google connection
  already grants those scopes. No new scopes are requested.
- Native system-audio capture and speaker labels until the rebuilt helper is
  installed and `WORKBENCH_NATIVE_MEETING_ENHANCEMENTS=1` is set. The mic-only
  path stays the fallback.
- Public internet hosting. The current URL is private-network only.
