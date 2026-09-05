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

See `docs/` for the current architecture, authentication, readiness, cutover,
host-compatibility, private-package, and UI boundaries.
