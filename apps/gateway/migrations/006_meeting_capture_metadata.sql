ALTER TABLE meeting_drafts
  ADD COLUMN recording_id text,
  ADD COLUMN capture_status text NOT NULL DEFAULT 'transcribed'
    CHECK (capture_status IN ('captured', 'transcribed', 'partial', 'recovered')),
  ADD COLUMN capture_warning text,
  ADD COLUMN speaker_segments jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(speaker_segments) = 'array'),
  ADD COLUMN speakers jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(speakers) = 'array'),
  ADD COLUMN speaker_labels jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(speaker_labels) = 'object');

CREATE UNIQUE INDEX meeting_drafts_owner_recording_idx
  ON meeting_drafts (owner_id, recording_id)
  WHERE recording_id IS NOT NULL;
