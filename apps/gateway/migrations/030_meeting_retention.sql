-- Apply only at the M6 gate after Ja approves the live migration.
-- Preserve meeting notes and metadata, but remove transcript text and segments
-- one year after the meeting draft was created.
ALTER TABLE public.meeting_drafts
  ADD COLUMN IF NOT EXISTS transcript_expired_at timestamptz;

COMMENT ON COLUMN public.meeting_drafts.transcript_expired_at IS
  'Date the one-year transcript retention job removed transcript text and speaker segments.';

CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule(
  'workbench-meeting-transcript-retention',
  '17 3 * * *',
  $job$
    UPDATE public.meeting_drafts
       SET transcript = '',
           speaker_segments = '[]'::jsonb,
           transcript_expired_at = now()
     WHERE created_at < now() - interval '1 year'
       AND transcript_expired_at IS NULL
       AND (transcript <> '' OR speaker_segments <> '[]'::jsonb);
  $job$
);
