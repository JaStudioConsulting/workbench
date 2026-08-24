# Migration checkpoint

The clean Workbench migration is implemented but is not deployed or cut over.

## Synthetic sandbox

The console includes a fixed synthetic-only test mode. It accepts no uploads or free-form candidate data, stores nothing, calls no live integration, and stops after showing source-grounded draft outputs for human review. `pnpm dev:sandbox` runs it locally; the root Vercel configuration builds only this static sandbox preview. This does not deploy or enable the production gateway.

Vercel project `workbench-synthetic-sandbox` now hosts a Vercel-authenticated static preview at `https://workbench-synthetic-sandbox-pk2y81mv3-jas-projects-dbe01bda.vercel.app`. Verified preview deployment `dpl_2Mx9pDRBVDtKfishwTuAvvNW8hUf` returned HTTP 200 through authenticated access and completed the source-audit-to-four-drafts click flow. No environment secrets or live service connections were supplied.

Vercel automatically assigned the project's first synthetic static deployment a production alias even though preview was requested. That artifact contains the same fixed fake-only sandbox and no live connections. The verified URL above is the later unaliased preview deployment; production Workbench console and gateway cutover remain unrun.

## Verified dependency boundary

`@jastudioconsulting/recruitment-skills` is pinned to `github:JaStudioConsulting/recruitment-skills#0f8e929f28c94098f3f992ab33eb7ba901dd9527`. The package is loaded through public exports, validated for every published manifest asset, and is never copied into this repository.

## Current security posture

- Separate console and gateway deployments use an exact HTTPS CORS allowlist with credentials.
- Better Auth fails closed unless hosted PostgreSQL, an exact base origin, a 32-character secret, exact trusted origins, and Google configuration are present.
- `$recruiter` is the only recruiting MCP tool. `workspace_status` is the only additional read-only tool.
- Every after-call claim value and evidence snippet must occur in its declared resume, transcript, or call-notes source after whitespace and case normalization. Outputs are draft-only and require human review.
- The repository privacy validator rejects symlinks, credential configuration, copied skills, package-lock files, and unexpected binary or data assets.
- Neo4j is disabled without an initialized read-only driver. No write surface is exposed.

## Remaining cutover blockers

- Provision and approve hosted PostgreSQL plus Better Auth schema migration.
- Configure Vercel project settings, encrypted environment values, and exact production origins.
- Validate Google OAuth and gateway session behavior with a non-production account.
- Verify each MCP host with synthetic data only before enabling it.
- Add an approved durable case-storage adapter. Case creation remains disabled until then.
