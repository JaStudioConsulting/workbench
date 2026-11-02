# Recruiting Workbench

Private recruiting console and one-port gateway for Ja Studio Consulting. The
deployed M1 runtime reads Tracker data from Supabase and writes review actions
and drafts through Supabase RLS. Credentials and service-role keys stay outside
the repository.

## Current status

- `main` is the source of truth.
- The private M1 deployment is served on port `8092`.
- Supabase provides authenticated jobs, candidates, submissions, review actions,
  and draft storage. Tracker source tables remain read-only.
- Candidate facts must come from source records. Missing resume, transcript, or
  notes stay visibly missing and are never invented.
- Adzuna is not active. Its approved future workflow is documented in
  [`docs/ADZUNA-MARKET-CANDIDATE.md`](docs/ADZUNA-MARKET-CANDIDATE.md).

## Packages

- `apps/console` - React/Vite review console.
- `apps/gateway` - Express/Vercel gateway with disabled-by-default integrations.
- `packages/shared-types` - Zod request, output, safety, discovery, and error contracts.
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

The Site exposes the Recruiter as the sole recruiting front door. Google Workspace and durable case data remain unavailable until their hosted connection is configured.

The recruitment authority is an external private package pinned to a verified Git commit. It is not copied into this repository.

## One-port local runtime

Build the console, then serve the console and gateway together on `http://127.0.0.1:8092`:

```sh
pnpm --prefix apps/console build
pnpm start:local
```

Meeting transcription normally requires the authenticated Workbench session. On a controlled local Mac, `LOCAL_TRUSTED_MODE=1 pnpm start:local` bypasses login for the transcription endpoint only, and only for loopback, private-network, or Tailscale client addresses. The default listener remains loopback-only. Set `HOST=0.0.0.0` only when private-network or Tailscale access is intended.

Build the internal macOS helper with:

```sh
packages/workbench-transcription-native/scripts/build-release.sh
```

Deploy the resulting `workbench-transcribe` binary under the Workbench runtime's
`native/bin/` directory. Meeting transcription does not require another app.

See `docs/` for the current architecture, authentication, deployment status,
rollback steps, integrations, and UI boundaries.
