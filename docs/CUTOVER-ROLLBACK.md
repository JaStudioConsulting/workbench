# Cutover and rollback runbook

This runbook records the M1 cutover and the acceptance still open. It does not authorize any further migration, service restart, deployment, or live-data write. Migration `030` was explicitly deferred and is not applied; it requires separate authorization.

## Current verified state (2026-11-10)

- Deployed source: `main` at `f4f3349027ebe7b9d9e3a44b198825ae2a0a3e4c`.
- M1 LaunchAgent serves `http://100.121.104.40:8092/`; `/healthz` returned OK. Served `index.html`, manifest and icon byte-match the build.
- Supabase project `abnfffkmxqixrwzackjf` has migrations `008`–`011` and `020`–`022` applied and ledger-confirmed. Migration `030` is explicitly deferred and not applied. Database view counts were read successfully.
- Prior M1 runtime backup artifacts and an isolated source/build restore were verified. No Supabase database backup or isolated database restore proof was obtained for this cutover; no live rollback was performed.
- Authenticated save/reload, full page acceptance and physical iPad/Pencil behavior remain unverified. Health and asset identity do not establish workflow acceptance.

## Gate 0: authorize a future named release

Before touching production, record all of the following in the release ticket/board and get Ja's explicit GO:

| Required decision/evidence | Record |
|---|---|
| Deployed release SHA | `f4f3349027ebe7b9d9e3a44b198825ae2a0a3e4c` |
| Applied migration set | 008–011 and 020–022, ledger-confirmed |
| Migration 030 | Explicitly deferred; not applied |
| Prior M1 runtime backup artifacts and isolated source/build restore | Verified |
| Supabase database backup and isolated database restore proof | Not obtained for this cutover |
| Authenticated save/reload, full page, physical iPad/Pencil | Unverified |
| Live rollback | Unverified |

Abort if the release SHA differs from the approved SHA, the checkout is dirty, the M1 service state has changed unexpectedly, the backup cannot be verified, the migration plan contains an unapproved version, or the M1 auth/health baseline is not understood. Do not use `supabase db push` for this release: it applies every pending local migration and can include 030.

## Gate 1: prepare and prove a release bundle

Run build/check work in an isolated M1 worktree; do not update the live checkout to build. The following uses a checkout of the reviewed branch after its PR has merged. Replace `<FULL_SHA>` with the approved 40-character SHA and keep the release directory outside the repository.

```sh
cd ~/Projects/RecruitingApp/workbench
git fetch origin main
git worktree add --detach ../workbench-release-<FULL_SHA> <FULL_SHA>
cd ../workbench-release-<FULL_SHA>
test "$(git rev-parse HEAD)" = "<FULL_SHA>"
test -z "$(git status --porcelain)"
node --version
pnpm --version
pnpm install --frozen-lockfile --offline
pnpm check
```

Record the complete check output and exit status. If offline install cannot resolve the frozen lockfile from M1's cache, stop and report that; do not fall back to network install or alter the live checkout. A passing check is source evidence, not live acceptance.

Create a deterministic inventory for the built console. Replace the example path with the approved, access-controlled evidence directory outside the checkout:

```sh
WORKBENCH_RELEASE_EVIDENCE=/approved/private/path/workbench-release-<FULL_SHA>
mkdir -p "$WORKBENCH_RELEASE_EVIDENCE"
cd apps/console/dist
find . -type f -print0 | sort -z | xargs -0 shasum -a 256 > "$WORKBENCH_RELEASE_EVIDENCE/console-assets.sha256"
shasum -a 256 "$WORKBENCH_RELEASE_EVIDENCE/console-assets.sha256" > "$WORKBENCH_RELEASE_EVIDENCE/console-assets.sha256.sha256"
```

The bundle manifest must include: full source SHA; `pnpm-lock.yaml` SHA-256; `pnpm check` result; all relative asset paths and SHA-256 values; gateway package/version; migration file paths and SHA-256 values; and the bundle archive SHA-256. Compare the generated icon/logo hashes against `scripts/privacy-check.mjs`. Never put `.env`, tokens, OAuth credentials, candidate material, `node_modules`, transcription models, logs, or cache data in a source release bundle.

