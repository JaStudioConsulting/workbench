-- Tighten Supabase default table grants for the importer tables. RLS remains
-- enabled; canonical writes remain available only through the two guarded RPCs.
REVOKE ALL ON TABLE public.tracker_imports, public.tracker_import_source_rows,
  public.tracker_import_preview_rows FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT ON TABLE public.tracker_imports TO authenticated;
GRANT SELECT ON TABLE public.tracker_import_source_rows,
  public.tracker_import_preview_rows TO authenticated;
