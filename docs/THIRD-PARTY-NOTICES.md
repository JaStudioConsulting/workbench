# Third-party notices

Workbench borrows ideas and small pieces of logic from the open-source projects
below. Each source is forked, frozen at one commit, and kept outside this
repository. Only the listed pieces are taken. No other project's name,
branding, assets, or second application ships in Workbench.

## Open Recruiter

- Upstream: https://github.com/miao4ai/open_recruiter
- Fork: https://github.com/JaStudioConsulting/open_recruiter
- Pinned commit: `80aa87d800f27b8d99325b1b2f5c563b1bf6944a`
- License: MIT, full text in `licenses/OPEN-RECRUITER-MIT.txt`
- Taken (ported to JavaScript, not copied):
  - `product/backend/app/prompts.py`: the four evaluation specialists (skills,
    culture fit, risk, market positioning) and the summary writer, rewritten to
    return levels with cited reasons instead of 0-100 numbers. Fairness and
    demographic content is removed. Lands in `apps/gateway/src/ai-routes.js`.
  - `product/backend/app/agents/evaluation_swarm.py`: the idea of running the
    specialists in parallel and then summarizing. Lands in
    `apps/gateway/src/ai-routes.js`.
  - `product/frontend` pipeline board behavior (stage columns, drag to move),
    rebuilt with shadcn and `@dnd-kit/react`. Lands in
    `apps/console/src/features/pipeline/`.
  - The outreach prompt and draft flow, ported as draft only. Lands in
    `apps/gateway/src/ai-routes.js` and
    `apps/console/src/features/candidate-review/`.
  - The reply-detection idea from `tools/imap_checker.py`, rebuilt as a
    read-only check over the existing Google connection. Lands in
    `apps/gateway/src/mail-routes.js`.
- Left out: SQLite, vector store, embeddings, automatic sending, campaigns,
  fairness research and SDK, personas, logos and images, Electron app,
  job-seeker mode, Slack.

## Muesli

- Fork: https://github.com/JaStudioConsulting/muesli
- Pinned commit: `94ff83be84bc68630d1481ef2cf64a7a47c835a6`
- License: MIT, full text in `licenses/MUESLI-MIT.txt`
- Taken and where it lands: see
  `packages/workbench-transcription-native/NOTICE.md` and
  `docs/WORKBENCH-NATIVE-FEATURE-SALVAGE.md`. Meeting templates and export
  land in `apps/console/src/features/meetings/`.

## Design review tools (not shipped)

These were used once, by hand, to review the finished screens. They are not
part of the application and are not stored in this repository.

| Tool | Source | License | Pin |
|---|---|---|---|
| Impeccable | pbakaus/impeccable | Apache-2.0 | version 4.8.0 |
| better-accessibility | jakubkrehel/skills | MIT | `7fe3f3727dc1c15b` |
| better-interface | jakubkrehel/skills | MIT | `c4f8a7862c00e63a` |
| better-layout | jakubkrehel/skills | MIT | `822bb216c43ce743` |
| better-writing | jakubkrehel/skills | MIT | `5dcd97f7df29f92e` |
| interface-review | jakubkrehel/skills | MIT | `3b04fd6eb5fef3b4` |

Pins for the jakubkrehel skills are the first 16 characters of the content
hash recorded in the local skills lock file.

## Editor and Board package notices (M4 compatibility fixture)

The versions listed below are declared dependencies in
`apps/console/package.json`. The M4 compatibility checks summarized here were
run in an isolated fixture; they establish compatibility for that fixture,
not full Workbench behavior or the state of a live deployment. The installed
`@tiptap/core` package manifest identifies version 2.27.3, declares MIT, and
names `https://github.com/ueberdosis/tiptap` as its repository. Its installed
source tree was inspected. No upstream source commit is claimed for this npm
package version.

| Component | Installed package | Source and license evidence |
|---|---|---|
| Novel headless editor | `novel` 1.0.0 | [Repository snapshot](https://github.com/steven-tey/novel/tree/fa95098e66476c466faebb8211baa5869c101a9c); [package manifest](https://github.com/steven-tey/novel/blob/fa95098e66476c466faebb8211baa5869c101a9c/packages/headless/package.json) declares Apache-2.0; [license](https://github.com/steven-tey/novel/blob/fa95098e66476c466faebb8211baa5869c101a9c/LICENSE) |
| Tiptap core | [`@tiptap/core` 2.27.3](https://www.npmjs.com/package/@tiptap/core/v/2.27.3) | [Upstream repository](https://github.com/ueberdosis/tiptap); the installed package manifest declares MIT. No source commit pin is asserted. |
| Excalidraw editor | `@excalidraw/excalidraw` 0.18.0 | [Repository snapshot](https://github.com/excalidraw/excalidraw/tree/701b901a0f1ba3d0b390d9cdf63d112e25abac4b); [package manifest](https://github.com/excalidraw/excalidraw/blob/701b901a0f1ba3d0b390d9cdf63d112e25abac4b/packages/excalidraw/package.json) and [license](https://github.com/excalidraw/excalidraw/blob/701b901a0f1ba3d0b390d9cdf63d112e25abac4b/LICENSE) declare MIT. |

The compatibility fixture built successfully with Tiptap core 2.27.3 aligned
with Novel's resolved extensions. Browser checks confirmed Novel mounted and
accepted an edit, and Excalidraw mounted and registered a drawn rectangle.
This verifies the isolated fixture only; autosave, persistence, iPad input, and
final Workbench styling were outside the experiment. Novel AI features,
Tiptap Pro extensions and Cloud, and Excalidraw+ were not included.
