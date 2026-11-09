# Editor compatibility experiment (M4-02)

Date: 2026-11-09. Tested only in isolated M1 worktree
`/tmp/workbench-m4-editor-compat`; no editor package was added to the Workbench
application or live service. The fixture remains in that worktree at
`apps/editor-compat/` and is deliberately excluded from this documentation PR.

## Tested set

| Package | Resolved version |
|---|---:|
| `novel` | 1.0.0 |
| `@tiptap/core` | 2.27.3 |
| `@excalidraw/excalidraw` | 0.18.0 |
| `react` / `react-dom` | 19.2.8 |
| `vite` | 6.4.3 |
| `tailwindcss` / `@tailwindcss/vite` | 4.3.3 |

The fixture imports `EditorRoot`, `EditorContent`, and `StarterKit` from Novel,
renders a plain initial document with no AI feature configured, and imports
`Excalidraw` with its package CSS. Vite uses the React and Tailwind plugins.
Source licenses and audited upstream commits are in
`docs/THIRD-PARTY-NOTICES.md` (T28, draft PR #20).

## Evidence

- `pnpm --filter @ja/editor-compat-fixture build` passed with Vite 6.4.3 after
  aligning Tiptap core to 2.27.3.
- Full repository `pnpm check` passed on M1 with the isolated fixture present.
- In an ego-browser TaskSpace against the M1 fixture on port 5175, both editors
  mounted. The Novel contenteditable displayed `Novel is ready` and accepted
  an edit. Excalidraw rendered its toolbar and canvases; drawing a rectangle
  made its `onChange` element count move from 0 to 1.
- The fixture server was stopped after verification. Port 8092 was untouched.

The first build, with `@tiptap/core` pinned to 2.11.2 while Novel's caret-range
extensions resolved to 2.27.3, failed because the newer horizontal-rule
extension imported `canInsertNode`, which that older core did not export.
Using core 2.27.3 passed. This is a version-alignment finding, not a general
Novel/React incompatibility.

Installation emitted peer-range warnings from older Radix dependencies under
React 19, though the tested render and interactions worked. The fixture build
also reported chunks above 500 kB, including a 2.26 MB main editor chunk.
M4-05 and M4-06 should load these editors only on their respective tabs and
verify broader interactions before integration. This experiment does not test
autosave, persistence, iPad input, or the final Workbench styling.
