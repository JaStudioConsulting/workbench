ALTER TABLE meeting_drafts
  ADD COLUMN transcription_status text NOT NULL DEFAULT 'ready'
    CHECK (transcription_status IN ('pending', 'ready', 'failed')),
  ADD COLUMN transcription_warning text,
  ADD COLUMN transcription_source text,
  ADD COLUMN transcription_model text;
