# Agent start: Recruiting Workbench

Use this on the M1 that hosts Workbench. Read the repository `AGENTS.md` first. The live task record is the [AgentsMCP Workbench board](https://agentsmcp.ai/board/work), especially forum D7 and the task cards labelled `workbench`. D7 contains Ja's build rules; each card states its dependency and acceptance criterion. Follow the full build plan when it is available in `docs/BUILD-PLAN.md`. Do not fill gaps in a missing plan from memory.

## Find the checkout

The M1 checkout is `~/Projects/RecruitingApp/workbench`. From another machine, use `ssh m1`; run repository commands on M1. Before work:

```sh
cd ~/Projects/RecruitingApp/workbench
git status --short --branch
git rev-parse --short HEAD
```

The starting baseline for this build was `main` at `1eb2099`. Verify the current commit and board state; both can change. Preserve ignored local transcription models, the native binary, skills, and the running service on port `8092`. Do not clean or reclone this checkout.

If setting up a **new** M1 workspace where the repository is absent, clone the verified remote into the intended workspace. Do not run this in the existing checkout:

```sh
git clone https://github.com/JaStudioConsulting/workbench.git ~/Projects/RecruitingApp/workbench
cd ~/Projects/RecruitingApp/workbench
```

## Install and verify

Use Node.js 20 or newer and pnpm `10.33.0` (the versions declared in `package.json`). Ensure both commands are on `PATH` in a noninteractive SSH shell. In a new isolated checkout:

```sh
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm check
```

`pnpm check` runs the privacy scan, type checks, tests, console build, and site build/test. The live checkout can fail the privacy scan on ignored local skills, models, and binaries. Do not remove those files to make the scan pass. Run final checks in a clean branch worktree with dependencies installed there, and report both the live checkout and clean worktree results. Keep credentials outside Git.

For a local development server in an isolated worktree:

```sh
pnpm dev
```

For a one-port local run, build the console first and choose a port other than the live `8092`:

```sh
pnpm --prefix apps/console build
PORT=8093 HOST=127.0.0.1 pnpm start:local
```

Do not restart, replace, or deploy the live `:8092` service without Ja's approval. See `README.md`, `docs/ARCHITECTURE.md`, `docs/READINESS.md`, and `docs/CUTOVER-ROLLBACK.md` for current behavior and release checks; verify claims against live behavior.

## Task and data rules

- One dependency-ready board task per branch and PR. Work from the current reviewed base. Run `pnpm check` on M1, add the PR link to the board, and move the task to review. The orchestrator reviews milestone gates. Never write directly to `main` or merge without Ja's GO.
- Supabase project `abnfffkmxqixrwzackjf` is the live data project. Inspect schema and RLS before migrations. Tracker imports remain read-only; Ja's edits must survive imports.
- Never write to Loxo. Queue actions as `waiting_for_loxo`. Email stays draft-only; send nothing. Do not invent candidate, job, client, metric, or activity data.
- Google and Calendar may be intentionally unlinked. Follow the Google project lock in `AGENTS.md` before any Google operation. Do not add a paid AI key, Notion, or Neo4j.
- The app must work with AI off. Recording has no additional consent step per Ja's D7 decision. Retention: delete audio after the transcript is saved; retain native capture files for 7 days and transcripts for 1 year. Verify implementation before marking that behavior done.
- Copy code only from MIT, Apache-2.0, or BSD JavaScript/TypeScript sources; record each source in `docs/THIRD-PARTY-NOTICES.md`. Keep UI free of purple and default Canada-only filters on everywhere.
