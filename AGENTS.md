# Repository Instructions

## Nylas development

For all Nylas-related work:

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
