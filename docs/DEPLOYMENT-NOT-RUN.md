# Production deployment plan - not run

A static synthetic-only sandbox preview was deployed for click testing. It is separate from the production plan below: it accepts no inputs, has no persistence or credentials, and connects to no gateway or live integration.

Create two independent Vercel projects after a separate approval:

| Project | Root directory | Build command | Runtime entrypoint |
| --- | --- | --- | --- |
| Console | `apps/console` | `pnpm build` | Vite static output |
| Gateway | `apps/gateway` | `pnpm build` | `api/index.js` |

Set environment variables in the host's encrypted settings only. The console receives only `VITE_GATEWAY_URL`; secrets remain gateway-only. Configure exact CORS/trusted origins before login. Do not configure Gmail scopes beyond draft creation, Neo4j write permissions, local hosts, or local persistence.

Because each Vercel project uses a subdirectory root in a pnpm monorepo, configure the project install/build setting so the workspace root is available to the build. The deployment identity also needs approved read-only access to the private Git dependency. The gateway rewrite sends public paths to `api/index.js`; it does not use external-root `includeFiles` configuration.

Deployment, domain changes, credentials, data migration, and client cutover are deliberately not run by this repository.
