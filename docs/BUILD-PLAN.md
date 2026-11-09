# Workbench Build Plan

Owner: Ja. Repo: `JaStudioConsulting/workbench`. Base commit: `1eb2099` (main, Nov 8 2026).
Runs on the M1 at port 8092. Supabase project `abnfffkmxqixrwzackjf` is the only database.

This plan is for the whole app, not one feature. It finishes what is there, patches the gaps, and snaps in ready-made open-source parts.

---

## 1. Finish line

The app is "finished" when all of these are true:

1. Every page works on live data, with no sample or fake records shown to Ja.
2. Ja can type a role ("program manager") and see every candidate, lead, job and client that fits, plus who was already presented and to which client.
3. Ja can add and edit candidates inside the app. Tracker imports never overwrite his edits.
4. Each candidate, job and call has a Notes page (Novel) and a Board (Excalidraw), saved in Supabase.
5. It opens like an app on iPad and on the computer.
6. Open items 1 to 3 from the handoff are closed.
7. `pnpm check` passes, and Ja uses it for one full week without opening Loxo to look someone up.

AI models come later. Every AI spot stays off until a model is set, and the app works fully without it.

---

## 2. What is there now (review of main @ 1eb2099)

Built and working (per repo docs and Codex's report, not re-tested by hand):
- Front end: React 19 + Vite + Tailwind + shadcn parts in `apps/console`. Pages: Home, Candidates, Candidate Review, Pipeline, Leads, Jobs (map), Meetings, Mail, Process, Settings, Profile.
- Back end: Express gateway in `apps/gateway`, one port with the console. Auth by Supabase magic link.
- Data: Supabase tables in use: `tracker_jobs`, `candidate_review_feed`, `candidate_review_actions`, `review_drafts`, `leads`, `meeting_drafts`, `outreach_log`, `workbench_profile`. Migrations 001 to 007 in `apps/gateway/migrations`.
- Recorder: browser capture plus the native macOS helper (`packages/workbench-transcription-native`, from the Muesli fork).
- Pieces already taken from Open Recruiter (miao4ai fork): pipeline board, outreach draft flow, fit specialists, reply check.
- Recruiter skills: `@jastudioconsulting/recruitment-skills`, pinned, served through `$recruiter` on the gateway MCP.
- Design skills (installed locally from `skills-lock.json`): better-accessibility, better-interface, better-layout, better-writing, interface-review, state-machine, variant, break, design-taste-frontend.
- Tests: about 40 test files across console, gateway and shared types.

Gaps found in the review:
- G1. Sample data leaks: `candidateReviewService.js` shows `SAMPLE_JOBS` and `SAMPLE_CANDIDATES` when live jobs come back empty. This breaks the "never invent records" rule in AGENTS.md.
- G2. Neo4j leftovers: `apps/gateway/src/neo4j.js` is still wired into `app.js`. Ja dropped Neo4j.
- G3. Stale MCP status: `workspace_status` in `apps/gateway/src/mcp.js` says "Durable storage is unavailable". That is no longer true.
- G4. No way to add or edit a candidate. Tracker tables are read-only and there is no edit layer.
- G5. No search across everything ("what do I have for program managers?").
- G6. Submissions saved in the app only live as `candidate_review_actions` rows plus an in-memory map. There is no single "presented to client" view.
- G7. No Notes page and no Board.
- G8. No iPad / home-screen app setup (no manifest).
- G9. The schema for the Tracker import tables is not in the repo migrations. Agents cannot see it.
- G10. Open item 1: Pipeline starts with "Canada only" OFF (`PipelinePage.jsx` line 89). Candidate Review and Settings start ON.
- G11. Open item 2: `PeopleView.jsx` candidate row is a clickable div with no keyboard use. Search, Location and Client inputs have no labels.
- G12. Open item 3: no retention rule for recordings, native capture files or transcripts. `meetingRetention.js` swallows cleanup errors.
- G13. Stub files `PageStubs.jsx` and `HomeWidgets.jsx` are leftovers.

---

## 3. The crew

**Orchestrator (one agent, strongest model available).**
- Owns this plan and the task board.
- Splits work, sets the order, unblocks builders.
- Reviews at each milestone gate, not every step.
- Merges to main only after Ja says "go" for that milestone.
- Never builds features itself unless a builder is stuck.

**Builders (up to 6 at once, any AI: Claude, Codex, Gemini, anyone).**
- Pull one open task at a time from the board.
- One task = one branch = one PR.
- Run `pnpm check` before marking a task done.
- Talk in caveman on the board (cavecrew). Code and code comments stay normal.

**Ja.**
- Gives "go" per milestone.
- Answers the questions in section 9.
- Owns UI direction. Builders do not invent new screens beyond this plan.

---

## 4. Task board (agentsmcp)

Every task lives on the agentsmcp board so any AI can see what is done, open, running or blocked.

Each task has:

| Field | Meaning |
|---|---|
| id | Like `M2-03` |
| title | Short, plain |
| lane | Data, Back end, Front end, Snap-in, Search, Mobile, Cleanup, Tests, Ops |
| status | open, claimed, running, review, done, blocked |
| depends_on | Task ids that must be done first |
| files | Main files it touches |
| done_when | The test for "done" |
| claimed_by | Which AI took it |
| notes | Caveman notes, links to PR |

Board rules:
1. Claim before you start. Never work a task someone else claimed.
2. Only take a task when every `depends_on` task is done.
3. Tasks in different lanes with no shared files can run at the same time.
4. Move to `review` when the PR is open and `pnpm check` passes. The orchestrator moves it to `done` at the gate.
5. If stuck for more than one try, mark `blocked` with one line on why.

---

## 5. Hard rules (do not break)

- Builds and tests run on the M1 only. Never on the M5 MacBook Air.
- No direct writes to `main`. PRs only. Merge only after Ja's milestone "go".
- Never restart :8092 without Ja's OK.
- Never write to Loxo. Loxo changes queue as `waiting_for_loxo`.
- Email is draft only. Nothing sends.
- No consent step on call recording. On purpose.
- Google and calendar stay unlinked. The 401 and 503 errors are expected.
- No paid AI key. AI features stay off until a model is set.
- No Notion. No Neo4j. No second database. Supabase only.
- Never invent candidates, jobs, metrics or activity. Missing data shows as missing.
- Only copy code under MIT, Apache-2.0 or BSD. Same language as Workbench (JS/TS) gets copied. Other languages: copy the table design or idea only.
- Record every copied source in `docs/THIRD-PARTY-NOTICES.md` with repo, commit and license.
- No purple anywhere in the UI.
- Canada-only candidates is the default everywhere.
- Follow AGENTS.md and the Google project lock in it.

---

## 6. Lanes

| Lane | Covers | Skills to use |
|---|---|---|
| Data | Supabase tables, migrations, views, RLS | Supabase MCP (read-only first) |
| Back end | Gateway routes, MCP status, contracts in `packages/shared-types` | none special |
| Front end | Pages, components, states | better-interface, better-layout, better-accessibility, interface-review |
| Snap-in | Novel, Excalidraw | license check first |
| Search | Ask-my-book search and matching | state-machine |
| Mobile | iPad / home-screen app | better-layout |
| Cleanup | Dead code, sample data, stubs | break |
| Tests | Unit, contract, page tests | none special |
| Ops | M1 build, deploy, rollback | follow docs/CUTOVER-ROLLBACK.md |

---

## 7. Milestones and tasks

Each milestone ends at a gate. At the gate the orchestrator reviews all PRs, runs `pnpm check` on the M1, and asks Ja for "go".

### M0. Ground truth (do first, all read-only)

| id | lane | title | depends_on | done_when |
|---|---|---|---|---|
| M0-01 | Data | Dump the live Supabase schema (all tables, views, RLS) into `docs/SCHEMA.md` | none | Every table the app reads is listed with columns |
| M0-02 | Data | Add the Tracker import tables to the repo as a reference migration file (not applied) | M0-01 | File exists, matches live schema |
| M0-03 | Tests | Run `pnpm check` on M1 at `1eb2099`, record result on board | none | Pass/fail logged |
| M0-04 | Ops | Write `docs/AGENT-START.md`: how to clone, install, run, test on M1, where the board is | none | A new AI can start from it alone |

Gate M0: orchestrator confirms schema and baseline. No Ja "go" needed (nothing changes).

### M1. Clean up and fix (parallel, small)

| id | lane | title | depends_on | done_when |
|---|---|---|---|---|
| M1-01 | Front end | Pipeline "Canada only" starts ON, reads the same saved setting as Settings | M0-03 | Pipeline, Candidate Review and Settings all start ON; test added |
| M1-02 | Front end | PeopleView: candidate row is a real button or link, keyboard works; aria-labels on Search, Location, Client | M0-03 | Tab + Enter opens a candidate; labels present; test added |
| M1-03 | Cleanup | Remove sample-data fallback from live paths; show an honest empty state | M0-03 | No SAMPLE_ import reachable outside tests; test added |
| M1-04 | Cleanup | Remove Neo4j adapter and its status field | M0-03 | No neo4j in app code; gateway tests pass |
| M1-05 | Back end | Fix `workspace_status` text to match real state | M0-03 | Text matches; test updated |
| M1-06 | Cleanup | Remove `PageStubs.jsx` and `HomeWidgets.jsx` if unused, keep any safety test contract | M0-03 | Files gone or justified; tests pass |
| M1-07 | Back end | Stop swallowing cleanup errors in `meetingRetention.js`; log them visibly | M0-03 | Error shows in log and UI note |

Gate M1: Ja "go" to merge and deploy.

### M2. Data you can edit and trust

| id | lane | title | depends_on | done_when |
|---|---|---|---|---|
| M2-01 | Data | New table `candidate_edits`: Ja's changes on top of Tracker rows (owner-only RLS). Tracker rows stay read-only | M0-02 | Migration 008 added and tested |
| M2-02 | Data | New table `candidates_manual`: candidates Ja adds by hand | M0-02 | Migration 009 added and tested |
| M2-03 | Data | View `candidates_all`: Tracker rows + edits + manual adds, edits always win | M2-01, M2-02 | A Tracker re-import never undoes an edit (test) |
| M2-04 | Data | View `presentations`: who was presented to which client, when, for which job (from submissions + `candidate_review_actions`) | M0-02 | One row per presentation; matches Tracker submissions |
| M2-05 | Back end | Gateway routes + Zod contracts for add, edit and read candidates | M2-03 | Contract tests pass |
| M2-06 | Front end | Add / edit candidate form on the candidate card and in Candidates page | M2-05 | Ja can add and edit; change survives reload |
| M2-07 | Front end | "Presented" badge and client list on every candidate card | M2-04 | Badge shows on cards in all views |
| M2-08 | Front end | Remove the in-memory submissions map; read from `presentations` | M2-04 | Submissions survive reload |

Gate M2: Ja "go" to apply migrations 008+ to live Supabase and deploy.

### M3. Ask my book (search and match)

| id | lane | title | depends_on | done_when |
|---|---|---|---|---|
| M3-01 | Data | Postgres full-text search over candidates, leads, jobs, clients, notes (no AI) | M2-03 | "program manager" returns matching rows fast |
| M3-02 | Back end | `/api/search` route with Zod contract | M3-01 | Contract test passes |
| M3-03 | Search | Rules-based match: candidate to open jobs by title, location (Canada), level. Reuse `fitScore.js` levels, no numbers | M2-03 | Each match shows a level and the reasons |
| M3-04 | Front end | Search bar in the header (also Cmd+K, using existing `cmdk`) with grouped results: Candidates, Leads, Jobs, Clients | M3-02 | Typing a role shows all four groups |
| M3-05 | Front end | Result row shows: presented or not, to which client, and best job matches | M3-03, M2-07 | Ja can see who to reach out to |
| M3-06 | Tests | Page test for search with seeded test data only | M3-04 | Test passes, no fake data in prod |

Gate M3: Ja "go".

### M4. Notes and Board (snap-ins)

| id | lane | title | depends_on | done_when |
|---|---|---|---|---|
| M4-01 | Snap-in | License check: Novel (Apache-2.0, confirmed), Tiptap core, Excalidraw. Record in THIRD-PARTY-NOTICES | M0-03 | All MIT/Apache/BSD, or flagged |
| M4-02 | Snap-in | Check Novel and Excalidraw run with React 19 + Vite 6 + Tailwind 4 in a throwaway branch | M4-01 | Both render, build passes |
| M4-03 | Data | Table `notes` (body as JSON, linked to candidate, job, meeting, or none) and `boards` (Excalidraw scene JSON), owner-only RLS | M0-02 | Migrations added and tested |
| M4-04 | Back end | Routes + contracts for notes and boards | M4-03 | Contract tests pass |
| M4-05 | Front end | Notes tab on candidate, job and meeting screens using Novel; autosave | M4-02, M4-04 | Type, reload, still there |
| M4-06 | Front end | Board tab using Excalidraw; autosave | M4-02, M4-04 | Draw, reload, still there |
| M4-07 | Back end | After a call, the transcript and after-call notes drop onto that candidate's Notes page | M4-05 | No typing needed by Ja |
| M4-08 | Front end | Notes page in the sidebar: all notes, newest first, searchable (feeds M3 search) | M4-05, M3-01 | Notes show in Ask my book results |
| M4-09 | Front end | Match Novel and Excalidraw look to Workbench style (no purple) | M4-05, M4-06 | interface-review passes |

Gate M4: Ja "go".

### M5. iPad and computer

| id | lane | title | depends_on | done_when |
|---|---|---|---|---|
| M5-01 | Mobile | Web app manifest + icons so "Add to Home Screen" opens full screen | M1 done | Opens like an app on iPad |
| M5-02 | Mobile | Touch pass on every page: tap sizes, sidebar as sheet, no hover-only actions | M5-01 | better-layout review passes on iPad size |
| M5-03 | Mobile | Apple Pencil works on the Board | M4-06 | Draw with Pencil on iPad |
| M5-04 | Ops | Short guide: open on iPad over Tailscale, add to home screen | M5-01 | Ja can follow it alone |

Gate M5: Ja "go".

### M6. Harden and ship

| id | lane | title | depends_on | done_when |
|---|---|---|---|---|
| M6-01 | Back end | Retention rule for recordings, native capture files and transcripts (waits on Ja's answer, section 9) | Ja answer | Old files cleaned on schedule; errors visible |
| M6-02 | Tests | Full page walk on live data, every page, empty/loading/error states | M5 done | Checklist done on board |
| M6-03 | Front end | Accessibility pass across all pages | M5 done | better-accessibility review passes |
| M6-04 | Ops | Update README, ARCHITECTURE, READINESS to match the finished app | M6-02 | Docs match the app |
| M6-05 | Ops | Deploy to M1 with Ja's OK; rollback steps tested | M6-04 | Live, rollback proven |

Gate M6: Ja signs off the finish line in section 1.

### Later (not needed to finish)

- Turn on local AI (Gemma on the M1) for: notes from bullets + transcript, smarter matching, "ask my notes" in plain words. Novel's AI slot and the gateway AI routes are the hook points.
- Adzuna (already planned in docs).

---

## 8. What can run at the same time

- M0: all four tasks in parallel.
- M1: all seven tasks in parallel (different files).
- M2: M2-01, M2-02, M2-04 in parallel. Then M2-03. Then back end, then front end.
- M3 and M4 can overlap: M4-01 to M4-04 can start once M2 data tasks are done.
- M5-01 and M5-02 can start right after M1.

---

## 9. Questions for Ja

1. agentsmcp board: what is the URL or how do builders reach it? If it can't hold tasks, the fallback is `docs/TASKS.md` in the repo plus GitHub Issues, one per task.
2. Retention (open item 3). Suggested: audio deleted once the transcript is saved (already the case), native capture files deleted after 7 days, transcripts kept 1 year. Yes, or your numbers?
3. Which model is the orchestrator? Suggested: Opus as orchestrator, builders any mix of Claude Sonnet and Codex (Terra, Luna).
