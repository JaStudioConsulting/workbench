# Host compatibility

| Host | Expected integration | Compatibility gate |
| --- | --- | --- |
| Codex | local/hosted MCP client | Confirm visible `recruiter` tool and no standalone capability exposure. |
| OpenCode | MCP client | Confirm private Git dependency is installable by its runtime identity. |
| Hermes | MCP client through approved gateway | Confirm its policy adapter preserves draft-only and human-review gates. |
| Claude | remote MCP/Git integration | Confirm GitHub App access to the private dependency and HTTPS gateway. |
| Generic MCP client | Streamable HTTP or configured transport | Confirm authentication, exact origin, and discovery results before enabling. |

Compatibility is not implied by installation. Each host must be tested with synthetic content only and must discover `$recruiter` as the sole recruiting front door.
