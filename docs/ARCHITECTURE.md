# Architecture

The Workbench is split so the browser console does not own privileged
integration credentials.

```text
Browser
  └─ React console + Express gateway :8092
       ├─ Supabase Auth: email magic link
       ├─ Supabase read: Tracker jobs and candidates
       ├─ Supabase write: review actions, drafts, profile, outreach log,
       │    leads, meeting drafts (owner-only RLS)
       ├─ Google Calendar: approved read-only connection
       ├─ Gmail: draft creation and reply detection only, when the
       │    existing connection already grants that scope
       ├─ Anthropic (gateway only): fit check and outreach personalization
       ├─ Meetings: browser capture to Workbench native transcription
       └─ Resume/write-up: source-grounded drafts only
```

The M1 launch agent serves the built console and same-origin gateway together.
The Tailscale address is private network access, not a public deployment.

The gateway invokes the Workbench-owned `native/bin/workbench-transcribe`
helper. Its local model files live under `native/support`. The helper is built
from `packages/workbench-transcription-native`; no separate transcription app
or nested source repository is part of the runtime.

Supabase project `abnfffkmxqixrwzackjf` is the only approved project for this
app. Browser code uses the publishable key; privileged keys are never committed.
RLS keeps Tracker imports read-only while allowing approved review and draft
writes.

`@jastudioconsulting/recruitment-skills` is an external dependency pinned to an immutable Git commit. The gateway loads its exported authority API; it never reaches into `node_modules`, a relative skills directory, or a copied skill tree.

The MCP discovery surface is deliberately small: `$recruiter` is the only authority/tool that routes recruiting capabilities. `workspace_status` is read-only. The stateless Streamable HTTP endpoint creates a fresh server and transport per request. Send, submit, Loxo write, approvals, deletes, Neo4j writes, and standalone internal capabilities are absent.

Synthetic fixtures remain test-only. The production console does not replace a
failed live query with fixture records.

Adzuna is a future manual connector, not a background data source. Its frozen
workflow and activation gates are in
[`ADZUNA-MARKET-CANDIDATE.md`](ADZUNA-MARKET-CANDIDATE.md).

## Pages

Home, Candidates, Candidate Review, Pipeline, Leads, Jobs, Meetings and Mail
are the work areas. Process, Settings and Profile are supporting pages. Each
page reads live Supabase or gateway data and shows honest loading, empty and
error states.

## Queued Loxo changes

The app never writes to Loxo. Rejections, pipeline stage moves and logged
activity are queued in `candidate_review_actions` with status
`waiting_for_loxo`, and the UI says "Waiting for Loxo".

## AI in the gateway

`apps/gateway/src/ai-routes.js` serves `/api/ai/status`, `/api/fit/evaluate`
and `/api/outreach/personalize` with the official `@anthropic-ai/sdk`. The key
is read from `ANTHROPIC_API_KEY` in the M1 runtime environment and the model
from `ANTHROPIC_MODEL` (default `claude-sonnet-5-5`). Without a key the routes
report "not set up" and the console keeps the rules-based fit level. AI output
is levels with cited reasons, never numbers, and never sends anything.

## Resumes without a resume file

`getResumeSource` builds a branded resume from the resume on file when there is
one, otherwise from profile fields already in the record (title, work history,
summary, skills, call notes, transcript). It invents nothing. With none of
those, it says "Not enough data to build a resume". Profile-built resumes carry
an internal-only badge that never appears in the PDF.

## Tables added in this release

Additive migrations in `apps/gateway/migrations/`:

- `003_workbench_profile_and_outreach_log.sql`: `workbench_profile`, `outreach_log`
- `004_leads.sql`: `leads` (Ja's own business development list)
- `005_meeting_drafts.sql`: `meeting_drafts`

All use owner-only RLS for authenticated users. Third-party code and ideas
are recorded in [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md).
