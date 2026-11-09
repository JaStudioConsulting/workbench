-- Apply only at the M6 gate after Ja approves the live migration.
-- Preserve meeting notes and metadata, but remove transcript text and segments
-- one year after their latest durable save.
ALTER TABLE public.meeting_drafts
  ADD COLUMN IF NOT EXISTS transcript_saved_at timestamptz,
  ADD COLUMN IF NOT EXISTS transcript_expired_at timestamptz;

COMMENT ON COLUMN public.meeting_drafts.transcript_saved_at IS
  'Latest durable transcript save. Existing rows are conservatively anchored at migration time because historical edit timestamps were not recorded.';
COMMENT ON COLUMN public.meeting_drafts.transcript_expired_at IS
  'Date the one-year transcript retention job removed transcript text and speaker segments.';

-- No historical last-save timestamp exists. Give existing transcripts a full
-- year from this migration rather than risking premature deletion.
UPDATE public.meeting_drafts
   SET transcript_saved_at = now()
 WHERE transcript_saved_at IS NULL
   AND (transcript <> '' OR coalesce(speaker_segments, '[]'::jsonb) <> '[]'::jsonb);

CREATE OR REPLACE FUNCTION public.track_meeting_transcript_save()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.transcript <> '' OR coalesce(NEW.speaker_segments, '[]'::jsonb) <> '[]'::jsonb THEN
    NEW.transcript_saved_at = now();
    NEW.transcript_expired_at = NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS meeting_transcript_save_insert ON public.meeting_drafts;
CREATE TRIGGER meeting_transcript_save_insert
  BEFORE INSERT ON public.meeting_drafts
  FOR EACH ROW EXECUTE FUNCTION public.track_meeting_transcript_save();

DROP TRIGGER IF EXISTS meeting_transcript_save_update ON public.meeting_drafts;
CREATE TRIGGER meeting_transcript_save_update
  BEFORE UPDATE OF transcript, speaker_segments ON public.meeting_drafts
  FOR EACH ROW EXECUTE FUNCTION public.track_meeting_transcript_save();

CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule(
  'workbench-meeting-transcript-retention',
  '17 3 * * *',
  $job$
    UPDATE public.meeting_drafts
       SET transcript = '',
           speaker_segments = '[]'::jsonb,
           transcript_expired_at = now()
     WHERE transcript_saved_at < now() - interval '1 year'
       AND transcript_expired_at IS NULL
       AND (transcript <> '' OR coalesce(speaker_segments, '[]'::jsonb) <> '[]'::jsonb);
  $job$
);
