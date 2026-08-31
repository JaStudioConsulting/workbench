# Antigravity UI handoff

## What Ja wants

Build the Workbench around the recruiting work Ja actually does. This is a frontend and layout task first. Do not let authentication, storage, integrations, or deployment take over the work.

Use the best qualities of both supplied references:

- Visual direction: clear navigation, quiet spacing, readable work areas, warm ivory, dark forest green, muted sage, restrained clay accents, and an editorial mix of large and small blocks.

The images are visual references, not content specifications. Do not copy their fake metrics, personal-planner language, or financial content.

## Navigation and page purpose

Keep these four primary work areas together near the top:

1. **Home** — what Ja needs to work on now: real next actions, drafts waiting for review, follow-ups, and upcoming commitments. Never invent counts or activity.
2. **Mail** — recruiting conversations and human-reviewed drafts. It should feel like a working communication desk, not a generic fake inbox.
3. **Candidates** — candidate search, review, status, submissions, and next action. Candidate facts must come from real sources or display an honest empty state.
4. **Leads** — companies, contacts, open opportunities, hiring signals, follow-ups, and ownership. Leads are business-development records, not candidate profiles.

Keep these supporting areas together below the primary navigation:

5. **Process** — the recruiting workflow: stages, required facts, approvals, and what is blocked.
6. **Staff** — team ownership, workload, and access. Ja currently operates independently, so do not fabricate coworkers. Design a truthful solo state that can expand later.
7. **Profile** — Ja's business identity, recruiting focus, contact details, signature, and personal working preferences. It is not just an avatar card.
8. **Settings** — connections, approval rules, workflow defaults, display preferences, and account controls in plain language. Do not turn this into a developer-status page.

Settings must remain visibly reachable below these items.

## Interaction expectations

- Every navigation item must open a meaningfully different page; do not repeat the same four cards under different labels.
- Add an explicit **Arrange layout** mode. Ja can move and resize useful blocks only while that mode is on.
- Outside Arrange mode, hide grids, handles, resize notes, and editor chrome.
- Prevent blocks from overlapping. Use sensible snapping or collision handling and offer a reset-to-default action.
- Preserve layout choices per page.
- Use real labels and honest empty states. Do not use skeleton bars to avoid making product decisions.
- Avoid giant repeated title cards, decorative strips with no purpose, and excessive empty space.
- Use bundled icons and verify the preview at desktop and narrow widths.

## How to work

1. Read `AGENTS.md`, `README.md`, and this handoff before editing.
2. Confirm the current Git branch and commit. Work from current `main`; never reopen the rejected temporary `feat/today-ui` checkout.
3. Query Graphify for existing components, routes, styling, and prior implementations before creating replacements. Verify every result against the checked-out commit.
4. Use the Shadcn MCP for current, accessible component patterns. The current console is not initialized as a Shadcn project, so explain the exact frontend changes before running `shadcn init` or installing components.
5. First produce a clear page map and an interactive frontend proposal using the eight page purposes above. Then show Ja the browser preview for review.
6. Keep all work frontend-only until Ja approves the layout. Do not merge, deploy, add real integrations, or change production data.

## Approval gate

The first result is a reviewable UI direction, not a finished production build. Stop for Ja's visual approval before merging or expanding into backend or integration work.
