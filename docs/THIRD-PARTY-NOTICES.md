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

## Proposed Notes and Board components (license audit only)

The source snapshots below were checked on 2026-11-09. They are evaluation
pins for M4-02, not dependencies or code already copied into Workbench. Each
listed package is JavaScript/TypeScript and has a license allowed by the build
plan. Keep the exact license and attribution with any code later copied.

| Component | Repository and audited commit | Package at that commit | License evidence |
|---|---|---|---|
| Novel headless editor | [steven-tey/novel](https://github.com/steven-tey/novel/tree/fa95098e66476c466faebb8211baa5869c101a9c), `fa95098e66476c466faebb8211baa5869c101a9c` | [`novel` 1.0.0](https://github.com/steven-tey/novel/blob/fa95098e66476c466faebb8211baa5869c101a9c/packages/headless/package.json) | [Apache-2.0](https://github.com/steven-tey/novel/blob/fa95098e66476c466faebb8211baa5869c101a9c/LICENSE) |
| Tiptap core | [ueberdosis/tiptap](https://github.com/ueberdosis/tiptap/tree/5fd5d2f5df1a18f31c800a6b2faf1ece952ee0e5), `5fd5d2f5df1a18f31c800a6b2faf1ece952ee0e5` | [`@tiptap/core` 3.30.3](https://github.com/ueberdosis/tiptap/blob/5fd5d2f5df1a18f31c800a6b2faf1ece952ee0e5/packages/core/package.json) | [MIT](https://github.com/ueberdosis/tiptap/blob/5fd5d2f5df1a18f31c800a6b2faf1ece952ee0e5/LICENSE.md) |
| Excalidraw editor | [excalidraw/excalidraw](https://github.com/excalidraw/excalidraw/tree/701b901a0f1ba3d0b390d9cdf63d112e25abac4b), `701b901a0f1ba3d0b390d9cdf63d112e25abac4b` | [`@excalidraw/excalidraw` 0.18.0](https://github.com/excalidraw/excalidraw/blob/701b901a0f1ba3d0b390d9cdf63d112e25abac4b/packages/excalidraw/package.json) | [MIT](https://github.com/excalidraw/excalidraw/blob/701b901a0f1ba3d0b390d9cdf63d112e25abac4b/LICENSE) |

Scope is the open-source editor packages only. Novel AI features, Tiptap Pro
extensions and Cloud, and Excalidraw+ are outside this audit and stay off.
Novel 1.0.0 declares Tiptap 2.11.x dependencies, while the separately audited
Tiptap core snapshot is 3.30.3. This version gap is a test target, not a
proven blocker. M4-02 must choose a compatible set and verify it with React 19,
Vite 6 and Tailwind 4 before any integration. Excalidraw's
audited package manifest declares React 19 peer support; rendering remains
unverified until M4-02.
