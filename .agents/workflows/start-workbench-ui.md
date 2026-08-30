# Start Workbench UI

## Description

Start the approved frontend-only Workbench design cycle with the correct repository context, visual references, and review gate.

## Steps

1. Read `AGENTS.md`, `docs/ANTIGRAVITY-UI-HANDOFF.md`, `README.md`, and `docs/CHECKPOINT.md` completely.
2. Confirm this workspace is `/Users/TTTG/JA/Workbench`, the branch is based on current `main`, and the checkout does not come from a temporary preview folder.
3. Inspect the existing console. Query Graphify for existing components, routes, styling, and reusable work before creating replacements; verify its answers against the checked-out files.
4. Study both images in `docs/ui-references/`. Treat them as mood, layout, and colour references only.
5. Produce a concise page map for Home, Mail, Candidates, Leads, Process, Staff, Profile, and Settings using the distinct purposes in the handoff.
6. Implement a frontend-only interactive proposal on a new feature branch. Make every page clickable and meaningfully different. Add a safe Arrange layout mode with moving, resizing, collision prevention, reset, and per-page saved layout.
7. Use honest empty states and real labels. Do not invent candidates, leads, staff, messages, integrations, activity, or metrics.
8. Use the Shadcn MCP for accessible component patterns. Before initializing Shadcn or changing frontend dependencies, explain the exact change and keep it limited to the console.
9. Run the relevant frontend checks, open the browser preview, and test desktop plus narrow widths.
10. Stop and show Ja the visual result. Do not merge, deploy, change backend code, or add real integrations without Ja's approval.
