# Recruiting Workbench

Private recruiting console and one-port gateway for Ja Studio Consulting. Workbench runs on Ja's Mac at `http://127.0.0.1:<port>`. The owner has no login; the app silently opens a workspace session through a loopback-only local-session endpoint.

## Current release state

- `/healthz` returned OK; served `index.html`, manifest and icon byte-match the build.
- Supabase project `abnfffkmxqixrwzackjf` has migrations `008`–`011` and `020`–`022` applied and ledger-confirmed. Migration `030` is explicitly deferred and not applied.
- Data stays in hosted Supabase. Local Supabase and Docker are not used. The Supabase CLI is a dev dependency for managing the hosted database from this Mac.
- Candidate facts must come from source records. Missing resume, transcript or notes stay explicit and are never invented.
- Loxo changes are queued as "Waiting for Loxo". Email actions are draft-only. Gmail integration is removed.
- Calendar, Google sign-in, and Google Sheets import by link are off by default (`VITE_GOOGLE_CALENDAR_ENABLED`, `VITE_GOOGLE_WORKSPACE_ENABLED`). CSV/XLSX import works.
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

The Site exposes the Recruiter as the sole recruiting front door. The recruitment authority is an external private package pinned to a verified Git commit; it is not copied into this repository.

## One-port local runtime

Build the console, then serve the console and gateway together on `http://127.0.0.1:8092`:

```sh
pnpm --prefix apps/console build
pnpm start:local
```

The app silently opens a workspace session through `POST /api/auth/local-session`. That endpoint accepts loopback requests only, rejects forwarded or proxy requests, and uses a machine secret file. Tailscale and iPad access are off.

Build the internal macOS helper with `packages/workbench-transcription-native/scripts/build-release.sh` and deploy `workbench-transcribe` under the runtime's `native/bin/` directory. Meeting transcription does not require another app.

See `docs/` for architecture, release notes, integrations and UI boundaries. Some setup documents describe an earlier sign-in based setup and are marked historical.
