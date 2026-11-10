# Architecture

The Workbench is split so the browser console does not own privileged integration credentials. M1 serves `main` at `f4f3349027ebe7b9d9e3a44b198825ae2a0a3e4c` on `http://100.121.104.40:8092/`. `/healthz` and served asset identity were verified; authenticated save/reload, full page acceptance and physical iPad/Pencil behavior remain unverified.

```text
Browser
  └─ React console + Express gateway :8092
       ├─ Supabase Auth: email magic link
       ├─ Supabase read: Tracker jobs and candidates
       ├─ Supabase write: review actions, drafts, profile, outreach log,
       │    leads, meeting drafts (owner-only RLS)
       ├─ Candidate edit overlays and presentations (migrations 008–011)
       ├─ Full-text search (migrations 010, 021)
       ├─ Notes and Boards (migrations 020, 022)
       ├─ Meeting transcript retention (migration 030)
       ├─ Google Calendar: approved read-only connection
       ├─ Gmail: draft creation and reply detection only, when the
       │    existing connection already grants that scope
       ├─ Anthropic (gateway only): fit check and outreach personalization
       ├─ Meetings: browser capture to Workbench native transcription
       └─ Resume/write-up: source-grounded drafts only
```

The M1 launch agent serves the built console and same-origin gateway together. The Tailscale address is private network access, not a public deployment. The gateway invokes the Workbench-owned `native/bin/workbench-transcribe` helper; local model files live under `native/support`. The helper is built from `packages/workbench-transcription-native`; no separate transcription app or nested source repository is part of the runtime.

Supabase project `abnfffkmxqixrwzackjf` is the approved project for this app. Browser code uses the publishable key; privileged keys are never committed. RLS keeps Tracker imports read-only while allowing approved review and draft writes.

`@jastudioconsulting/recruitment-skills` is an external dependency pinned to an immutable Git commit. The gateway loads its exported authority API and does not reach into a relative skills directory or copied skill tree. MCP discovery exposes `$recruiter` as the only authority/tool that routes recruiting capabilities; `workspace_status` is read-only. The stateless Streamable HTTP endpoint creates a fresh server and transport per request. Send, submit, Loxo write, approvals, deletes and standalone internal capabilities are absent.

Synthetic fixtures remain test-only. The production console does not replace a failed live query with fixture records. Adzuna is a future manual connector, not a background data source; see [`ADZUNA-MARKET-CANDIDATE.md`](ADZUNA-MARKET-CANDIDATE.md).

## Pages and source changes

Home, Candidates, Candidate Review, Pipeline, Leads, Jobs, Meetings and Mail are work areas; Process, Settings and Profile are supporting pages. The deployed build includes candidate-edit overlays, presentation tracking, global search, a Notes directory/editor, Boards, responsive/touch iPad support and meeting audio/transcript retention behavior. Migrations `008`–`011` and `020`–`022` are applied and ledger-confirmed in the approved project; database view counts were read. Migration `030` is explicitly deferred and not applied. Authenticated save/reload, full page and physical iPad/Pencil acceptance remain unverified.

## Queued Loxo changes

The app does not write directly to Loxo. Rejections, pipeline stage moves and logged activity are queued in `candidate_review_actions` with status `waiting_for_loxo`, and the UI says "Waiting for Loxo".

## AI in the gateway

`apps/gateway/src/ai-routes.js` serves `/api/ai/status`, `/api/fit/evaluate` and `/api/outreach/personalize` with the official `@anthropic-ai/sdk`. The key is read from `ANTHROPIC_API_KEY` in the runtime environment and the model from `ANTHROPIC_MODEL` (default `claude-sonnet-5-5`). Without a key the routes report "not set up" and the console keeps rules-based fit levels. AI output uses levels with cited reasons, never numbers, and never sends anything.

## Resumes without a resume file

`getResumeSource` uses the resume on file or existing profile fields (title, work history, summary, skills, call notes, transcript). It invents nothing. With none of those, it says "Not enough data to build a resume". Profile-built resumes carry an internal-only badge that never appears in the PDF.

## Migrations and retention

Existing migrations `003`–`005` add profile/outreach, leads and meeting drafts. Migrations `008`–`011` and `020`–`022` are applied and ledger-confirmed in project `abnfffkmxqixrwzackjf`; database view counts were read. Migration `030` (transcript expiry and scheduled cleanup) is explicitly deferred and not applied. These checks do not verify authenticated writes or retention behavior. [`RETENTION.md`](RETENTION.md) records intended behavior and verification gates. Third-party code and ideas are recorded in [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md).
