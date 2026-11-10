# Recruiting Workbench

Private recruiting console and one-port gateway for Ja Studio Consulting. The source now includes the merged M2–M6 candidate workflow, search, Notes/Boards, iPad support and meeting-retention changes. The live M1 service remains on an older build; source presence does not establish live availability or persistence.

## Current release state

- The M1 checkout and service on port `8092` remain at older revision `1eb2099`. Changes merged after that build are not confirmed live.
- Migrations `008`–`011`, `020`–`022` and `030` are present in source and unapplied. Candidate edits and presentations, full-text search, Notes/Boards persistence and database transcript retention require their separate migration and deployment gates.
- The older M1 release was previously verified for its deployed workflows, including Tracker-backed reads, review actions and drafts. This documentation update does not revalidate those workflows.
- Candidate facts must come from source records. Missing resume, transcript or notes stay explicit and are never invented.
- Loxo changes are queued as "Waiting for Loxo". Email actions are draft-only.
- AI runs only in the gateway and requires `ANTHROPIC_API_KEY`; without it, rules-based fit levels remain available.
- Adzuna is not active. Its approved future workflow is documented in [`docs/ADZUNA-MARKET-CANDIDATE.md`](docs/ADZUNA-MARKET-CANDIDATE.md).

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for system boundaries and [`docs/READINESS.md`](docs/READINESS.md) for release evidence and gates.

## Packages

- `apps/console` - React/Vite review console.
- `apps/gateway` - Express/Vercel gateway with disabled-by-default integrations.
- `packages/shared-types` - Zod request, output, safety, discovery and error contracts.
- `packages/workbench-transcription-native` - Workbench-owned macOS transcription helper.

## Safe local verification

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm audit --prod
```

The ChatGPT Sites build uses the same console and pinned Recruiter authority:

```sh
pnpm build:site
pnpm test:site
```

The Site exposes the Recruiter as the sole recruiting front door. Google Workspace and durable case data remain unavailable until their hosted connection is configured. The recruitment authority is an external private package pinned to a verified Git commit; it is not copied into this repository.

## One-port local runtime

Build the console, then serve the console and gateway together on `http://127.0.0.1:8092`:

```sh
pnpm --prefix apps/console build
pnpm start:local
```

Meeting transcription normally requires the authenticated Workbench session. On a controlled local Mac, `LOCAL_TRUSTED_MODE=1 pnpm start:local` bypasses login for the transcription endpoint only, and only for loopback, private-network or Tailscale client addresses. The default listener remains loopback-only. Set `HOST=0.0.0.0` only when private-network or Tailscale access is intended.

Build the internal macOS helper with `packages/workbench-transcription-native/scripts/build-release.sh` and deploy `workbench-transcribe` under the runtime's `native/bin/` directory. Meeting transcription does not require another app.

See `docs/` for authentication, deployment status, rollback, integrations and UI boundaries.
