# Cutover and rollback checklist

## Before cutover

- [ ] Verify the private dependency commit and lockfile integrity.
- [ ] Review `pnpm audit`, tests, production builds, and privacy scan.
- [ ] Configure hosted PostgreSQL and run Better Auth migration under a separate approval.
- [ ] Configure exact production and preview origins.
- [ ] Validate Google OAuth in a non-production account; Gmail remains draft-only.
- [ ] Verify no candidate, client, contact, referee, transcript, or tracker data is used in test fixtures.
- [ ] Test one synthetic after-call case through human review.

## Cutover

- [ ] Deploy console and gateway as separate projects.
- [ ] Confirm `/healthz`, authentication failure behavior, MCP discovery, and draft-only controls.
- [ ] Repoint no existing AI host or workflow until its compatibility check is approved.

## Rollback

- [ ] Disable or roll back the two new Vercel projects.
- [ ] Remove their host secrets and OAuth redirect origins if necessary.
- [ ] Do not alter existing recruiter processes, Gmail, Loxo, Tracker, or original Workbench data.
- [ ] Record what was tested and the reason for rollback without retaining candidate data.
