-- Additive origin key so a saved meeting draft syncs to exactly one candidate
-- Note per owner. Clients send origin_key only on create; it is never editable
-- through PATCH. Existing rows keep NULL and behave exactly as before.

ALTER TABLE public.notes
  ADD COLUMN origin_key text
  CHECK (origin_key IS NULL OR length(btrim(origin_key)) BETWEEN 1 AND 200);

CREATE UNIQUE INDEX notes_owner_origin_key_idx
  ON public.notes (owner_id, origin_key)
  WHERE origin_key IS NOT NULL;

COMMENT ON COLUMN public.notes.origin_key IS
  'Optional client-supplied creation key (for example meeting_draft:<uuid>). Unique per owner; routes return the existing note instead of inserting a duplicate.';
