# Recruiting Workbench

Private recruiting console and one-port gateway for Ja Studio Consulting. The M1 LaunchAgent serves `main` at `f4f3349027ebe7b9d9e3a44b198825ae2a0a3e4c` on `http://100.121.104.40:8092/`. Health and asset identity were verified; authenticated save/reload and full device acceptance remain open.

## Current release state

- `/healthz` returned OK; served `index.html`, manifest and icon byte-match the build.
- Supabase project `abnfffkmxqixrwzackjf` has migrations `008`–`011` and `020`–`022` applied and ledger-confirmed. Migration `030` is explicitly deferred and not applied.
- Database view counts were read successfully. Authenticated save/reload, full page acceptance, physical iPad/Pencil behavior and live rollback remain unverified. Prior runtime backup and isolated source/build restore were verified; no live rollback was performed.
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
