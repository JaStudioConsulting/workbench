# Migration report

## Selectively migrated UI direction

The source Workbench's safe design ideas were reimplemented as a minimal React console: dual-rail navigation, intake/review/draft structure, review-gated after-call flow, and clear empty states. The old source branding, account wording, hardcoded local endpoints, browser persistence, and operational control surface were not migrated.

## Source files reviewed but not copied

- `src/shell/AppShell.jsx` and `src/shell/HomeView.jsx` - interaction hierarchy only; no source code copied.
- `src/styles.css` and shell CSS - broad visual structure only; replaced with a self-contained Veridian Glass theme.
- `src/App.jsx` - after-call sequence only; unsafe client data and local/network integrations omitted.
- `gateway/recruitingAuthority.js` - package-based authority boundary superseded.

## Intentionally omitted categories

- PocketBase runtime, schemas, migrations, and JSON/local storage.
- local Google bridge, OAuth helper scripts, Gmail mutation routes, and n8n imports.
- deployment shell scripts, fixed network names/hosts, logs, snapshot data, and design proofs.
- all copied `skills/` content, package-lock files, Neo4j setup/writes, Loxo writes, submissions, and live data.

## Correction-pass controls

The console now uses the Better Auth React client with gateway-or-same-origin configuration, while retaining no browser persistence. The gateway now has exact credentialed CORS, session gates for all non-public routes, a stateless MCP endpoint, and source-backed after-call drafts. See `CHECKPOINT.md` for the pinned package commit and remaining cutover blockers.
