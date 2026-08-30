# Repository Instructions

## Source of truth and codebase knowledge

1. Treat the current `main` branch and its tests as the source of truth.
2. Use Graphify at `https://api.graphify.com/mcp` for codebase knowledge, code relationships, and prior implementation lookup when it is available.
3. Keep Graphify useful across development and production branch history so earlier code, including rejected code, can be found before new code is written.
4. Graphify is a knowledge aid, not permission to trust stale output. Verify every recommendation against the current Git commit and tests.
5. Search for and reuse existing code before creating a replacement. Do not recreate features merely because an AI session lacks context.

## UI and product direction

1. Ja owns UI and frontend direction. Do not invent dashboard metrics, candidate records, activity, integrations, or product states.
2. Use `google/skills` as the official know-how source for Google Drive, Docs, Sheets, Gmail, and Calendar workflows. Use the relevant skill rather than guessing Google behavior.
3. Ja may use Nylas products, screens, or documentation to describe a desired workflow or layout. Treat that as a reference unless he explicitly requests a Nylas integration.
4. Do not merge or restore archived synthetic UI wholesale. Reuse only a specifically approved interaction or component idea.

## Nylas development

These rules apply only when Nylas is actually being integrated:

1. Use Nylas v3 only. Never use deprecated v2 patterns such as `access_token` and `client_secret`; v3 uses `api_key` and `grant_id`.
2. Use the official [Nylas coding-agent guide](https://developer.nylas.com/docs/v3/getting-started/coding-agents/) as the primary reference.
3. Start documentation lookup with the official [Nylas llms.txt](https://developer.nylas.com/llms.txt). Fetch specific documentation pages as Markdown when useful.
4. Use the official Nylas SDK whenever the repository's language is supported. This repository uses Node.js, so prefer the official Node.js SDK.
5. Consult the official Nylas v3 [OpenAPI specification](https://developer.nylas.com/openapi.json) when exact endpoints, parameters, request bodies, response schemas, or types are needed.
6. Do not recreate functionality already available in the Nylas SDK.
7. Do not build custom HTTP wrappers unless the supported SDK genuinely lacks the required feature. If raw HTTP is necessary, document the SDK gap.
8. Keep Nylas integration code thin, reusable, server-side, and easy to maintain.
9. Prefer official Nylas examples and documented patterns over large custom implementations written from scratch.
10. Never hardcode, commit, log, or expose Nylas API keys. Store secrets in environment variables, and never make authenticated Nylas API calls from client-side code.
11. Follow current official guidance for regional API URIs, pagination, webhook-driven updates, grant lifecycle, and error handling.
