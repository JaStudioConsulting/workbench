# Recruiting Workbench

Clean, privacy-first recruiting console and gateway. It has no local runtime persistence, no live recruitment writes, and no credentials in the repository.

## Current status

- `main` is the only active source-of-truth branch.
- The rejected `today-ui` and fixed synthetic-preview experiments are preserved only as dated archive tags; they are not approved product UI.
- New UI work starts from `main`. Do not restore hard-coded metrics, fake operational records, or generic recruiting dashboards.
- The recruiting authority is pinned to `JaStudioConsulting/recruitment-skills` commit `bbf1bbfdc91bbdd9409c976bd5782a0fc87db0b0`.

## Packages

- `apps/console` - React/Vite review console.
- `apps/gateway` - Express/Vercel gateway with disabled-by-default integrations.
- `packages/shared-types` - Zod request, output, safety, discovery, and error contracts.

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

See `docs/` for the current architecture, authentication, readiness, cutover,
host-compatibility, private-package, and UI boundaries.
