# Cutover and rollback runbook

This is a preparation and execution record for a future M1 release. Reading it, building an isolated release candidate, and running `pnpm check` do not authorize a database migration, service restart, deployment, or live-data test. Execute the cutover only after Ja gives an explicit GO for the named source SHA, migration set, and release window. Migration `030` requires its own separate GO.

## Current verified state (2026-11-10)

- Source reviewed: `main` at `94ac14705e3e1fc286947d4649c8dac9eef86b68`.
- M1 checkout: `~/Projects/RecruitingApp/workbench`, `1eb209975f9291afb7a1e4590aeebe64affdd5f2`, clean `main`, 146 commits behind `origin/main` at the time checked.
- LaunchAgent `com.jastudioconsulting.recruiting-workbench` is loaded. `GET http://127.0.0.1:8092/healthz` returned `{"ok":true,"service":"recruiting-workbench-gateway"}`.
- Supabase project `abnfffkmxqixrwzackjf` reported `ACTIVE_HEALTHY`. Its migration ledger contains the existing migrations through `20261107104806` (`meeting_transcription_metadata`); none of release migrations 008–011, 020–022, or 030 were listed.
- This preparation PR's isolated M1 worktree installed the frozen lockfile from the offline cache and `pnpm check` passed (exit 0). Repeat the check at the exact reviewed release SHA after merge; this result does not establish live acceptance.
- These are status checks only. No login, candidate/job read, migration, write, restart, or deployed asset comparison was performed. `/healthz` proves process health only.

## Gate 0: authorize a named release

Before touching production, record all of the following in the release ticket/board and get Ja's explicit GO:

| Required decision/evidence | Record |
|---|---|
| Reviewed PR merged to `main`; exact full Git SHA | Pending |
| `pnpm check` result on M1 at that SHA, with command output and exit code | Pending |
| Release operator, date/time window, and Ja's GO reference | Pending |
| Confirmed backup destination, retention, encryption, and restore operator | Pending |
| Approved migration set: 008–011 and 020–022 only, or explicit deferral | Pending |
| Separate decision for 030 retention migration | **Not authorized** |
| Expected app behavior if a database migration fails partway | Pending |

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

## Gate 2: migration review and ordering

The release migration set is intentionally split:

| Order | File | Scope | Gate |
|---:|---|---|---|
| 1 | `008_candidate_edits.sql` | Candidate edit overlay | Ja GO for release migration set |
| 2 | `009_candidates_manual.sql` | Manual candidates | Ja GO for release migration set |
| 3 | `010_candidates_all.sql` | Combined candidate view | Ja GO for release migration set |
| 4 | `011_presentations.sql` | Presentation history | Ja GO for release migration set |
| 5 | `020_notes_boards.sql` | Notes and boards | Ja GO for release migration set |
| 6 | `021_fulltext_search.sql` | Search documents/function | Ja GO for release migration set |
| 7 | `022_notes_origin_key.sql` | Notes origin key | Ja GO for release migration set |
| separate | `030_meeting_retention.sql` | Transcript expiry trigger and scheduled cleanup | **Separate Ja GO required; exclude from this cutover** |

Before any apply action, review the exact SQL and dependencies, compare live schema/RLS to the approved reference, and capture a read-only migration-list snapshot. The expected release list is exactly the seven files above; if 030 appears, stop. If any other migration appears, stop and reconcile. This repository stores migrations under `apps/gateway/migrations/` with numeric prefixes, while the live ledger uses timestamp versions. Therefore do not assume a default `supabase db push` or `supabase migration list` in this checkout represents these files: confirm and document the release's migration runner and its exact version mapping first. Do not run a broad push; apply only individually reviewed migration contents in numeric order through the approved runner, capture its full output, verify remote schema/history after each migration, and stop on the first error. Never repair migration history to make a cutover appear successful.

After migrations 008–011 and 020–022 are approved and applied, verify schema objects, owner-only RLS and unchanged read-only Tracker permissions using read-only queries and an authenticated Ja session. Verify `search_workbench` behavior against a synthetic fixture only in an isolated environment. Do not create or modify live candidate, job, client, note, board, presentation, or transcript records as a smoke test. The retention schedule, trigger, first run, and file cleanup are not accepted by migrations 008–022; they remain unverified until the distinct 030 gate and M6 retention acceptance.

## Gate 3: cutover (future; requires Ja GO)

Do not run these steps until Gates 0–2 are complete and Ja has approved the precise source SHA and migration set. Keep the former deployment available for immediate restore. The release must use the same gateway port `8092`, same approved project, and current private-network exposure. Do not change the launch-agent identity, secrets, OAuth origins, Google linkage, or Tracker permissions as part of this release.

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
| Exact reviewed source SHA | Matches Ja-approved full SHA | Source reviewed at `94ac14705e3e1fc286947d4649c8dac9eef86b68`; no release GO |
| M1 `pnpm check` | Pass on isolated M1 worktree at the exact reviewed release SHA | Prep PR worktree: pass, exit 0; release SHA: pending |
| Source/build/asset manifests | Checksummed and archived; matches runtime after release | Pending |
| Previous bundle + database backup | Encrypted, checksummed; isolated restore proven | Pending |
| 008–011 and 020–022 migration preview | Exactly these seven, in order | Not run against live project; not authorized |
| 030 retention preview and apply | Separate Ja GO; schedule/trigger/first run verified | Not authorized; not accepted |
| `/healthz` | Expected service response after restart | Baseline read-only response OK; post-cutover not run |
| Authentication and session reload | Approved Ja account works; session persists | Not tested |
| Live page/read-after-write acceptance | Read-only page walk; no synthetic live writes | Not tested |
| Rollback | Previous release restored and checks pass | Not tested |

**Current decision: no cutover and no rollback acceptance.** Ja's release GO, M1 offline check at the eventual approved release SHA, artifact/restore evidence, post-deploy health/auth/page checks, and rollback proof remain outstanding. This preparation does not complete M6-05 and must not be marked done.
