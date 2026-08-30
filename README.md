# Recruiting Workbench

Clean, privacy-first recruiting console and gateway. It has no local runtime persistence, no live recruitment writes, and no credentials in the repository.

## Current status

Verified 2026-08-29:

- `main` is the only active source-of-truth branch.
- The rejected `today-ui` and fixed synthetic-preview experiments are preserved only as dated archive tags; they are not approved product UI.
- New UI work starts from `main`. Do not restore hard-coded metrics, fake operational records, or generic recruiting dashboards.
- The recruiting authority is pinned to `JaStudioConsulting/recruitment-skills` commit `9e9a116c2ae3f56b9aef1abff8476698da793fbb`.

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

The recruitment authority is an external private package pinned to a verified Git commit. It is not copied into this repository.

See `docs/` for architecture, configuration, deployment, cutover, and host-compatibility boundaries.
