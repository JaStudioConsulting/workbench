# Source and notices

Workbench native transcription includes adapted audio-preparation and WAV
writing code from `JaStudioConsulting/muesli` commit
`94ff83be84bc68630d1481ef2cf64a7a47c835a6`, originally published by Pranav
Hari under the MIT License. The required notice is retained in
`LICENSES/MUESLI-MIT.txt`.

Adapted source path:
`native/MuesliNative/Sources/MuesliCLI/TranscribeCommand.swift`.

Local speech recognition uses FluidAudio `0.17.7` through Swift Package Manager.
Its Apache-2.0 license is retained in `LICENSES/FLUIDAUDIO-APACHE-2.0.txt`.
The command-line interface uses Swift Argument Parser; its Apache-2.0 license
is retained in `LICENSES/SWIFT-ARGUMENT-PARSER-APACHE-2.0.txt`. No Muesli logos,
application shell, telemetry, updater, database, CloudKit code, or branded
assets are included.

On first use, FluidAudio downloads
`FluidInference/parakeet-unified-en-0.6b-coreml` at immutable revision
`d32e972dd4315f1dc3f6be28fb2aab0ab3e80358` into Workbench support. The model
is not stored in this repository. It is CC-BY-4.0 licensed, is based on
NVIDIA's Parakeet model, and is attributed in
`LICENSES/PARAKEET-UNIFIED-CC-BY-4.0.txt`.
