# Architecture

The Workbench is split so the browser console does not own privileged
integration credentials.

```text
Browser
  └─ React console + Express gateway :8092
       ├─ Supabase Auth: email magic link
       ├─ Supabase read: Tracker jobs and candidates
       ├─ Supabase write: review actions and drafts
       ├─ Google Calendar: approved read-only connection
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
