# Cutover and rollback checklist

## Before cutover

- [ ] Verify the private dependency commit and lockfile integrity.
- [ ] Review `pnpm audit`, tests, production builds, and privacy scan.
- [ ] Confirm the approved Supabase project ID is `abnfffkmxqixrwzackjf`.
- [ ] Confirm Tracker tables remain read-only and RLS is active.
- [ ] Validate Google Calendar using only the approved account and scopes.
- [ ] Verify no candidate, client, contact, referee, transcript, or tracker data is used in test fixtures.
- [ ] Test one synthetic after-call case through human review.

## Cutover

- [ ] Build the console from the exact reviewed Git commit.
- [ ] Deploy the console and gateway to the M1 one-port runtime.
- [ ] Restart `com.jastudioconsulting.recruiting-workbench`.
- [ ] Confirm `/healthz`, Supabase session persistence, live data, and source gates.
- [ ] Confirm the deployed asset hash matches the reviewed build.

## Rollback

- [ ] Restore the previous reviewed M1 runtime bundle and console build.
- [ ] Restart the launch agent and confirm `/healthz`.
- [ ] Remove changed host secrets or OAuth redirect origins if necessary.
- [ ] Do not alter existing recruiter processes, Gmail, Loxo, Tracker, or original Workbench data.
- [ ] Record what was tested and the reason for rollback without retaining candidate data.