Before cutover, prepare recoverable artifacts in access-controlled storage. Example commands for the previous source and current built console (run from the live checkout, only after Ja has authorized the backup operation):

```sh
cd ~/Projects/RecruitingApp/workbench
WORKBENCH_RELEASE_EVIDENCE=/approved/private/path/workbench-release-<FULL_SHA>
git status --short --branch
git rev-parse HEAD
git bundle create "$WORKBENCH_RELEASE_EVIDENCE/previous-source.bundle" HEAD
git bundle verify "$WORKBENCH_RELEASE_EVIDENCE/previous-source.bundle"
tar -czf "$WORKBENCH_RELEASE_EVIDENCE/previous-console-dist.tar.gz" -C apps/console dist
shasum -a 256 "$WORKBENCH_RELEASE_EVIDENCE/previous-source.bundle" "$WORKBENCH_RELEASE_EVIDENCE/previous-console-dist.tar.gz"
```

Encrypt and checksum the copied bundle before it leaves the M1. The example only captures tracked Git history and the built console directory; it does not capture the LaunchAgent, ignored native binaries/models, logs, credentials, or database. Preserve the exact active LaunchAgent and native helper through the approved secure backup procedure, without printing plist environment values or secret-bearing configuration.

1. **Previous runtime bundle:** capture the exact currently deployed source/build plus its SHA-256 manifest, launch-agent plist, and the current native helper version. Preserve the existing ignored runtime data separately; do not delete or replace it. Encrypt the archive before moving it off the M1, and verify its archive checksum after copy.
2. **Database backup:** use the approved Supabase backup/export mechanism for project `abnfffkmxqixrwzackjf`, with a timestamp and project ref in the evidence record. Store it encrypted outside Git. Record the provider's backup identifier or dump checksum, completion time, and retention. Restore it only to an isolated disposable project/branch under a separately approved restore check; capture schema/table counts and RLS-policy comparison without copying candidate values into logs or reports. A backup file without a successful isolated restore proof is not a proven rollback.

If the backup destination, encryption method, or isolated restore target is not already approved and usable, stop here. Do not invent credentials or print connection strings. A service restart cannot roll back database DDL.

## Migration record and ordering

The release migration set is intentionally split:

| Order | File | Scope | Status |
|---:|---|---|---|
| 1 | `008_candidate_edits.sql` | Candidate edit overlay | Applied; ledger-confirmed |
| 2 | `009_candidates_manual.sql` | Manual candidates | Applied; ledger-confirmed |
| 3 | `010_candidates_all.sql` | Combined candidate view | Applied; ledger-confirmed |
| 4 | `011_presentations.sql` | Presentation history | Applied; ledger-confirmed |
| 5 | `020_notes_boards.sql` | Notes and boards | Applied; ledger-confirmed |
| 6 | `021_fulltext_search.sql` | Search documents/function | Applied; ledger-confirmed |
| 7 | `022_notes_origin_key.sql` | Notes origin key | Applied; ledger-confirmed |
| separate | `030_meeting_retention.sql` | Transcript expiry trigger and scheduled cleanup | Explicitly deferred; not applied |

Before any apply action, review the exact SQL and dependencies, compare live schema/RLS to the approved reference, and capture a read-only migration-list snapshot. The expected release list is exactly the seven files above; if 030 appears, stop. If any other migration appears, stop and reconcile. This repository stores migrations under `apps/gateway/migrations/` with numeric prefixes, while the live ledger uses timestamp versions. Therefore do not assume a default `supabase db push` or `supabase migration list` in this checkout represents these files: confirm and document the release's migration runner and its exact version mapping first. Do not run a broad push; apply only individually reviewed migration contents in numeric order through the approved runner, capture its full output, verify remote schema/history after each migration, and stop on the first error. Never repair migration history to make a cutover appear successful.

