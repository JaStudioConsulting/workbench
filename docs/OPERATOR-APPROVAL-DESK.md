# Operator approval desk

## Simple operating model

```text
Google Sheets → Tracker importer not verified in this repository → Supabase → Workbench Home
                                              ↓
                                      approval case
```

- Google Sheets remains the business source.
- Supabase remains the fast operating database used by Workbench.
- The Workbench reads `tracker_*` tables in Supabase, but this repository does not contain or identify the Sheets-to-Supabase importer. Import ownership, mapping, schedule, and last successful run are unverified. Treat that gap as blocking acceptance of the complete source-to-Workbench workflow.
- The Jobs Map can fetch the Jobs tab directly from Google Sheets for display, or fall back to the Supabase `tracker_jobs` snapshot. A direct Sheet response is not imported or persisted by that screen; its source label distinguishes the two paths. No Supabase freshness indicator is available.
- Home is the daily queue and approval desk. There is no new navigation area or separate application.
- The local after-call preparer creates draft artifacts only. It must not be described as a Recruitment MCP execution until a real programmatic adapter exists.
- Approving an exact action manifest records approval only. It does not send email, write to Loxo, change Tracker, or submit a candidate.

## Enablement

The interface is intentionally behind one rollout flag and is off by default in the local build:

```text
VITE_OPERATOR_CASES_ENABLED=1
```

Before setting the flag, apply and verify only `apps/gateway/migrations/023_operator_cases.sql` using the approved individual migration process. Do not run a broad database push and do not activate migration `030`.

With the flag off, existing Home, Candidate Review, Meetings, Mail, Leads, Jobs, Pipeline, and Waiting-for-Loxo behavior remains unchanged.

## Implemented path (locally gated, not live-verified)

This checkout contains a local after-call draft flow and approval UI. The path is partial: the rollout flag is off by default, migration `023` is not verified as applied, there is no real Recruitment MCP programmatic adapter, and authenticated live save/reload has not been tested. Do not describe the full approval desk or source-to-Workbench flow as production-ready.

1. Choose a stable candidate and job in Meetings.
2. Capture or paste the transcript and optional notes.
3. Select **Prepare after-call review**.
4. Workbench saves the four returned drafts to one Supabase case.
5. Open **Approval desk** on Home to inspect sources, edit/approve/reject each output, and separately approve an exact action manifest.

If no transcript exists, Workbench saves a blocked case labelled **Transcript unavailable** and does not call the draft preparer or infer discussion content.

## Deferred

- A real Recruitment MCP programmatic adapter; current after-call artifacts come from the local draft preparer.
- MPC generation/sourcing. The shared case model and UI can display MPC artifacts once that adapter returns them.
- Executing approved Gmail, Loxo, Tracker, or submission actions.
- Live Supabase migration `023`, deployment, authenticated save/reload, and physical iPad/Pencil acceptance.
