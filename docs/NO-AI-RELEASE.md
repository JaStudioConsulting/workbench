# No-AI release

Workbench runs imports, records, rule-based fit, dated reminders, templates, audio recording, and exports without model calls. AI and transcription routes return `AI_DISABLED`, even when provider credentials exist. Hermes is not used or changed.

Open **Process → Automatic processing** to find a candidate, review output status, upload original PDF/DOCX/TXT documents, or enter explicit template fields and structured résumé sections. Outputs are editable and downloadable. Uploaded documents are retained as originals; their contents are not inferred. Candidate-only and notes-only meetings can be saved. Browser audio remains on its recording device with playback, download, and recovery; native audio and uploaded documents use the M1 data directory.

## Runtime

- Apply migration 032 explicitly after 031. Do not apply deferred 030.
- Set `WORKBENCH_AUTOMATION_ENABLED=1` for the M1 gateway. One supervised worker reconciles saved records every 60 seconds and drains durable jobs. It uses the protected machine-session issuer and an owner-scoped user token; no database service key is copied into the app.
- Set `WORKBENCH_DATA_DIR`, `WORKBENCH_CAPTURE_ROOT`, and `WORKBENCH_TRANSCRIBE_PATH` to stable absolute paths outside release directories. The native helper is used only for capture; transcription stays disabled. Automatic native audio expiry is off.
- Build with `VITE_TAILSCALE_LOCAL_SESSION_ENABLED=1`, the configured `VITE_TAILSCALE_LOCAL_SESSION_OWNER_ID`, and `VITE_OPERATOR_CASES_ENABLED=1`. This preserves private access without a routine sign-in screen.
- Monitor `/healthz`, `/api/capabilities`, owner-protected `/api/automation/jobs`, and the gateway worker log. Failed jobs retain their error; automatic retries stop after three retries. Manual retry is owner-protected.

## Data and rollback

Automation retains source identity, exact input snapshots, and append-only artifact history. A source revert creates a new generation. Removed links invalidate pending work. Removed or mismatched résumé sources withdraw the current résumé and preserve historical versions. Human edits remain in history; changed outputs require fresh review. External sends and Loxo writes are not executed by the worker.

Retain the prior release and LaunchAgent plist. Roll back the runtime by restoring that plist and restarting the service. Keep additive migration 032 and original documents/audio intact; do not drop new tables as part of runtime rollback.
