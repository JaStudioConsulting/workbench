# Workbench native feature salvage

## Status

Core extraction is implemented. The gateway now calls the Workbench-owned
`native/bin/workbench-transcribe` helper and stores models in Workbench support.
The separate reference application is not a runtime dependency.

## Frozen source

- Fork: `JaStudioConsulting/muesli`
- Reviewed commit: `94ff83be84bc68630d1481ef2cf64a7a47c835a6`
- License: MIT
- Native model pin: `FluidInference/parakeet-unified-en-0.6b-coreml`
  at `d32e972dd4315f1dc3f6be28fb2aab0ab3e80358`

The fork remains a reference source. It must not be nested inside this
repository or deployed as a second product.

## License obligations

- Retain the original MIT copyright and permission notice with copied or
  substantially derived code.
- Retain applicable third-party notices from the source `NOTICE` file.
- Preserve Apache-2.0 attribution for adopted FluidAudio/Qwen3 and AI Elements
  code, plus ISC/MIT attribution for adopted Lucide assets.
- Preserve each selected model and runtime license. Do not copy model weights
  or branded assets without a separate license check.
- Record copied source paths and their exact source commit in the Workbench
  third-party notices.

## Built now

- meeting capture lifecycle and shutdown safety
- local file transcription runtime
- browser recorder and gateway contract tests

## Next extraction slice

- macOS system-audio capture
- microphone and system-audio mixing
- diarization and speaker attribution
- mic/system transcript reconciliation
- speaker-labelled transcript formatting
- custom vocabulary dictionary codec

Only the dependencies required by these modules may be introduced.

## Backlog

- recruiter-safe meeting templates
- Markdown and PDF meeting export
- source-linked transcript citations
- Ask Meetings
- video recording
- dictionary management interface
- meeting reminders and safe post-meeting hooks
- transcript-health and recovery controls

The backlog stays in this document or GitHub issues. Dormant source code must
not be copied into the application tree.

## Reject

- Muesli name, logo, waveform mark, theme, and branded assets
- Muesli SwiftUI application shell
- duplicate Calendar, Google authorization, or contacts integrations
- dictation-anywhere hotkeys and accessibility paste controls
- telemetry, update, release, and CloudKit machinery
- duplicate SQLite product storage
- third-party company logos and promotional graphics

Workbench already owns its web interface, Supabase storage, Google Calendar
connection, recruiting rules, and visual identity.

## Final built-in architecture

```text
Workbench Meetings screen
          |
          v
Same-origin M1 gateway
          |
          v
Workbench native audio helper
  | capture | mix | transcribe |
  | diarize | format | recover |
          |
          v
Source-grounded meeting draft
          |
          v
Supabase review storage
```

The native helper is an internal Workbench build artifact. The deployed app
must not require a separately installed Muesli application or expose Muesli
branding to the user.

## Completion gate

The migration is complete only when the internal helper builds from the pinned
source, all adopted tests pass, Workbench records and transcribes a synthetic
meeting, the transcript survives reload, and removing `/Applications/Muesli.app`
does not break the feature.
