# Recruiting Workbench

Clean, privacy-first recruiting console and gateway. It has no local runtime persistence, no live recruitment writes, and no credentials in the repository.

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

## Synthetic sandbox

```sh
pnpm dev:sandbox
```

This opens a fixed fake case with no uploads, persistence, login, or live integrations. The click-through sandbox uses the same source-grounding and draft-output function as the gateway, then stops at human review.

The recruitment authority is an external private package pinned to a verified Git commit. It is not copied into this repository.

See `docs/` for architecture, configuration, deployment, cutover, and host-compatibility boundaries.
