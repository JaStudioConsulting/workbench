# Migration checkpoint

The clean Workbench migration is implemented but is not deployed or cut over.

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
