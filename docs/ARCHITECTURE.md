# Architecture

The Workbench is split so the console does not own recruitment logic or integration credentials.

```text
React console ──HTTPS──> Express gateway / Vercel API
                              ├─ Better Auth + hosted PostgreSQL (optional, fail closed)
                              ├─ external recruitment authority package (router only)
                              ├─ Gmail draft abstraction (no send API)
                              ├─ Neo4j read adapter (optional, no write API)
                              └─ durable case storage interface (not configured here)
```

`@jastudioconsulting/recruitment-skills` is an external dependency pinned to an immutable Git commit. The gateway loads its exported authority API; it never reaches into `node_modules`, a relative skills directory, or a copied skill tree.

The MCP discovery surface is deliberately small: `$recruiter` is the only authority/tool that routes recruiting capabilities. `workspace_status` is read-only. The stateless Streamable HTTP endpoint creates a fresh server and transport per request. Send, submit, Loxo write, approvals, deletes, Neo4j writes, and standalone internal capabilities are absent.

No production case data is retained by this repository. `createMemoryTestStorage()` exists only for tests; any production flow that asks for storage must reject until a durable hosted adapter is supplied.