After migrations 008–011 and 020–022 are approved and applied, verify schema objects, owner-only RLS and unchanged read-only Tracker permissions using read-only queries and an authenticated Ja session. Verify `search_workbench` behavior against a synthetic fixture only in an isolated environment. Do not create or modify live candidate, job, client, note, board, presentation, or transcript records as a smoke test. The retention schedule, trigger, first run, and file cleanup are not accepted by migrations 008–022; they remain unverified until the distinct 030 gate and M6 retention acceptance.

## Acceptance after cutover

The cutover and asset identity are verified. Complete authenticated save/reload and the full page walk; verify physical iPad/Pencil behavior on the deployed build. Keep migration `030` deferred unless separately authorized. The prior runtime backup and isolated restore do not constitute a live rollback test.

Before stopping the service, capture:

```sh
cd ~/Projects/RecruitingApp/workbench
git rev-parse HEAD
git status --short --branch
curl -fsS http://127.0.0.1:8092/healthz
```

Perform the approved staged-bundle activation procedure recorded in the release ticket, then restart `com.jastudioconsulting.recruiting-workbench` only under the approved GO. Do not run `git pull` in the live checkout. Immediately check:

```sh
launchctl list | grep com.jastudioconsulting.recruiting-workbench
curl -fsS http://127.0.0.1:8092/healthz
```

Verify the running deployment's asset hashes against the approved `console-assets.sha256` manifest (including each listed file, not only the manifest file). In the private browser, sign in as the approved Ja account, confirm auth/session persistence after reload, and walk every released page through expected empty/loading/error states. Use only existing read-only live data; do not create a smoke-test record. Record outcomes and sanitized evidence, never session cookies, tokens, candidate values, transcripts, or secrets. A healthy `/healthz` alone does not establish authentication, data access, RLS, or deployed-source identity.

## Rollback

Trigger rollback on failed health/auth, an unexpected asset hash, source identity mismatch, unexpected migration, Tracker write access, broken read-only workflows, or any evidence of data corruption. Record the trigger and timestamp without copying user data.

1. Stop the new service under the same approved operator procedure.
2. Restore the exact previous runtime bundle and launch-agent configuration captured in Gate 1; preserve current local runtime data and secrets unless a documented, specific correction is required.
3. Restart the launch agent and verify the process is loaded, `/healthz` responds, private sign-in works, and the restored asset hashes match the previous manifest.
4. If any database migration was applied, do **not** attempt ad hoc reverse SQL or restore the whole live database. The schema migration may be additive while post-migration writes exist. Stop writes, preserve evidence, and use the approved database recovery plan with Ja and the database operator. A database restore is a separate destructive operation and requires explicit authorization.
5. Re-run only read-only checks, document actual outcomes, and leave the release blocked until root cause and recovery are reviewed.

## Evidence table and current acceptance

| Evidence | Required result | Status at preparation |
|---|---|---|
| Exact deployed source SHA | Full SHA matches served deployment | `f4f3349027ebe7b9d9e3a44b198825ae2a0a3e4c` |
| `/healthz` | Healthy service response | Verified OK |
| Build assets | Served index, manifest and icon match build | Byte-match verified |
| Migrations 008–011 and 020–022 | Applied and ledger-confirmed | Verified |
| Database view counts | Read successfully | Verified |
| Migration 030 | Separately authorized and accepted | Explicitly deferred; not applied |
| Prior M1 runtime backup artifacts and isolated source/build restore | Runtime/source recovery evidence only | Verified |
| Supabase database backup and isolated database restore proof | Database recovery evidence | Not obtained for this cutover |
| Authentication and save/reload | Approved Ja session persists after reload | Not verified |
| Full page acceptance | Released pages pass expected-state walk | Not verified |
| Physical iPad/Pencil | Deployed build works on target device/input | Not verified |
| Live rollback | Prior release restored and checks pass on M1 | Not verified |

**Current state: cutover and migration ledger are verified; acceptance remains incomplete.** Authenticated save/reload, full page acceptance, physical iPad/Pencil behavior and live rollback remain open. Migration `030` is deferred. M6-05 is not complete and must not be marked done.
