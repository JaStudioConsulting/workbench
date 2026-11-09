# Live Supabase schema

Source: Supabase project `abnfffkmxqixrwzackjf`, read-only inspection on 2026-11-08. This is a snapshot of database structure, not a record of candidate data. Do not infer that a table has live records from its presence.

## Inventory

17 public tables and 1 public view. All 17 tables have RLS enabled. This catalog includes every public table, including tables not currently read by a Workbench page.

| Object | Kind | RLS |
| --- | --- | --- |
| `public.loxo_stages` | table | enabled |
| `public.loxo_activity_types` | table | enabled |
| `public.loxo_jobs` | table | enabled |
| `public.loxo_candidates` | table | enabled |
| `public.loxo_job_candidates` | table | enabled |
| `public.loxo_activities` | table | enabled |
| `public.tracker_fits` | table | enabled |
| `public.review_drafts` | table | enabled |
| `public.tracker_jobs` | table | enabled |
| `public.tracker_candidates` | table | enabled |
| `public.tracker_submissions` | table | enabled |
| `public.tracker_sourcing` | table | enabled |
| `public.candidate_review_actions` | table | enabled |
| `public.workbench_profile` | table | enabled |
| `public.outreach_log` | table | enabled |
| `public.leads` | table | enabled |
| `public.meeting_drafts` | table | enabled |
| `public.candidate_review_feed` | view | view security follows its definition and underlying tables |

## Tables

### `public.loxo_stages`

Primary key: `id`. RLS: enabled.

| Column | Type | Null | Default / notes |
| --- | --- | --- | --- |
| `id` | `bigint` | no |  |
| `name` | `text` | no |  |
| `position` | `integer` | no |  |

RLS policies:

- **ja_read**: SELECT for `{authenticated}`; USING `is_authorized_recruiter()`; WITH CHECK `—`.

### `public.loxo_activity_types`

Primary key: `id`. RLS: enabled.

| Column | Type | Null | Default / notes |
| --- | --- | --- | --- |
| `id` | `bigint` | no |  |
| `key` | `text` | yes |  |
| `name` | `text` | no |  |
| `moves_to_stage_id` | `bigint` | yes | Stage Loxo moves a candidate to when this activity is logged. Null means no stage change. |
| `ja_usual` | `boolean` | no | default `false` |

Foreign keys:

- `moves_to_stage_id` → `public.loxo_stages(id)`

RLS policies:

- **ja_read**: SELECT for `{authenticated}`; USING `is_authorized_recruiter()`; WITH CHECK `—`.

### `public.loxo_jobs`

Primary key: `id`. RLS: enabled.

| Column | Type | Null | Default / notes |
| --- | --- | --- | --- |
| `id` | `bigint` | no |  |
| `title` | `text` | no |  |
| `company` | `text` | yes |  |
| `location` | `text` | yes |  |
| `compensation` | `text` | yes |  |
| `status` | `text` | yes |  |
| `opened_on` | `date` | yes |  |
| `workflow_id` | `bigint` | yes |  |
| `raw` | `jsonb` | yes |  |
| `synced_at` | `timestamp with time zone` | no | default `now()` |

RLS policies:

- **ja_read**: SELECT for `{authenticated}`; USING `is_authorized_recruiter()`; WITH CHECK `—`.

### `public.loxo_candidates`

Primary key: `id`. RLS: enabled.

| Column | Type | Null | Default / notes |
| --- | --- | --- | --- |
| `id` | `bigint` | no |  |
| `full_name` | `text` | no |  |
| `title` | `text` | yes |  |
| `employer` | `text` | yes |  |
| `phone` | `text` | yes |  |
| `email` | `text` | yes |  |
| `location` | `text` | yes |  |
| `resume_state` | `text` | no | default `'none'::text`; check `resume_state = ANY (ARRAY['file'::text, 'profile_only'::text, 'none'::text])` |
| `resume_text` | `text` | yes | Verbatim from source. Never reworded. |
| `work_history` | `jsonb` | yes |  |
| `raw` | `jsonb` | yes |  |
| `synced_at` | `timestamp with time zone` | no | default `now()` |

RLS policies:

- **ja_read**: SELECT for `{authenticated}`; USING `is_authorized_recruiter()`; WITH CHECK `—`.

### `public.loxo_job_candidates`

Primary key: `job_id`, `person_id`. RLS: enabled.

| Column | Type | Null | Default / notes |
| --- | --- | --- | --- |
| `job_id` | `bigint` | no |  |
| `person_id` | `bigint` | no |  |
| `stage_id` | `bigint` | yes |  |
| `applied` | `boolean` | no | default `false` |
| `decision` | `text` | yes | check `decision = ANY (ARRAY['want'::text, 'pass'::text])` |
| `decided_at` | `timestamp with time zone` | yes |  |

Foreign keys:

- `job_id` → `public.loxo_jobs(id)`
- `person_id` → `public.loxo_candidates(id)`
- `stage_id` → `public.loxo_stages(id)`

RLS policies:

- **ja_delete**: DELETE for `{authenticated}`; USING `is_authorized_recruiter()`; WITH CHECK `—`.
- **ja_insert**: INSERT for `{authenticated}`; USING `—`; WITH CHECK `is_authorized_recruiter()`.
- **ja_read**: SELECT for `{authenticated}`; USING `is_authorized_recruiter()`; WITH CHECK `—`.
- **ja_update**: UPDATE for `{authenticated}`; USING `is_authorized_recruiter()`; WITH CHECK `is_authorized_recruiter()`.

### `public.loxo_activities`

Primary key: `id`. RLS: enabled.

| Column | Type | Null | Default / notes |
| --- | --- | --- | --- |
| `id` | `bigint` | no |  |
| `loxo_event_id` | `bigint` | yes |  |
| `person_id` | `bigint` | no |  |
| `job_id` | `bigint` | yes |  |
| `activity_type_id` | `bigint` | yes |  |
| `type_name` | `text` | no |  |
| `actor_name` | `text` | yes |  |
| `actor_is_ja` | `boolean` | yes | Null means unknown. |
| `note` | `text` | yes |  |
| `occurred_at` | `timestamp with time zone` | no | default `now()` |
| `source` | `text` | no | default `'loxo'::text`; check `source = ANY (ARRAY['loxo'::text, 'app'::text])` |
| `loxo_sync` | `text` | no | default `'synced'::text`; App-created activities wait for approval before any Loxo write.; check `loxo_sync = ANY (ARRAY['synced'::text, 'waiting_for_loxo'::text, 'failed'::text])` |

Foreign keys:

- `activity_type_id` → `public.loxo_activity_types(id)`
- `person_id` → `public.loxo_candidates(id)`
- `job_id` → `public.loxo_jobs(id)`

RLS policies:

- **ja_delete**: DELETE for `{authenticated}`; USING `is_authorized_recruiter()`; WITH CHECK `—`.
- **ja_insert**: INSERT for `{authenticated}`; USING `—`; WITH CHECK `is_authorized_recruiter()`.
- **ja_read**: SELECT for `{authenticated}`; USING `is_authorized_recruiter()`; WITH CHECK `—`.
- **ja_update**: UPDATE for `{authenticated}`; USING `is_authorized_recruiter()`; WITH CHECK `is_authorized_recruiter()`.

### `public.tracker_fits`

Primary key: `id`. RLS: enabled.

| Column | Type | Null | Default / notes |
| --- | --- | --- | --- |
| `id` | `bigint` | no |  |
| `person_id` | `bigint` | no |  |
| `fit_job_id` | `bigint` | yes |  |
| `fit_label` | `text` | no |  |
| `tracker_sheet` | `text` | no |  |
| `tracker_row` | `integer` | no |  |
| `date_added` | `date` | yes |  |
| `added_by` | `text` | yes |  |
| `notes` | `text` | yes |  |
| `matched_resume_lines` | `jsonb` | no | default `'[]'::jsonb` |

Foreign keys:

- `fit_job_id` → `public.loxo_jobs(id)`
- `person_id` → `public.loxo_candidates(id)`

RLS policies:

- **ja_read**: SELECT for `{authenticated}`; USING `is_authorized_recruiter()`; WITH CHECK `—`.

### `public.review_drafts`

Primary key: `id`. RLS: enabled.

| Column | Type | Null | Default / notes |
| --- | --- | --- | --- |
| `id` | `bigint` | no |  |
| `person_id` | `bigint` | yes |  |
| `job_id` | `bigint` | yes |  |
| `kind` | `text` | no | check `kind = ANY (ARRAY['resume_pdf'::text, 'write_up'::text, 'email_draft'::text])` |
| `status` | `text` | no | default `'building'::text`; check `status = ANY (ARRAY['building'::text, 'ready'::text, 'approved'::text])` |
| `body` | `text` | yes |  |
| `file_path` | `text` | yes |  |
| `created_at` | `timestamp with time zone` | no | default `now()` |
| `candidate_source` | `text` | yes |  |
| `candidate_source_id` | `bigint` | yes |  |
| `source_snapshot` | `jsonb` | no | default `'{}'::jsonb` |

Foreign keys:

- `job_id` → `public.loxo_jobs(id)`
- `person_id` → `public.loxo_candidates(id)`

RLS policies:

- **ja_delete**: DELETE for `{authenticated}`; USING `is_authorized_recruiter()`; WITH CHECK `—`.
- **ja_insert**: INSERT for `{authenticated}`; USING `—`; WITH CHECK `is_authorized_recruiter()`.
- **ja_read**: SELECT for `{authenticated}`; USING `is_authorized_recruiter()`; WITH CHECK `—`.
- **ja_update**: UPDATE for `{authenticated}`; USING `is_authorized_recruiter()`; WITH CHECK `is_authorized_recruiter()`.

### `public.tracker_jobs`

Primary key: `job_id`. RLS: enabled.

| Column | Type | Null | Default / notes |
| --- | --- | --- | --- |
| `job_id` | `bigint` | no |  |
| `tracker_row` | `integer` | no |  |
| `job_title` | `text` | no |  |
| `company` | `text` | yes |  |
| `client_contact` | `text` | yes |  |
| `location` | `text` | yes |  |
| `compensation` | `text` | yes |  |
| `date_opened` | `date` | yes |  |
| `owners` | `text` | yes |  |
| `status` | `text` | yes |  |
| `job_description` | `text` | yes |  |
| `loxo_link` | `text` | yes |  |
| `raw` | `jsonb` | no | default `'{}'::jsonb` |
| `imported_at` | `timestamp with time zone` | no | default `now()` |

RLS policies:

- **ja_read**: SELECT for `{authenticated}`; USING `is_authorized_recruiter()`; WITH CHECK `—`.

### `public.tracker_candidates`

Primary key: `id`. RLS: enabled.

| Column | Type | Null | Default / notes |
| --- | --- | --- | --- |
| `id` | `bigint` | no |  |
| `tracker_row` | `integer` | no |  |
| `candidate_name` | `text` | no |  |
| `current_title` | `text` | yes |  |
| `location` | `text` | yes |  |
| `industry` | `text` | yes |  |
| `shift` | `text` | yes |  |
| `email` | `text` | yes |  |
| `phone` | `text` | yes |  |
| `compensation_target` | `text` | yes |  |
| `current_compensation` | `text` | yes |  |
| `current_company` | `text` | yes |  |
| `submitted_on` | `text` | yes |  |
| `submitted_to` | `text` | yes |  |
| `notes` | `text` | yes |  |
| `raw` | `jsonb` | no | default `'{}'::jsonb` |
| `imported_at` | `timestamp with time zone` | no | default `now()` |

RLS policies:

- **ja_read**: SELECT for `{authenticated}`; USING `is_authorized_recruiter()`; WITH CHECK `—`.

### `public.tracker_submissions`

Primary key: `id`. RLS: enabled.

| Column | Type | Null | Default / notes |
| --- | --- | --- | --- |
| `id` | `bigint` | no |  |
| `tracker_row` | `integer` | no |  |
| `submission_date` | `date` | yes |  |
| `recruiter` | `text` | yes |  |
| `candidate_name` | `text` | no |  |
| `current_title` | `text` | yes |  |
| `current_company` | `text` | yes |  |
| `licenses_certifications` | `text` | yes |  |
| `location` | `text` | yes |  |
| `industry` | `text` | yes |  |
| `target_current_compensation` | `text` | yes |  |
| `reason_for_leaving` | `text` | yes |  |
| `profile_summary` | `text` | yes |  |
| `additional_notes` | `text` | yes |  |
| `submission_type` | `text` | yes |  |
| `role_submitted_for` | `text` | yes |  |
| `client_submitted_to` | `text` | yes |  |
| `activity_status` | `text` | yes |  |
| `submission_link` | `text` | yes |  |
| `gmail_message_id` | `text` | yes |  |
| `gmail_thread_id` | `text` | yes |  |
| `candidate_key` | `text` | yes |  |
| `source_verified_date` | `date` | yes |  |
| `raw` | `jsonb` | no | default `'{}'::jsonb` |
| `imported_at` | `timestamp with time zone` | no | default `now()` |

RLS policies:

- **ja_read**: SELECT for `{authenticated}`; USING `is_authorized_recruiter()`; WITH CHECK `—`.

### `public.tracker_sourcing`

Primary key: `id`. RLS: enabled.

| Column | Type | Null | Default / notes |
| --- | --- | --- | --- |
| `id` | `bigint` | no |  |
| `tracker_row` | `integer` | no |  |
| `role` | `text` | yes |  |
| `candidate_name` | `text` | yes |  |
| `current_company` | `text` | yes |  |
| `current_title` | `text` | yes |  |
| `profile_url` | `text` | yes |  |
| `evidence_url` | `text` | yes |  |
| `found_at` | `text` | yes |  |
| `review_status` | `text` | yes |  |
| `fit_evidence` | `text` | yes |  |
| `gaps` | `text` | yes |  |
| `candidate_key` | `text` | yes |  |
| `business_email` | `text` | yes |  |
| `personal_email` | `text` | yes |  |
| `mobile_number` | `text` | yes |  |
| `work_number` | `text` | yes |  |
| `other_phone` | `text` | yes |  |
| `source_tab_range` | `text` | yes |  |
| `source_group` | `text` | yes |  |
| `source_notes` | `text` | yes |  |
| `next_check` | `text` | yes |  |
| `email` | `text` | yes |  |
| `phone` | `text` | yes |  |
| `original_row_snapshot` | `jsonb` | yes |  |
| `raw` | `jsonb` | no | default `'{}'::jsonb` |
| `imported_at` | `timestamp with time zone` | no | default `now()` |

RLS policies:

- **ja_read**: SELECT for `{authenticated}`; USING `is_authorized_recruiter()`; WITH CHECK `—`.

### `public.candidate_review_actions`

Primary key: `id`. RLS: enabled.

| Column | Type | Null | Default / notes |
| --- | --- | --- | --- |
| `id` | `bigint` | no |  |
| `job_id` | `bigint` | no |  |
| `candidate_source` | `text` | no | check `candidate_source = ANY (ARRAY['sourcing'::text, 'submission'::text])` |
| `candidate_source_id` | `bigint` | no |  |
| `action_type` | `text` | no | check `action_type = ANY (ARRAY['decision'::text, 'activity'::text])` |
| `decision` | `text` | yes | check `decision IS NULL OR (decision = ANY (ARRAY['want'::text, 'pass'::text]))` |
| `activity_type` | `text` | yes |  |
| `note` | `text` | yes |  |
| `target_stage` | `text` | yes |  |
| `status` | `text` | no | default `'saved'::text`; check `status = ANY (ARRAY['saved'::text, 'waiting_for_loxo'::text, 'failed'::text])` |
| `idempotency_key` | `text` | yes |  |
| `created_at` | `timestamp with time zone` | no | default `now()` |
| `updated_at` | `timestamp with time zone` | no | default `now()` |

Foreign keys:

- `job_id` → `public.tracker_jobs(job_id)`

RLS policies:

- **ja_delete**: DELETE for `{authenticated}`; USING `is_authorized_recruiter()`; WITH CHECK `—`.
- **ja_insert**: INSERT for `{authenticated}`; USING `—`; WITH CHECK `is_authorized_recruiter()`.
- **ja_read**: SELECT for `{authenticated}`; USING `is_authorized_recruiter()`; WITH CHECK `—`.
- **ja_update**: UPDATE for `{authenticated}`; USING `is_authorized_recruiter()`; WITH CHECK `is_authorized_recruiter()`.

### `public.workbench_profile`

Primary key: `owner_id`. RLS: enabled.

| Column | Type | Null | Default / notes |
| --- | --- | --- | --- |
| `owner_id` | `uuid` | no |  |
| `name` | `text` | no | default `''::text` |
| `business_name` | `text` | no | default `''::text` |
| `title` | `text` | no | default `''::text` |
| `phone` | `text` | no | default `''::text` |
| `signature` | `text` | no | default `''::text` |
| `default_province` | `text` | no | default `''::text` |
| `created_at` | `timestamp with time zone` | no | default `now()` |
| `updated_at` | `timestamp with time zone` | no | default `now()` |

Foreign keys:

- `owner_id` → `auth.users(id)`

RLS policies:

- **Owners can create their Workbench profile**: INSERT for `{authenticated}`; USING `—`; WITH CHECK `((( SELECT auth.uid() AS uid) = owner_id) AND is_authorized_recruiter())`.
- **Owners can read their Workbench profile**: SELECT for `{authenticated}`; USING `((( SELECT auth.uid() AS uid) = owner_id) AND is_authorized_recruiter())`; WITH CHECK `—`.
- **Owners can update their Workbench profile**: UPDATE for `{authenticated}`; USING `((( SELECT auth.uid() AS uid) = owner_id) AND is_authorized_recruiter())`; WITH CHECK `((( SELECT auth.uid() AS uid) = owner_id) AND is_authorized_recruiter())`.

### `public.outreach_log`

Primary key: `id`. RLS: enabled.

| Column | Type | Null | Default / notes |
| --- | --- | --- | --- |
| `id` | `uuid` | no | default `gen_random_uuid()` |
| `owner_id` | `uuid` | no |  |
| `job_id` | `text` | no |  |
| `person_id` | `text` | no |  |
| `candidate_email` | `text` | no | default `''::text` |
| `subject` | `text` | no | default `''::text` |
| `body` | `text` | no | default `''::text` |
| `channel` | `text` | no | check `channel = ANY (ARRAY['copy'::text, 'mailto'::text, 'gmail_draft'::text])` |
| `created_at` | `timestamp with time zone` | no | default `now()` |

Foreign keys:

- `owner_id` → `auth.users(id)`

RLS policies:

- **Owners can add to their outreach log**: INSERT for `{authenticated}`; USING `—`; WITH CHECK `((( SELECT auth.uid() AS uid) = owner_id) AND is_authorized_recruiter())`.
- **Owners can read their outreach log**: SELECT for `{authenticated}`; USING `((( SELECT auth.uid() AS uid) = owner_id) AND is_authorized_recruiter())`; WITH CHECK `—`.

### `public.leads`

Primary key: `id`. RLS: enabled.

| Column | Type | Null | Default / notes |
| --- | --- | --- | --- |
| `id` | `uuid` | no | default `gen_random_uuid()` |
| `owner_id` | `uuid` | no |  |
| `company` | `text` | no |  |
| `contact` | `text` | no | default `''::text` |
| `role` | `text` | no | default `''::text` |
| `status` | `text` | no | default `''::text` |
| `next_action` | `text` | no | default `''::text` |
| `next_date` | `date` | yes |  |
| `notes` | `text` | no | default `''::text` |
| `created_at` | `timestamp with time zone` | no | default `now()` |
| `updated_at` | `timestamp with time zone` | no | default `now()` |

Foreign keys:

- `owner_id` → `auth.users(id)`

RLS policies:

- **Owners can create their leads**: INSERT for `{authenticated}`; USING `—`; WITH CHECK `((( SELECT auth.uid() AS uid) = owner_id) AND is_authorized_recruiter())`.
- **Owners can delete their leads**: DELETE for `{authenticated}`; USING `((( SELECT auth.uid() AS uid) = owner_id) AND is_authorized_recruiter())`; WITH CHECK `—`.
- **Owners can read their leads**: SELECT for `{authenticated}`; USING `((( SELECT auth.uid() AS uid) = owner_id) AND is_authorized_recruiter())`; WITH CHECK `—`.
- **Owners can update their leads**: UPDATE for `{authenticated}`; USING `((( SELECT auth.uid() AS uid) = owner_id) AND is_authorized_recruiter())`; WITH CHECK `((( SELECT auth.uid() AS uid) = owner_id) AND is_authorized_recruiter())`.

### `public.meeting_drafts`

Primary key: `id`. RLS: enabled.

| Column | Type | Null | Default / notes |
| --- | --- | --- | --- |
| `id` | `uuid` | no | default `gen_random_uuid()` |
| `owner_id` | `uuid` | no | default `auth.uid()` |
| `job_id` | `bigint` | no |  |
| `candidate_source` | `text` | no | check `candidate_source = ANY (ARRAY['sourcing'::text, 'submission'::text])` |
| `candidate_source_id` | `bigint` | no |  |
| `event_title` | `text` | yes |  |
| `template_id` | `text` | yes | check `template_id = ANY (ARRAY['candidate_screen'::text, 'client_intake'::text, 'reference_check'::text])` |
| `transcript` | `text` | no |  |
| `notes` | `text` | no | default `''::text` |
| `created_at` | `timestamp with time zone` | no | default `now()` |
| `recording_id` | `text` | yes |  |
| `capture_status` | `text` | no | default `'transcribed'::text`; check `capture_status = ANY (ARRAY['captured'::text, 'transcribed'::text, 'partial'::text, 'recovered'::text])` |
| `capture_warning` | `text` | yes |  |
| `speaker_segments` | `jsonb` | no | default `'[]'::jsonb`; check `jsonb_typeof(speaker_segments) = 'array'::text` |
| `speakers` | `jsonb` | no | default `'[]'::jsonb`; check `jsonb_typeof(speakers) = 'array'::text` |
| `speaker_labels` | `jsonb` | no | default `'{}'::jsonb`; check `jsonb_typeof(speaker_labels) = 'object'::text` |
| `transcription_status` | `text` | no | default `'ready'::text`; check `transcription_status = ANY (ARRAY['pending'::text, 'ready'::text, 'failed'::text])` |
| `transcription_warning` | `text` | yes |  |
| `transcription_source` | `text` | yes |  |
| `transcription_model` | `text` | yes |  |

RLS policies:

- **meeting_drafts_delete_own**: DELETE for `{authenticated}`; USING `((auth.uid() = owner_id) AND is_authorized_recruiter())`; WITH CHECK `—`.
- **meeting_drafts_insert_own**: INSERT for `{authenticated}`; USING `—`; WITH CHECK `((auth.uid() = owner_id) AND is_authorized_recruiter())`.
- **meeting_drafts_select_own**: SELECT for `{authenticated}`; USING `((auth.uid() = owner_id) AND is_authorized_recruiter())`; WITH CHECK `—`.
- **meeting_drafts_update_own**: UPDATE for `{authenticated}`; USING `((auth.uid() = owner_id) AND is_authorized_recruiter())`; WITH CHECK `((auth.uid() = owner_id) AND is_authorized_recruiter())`.

## Views

### `public.candidate_review_feed`

| Column | Type | Null |
| --- | --- | --- |
| `candidate_source` | `text` | yes |
| `candidate_source_id` | `bigint` | yes |
| `job_id` | `bigint` | yes |
| `candidate_key` | `text` | yes |
| `candidate_name` | `text` | yes |
| `current_title` | `text` | yes |
| `current_company` | `text` | yes |
| `location` | `text` | yes |
| `email` | `text` | yes |
| `phone` | `text` | yes |
| `stage` | `text` | yes |
| `resume_state` | `text` | yes |
| `resume_text` | `text` | yes |
| `profile_summary` | `text` | yes |
| `additional_notes` | `text` | yes |
| `fit_evidence` | `text` | yes |
| `gaps` | `text` | yes |
| `profile_url` | `text` | yes |
| `tracker_row` | `integer` | yes |
| `source_verified_date` | `date` | yes |
| `source_updated_at` | `timestamp with time zone` | yes |

Definition from `information_schema.views`:

```sql
WITH sourcing_ids AS (
         SELECT s.id,
            s.tracker_row,
            s.role,
            s.candidate_name,
            s.current_company,
            s.current_title,
            s.profile_url,
            s.evidence_url,
            s.found_at,
            s.review_status,
            s.fit_evidence,
            s.gaps,
            s.candidate_key,
            s.business_email,
            s.personal_email,
            s.mobile_number,
            s.work_number,
            s.other_phone,
            s.source_tab_range,
            s.source_group,
            s.source_notes,
            s.next_check,
            s.email,
            s.phone,
            s.original_row_snapshot,
            s.raw,
            s.imported_at,
            ("substring"(COALESCE((s.original_row_snapshot #>> '{values,0}'::text[]), s.role, ''::text), '([0-9]{6,})$'::text))::bigint AS parsed_job_id
           FROM tracker_sourcing s
        ), sourcing_mapped AS (
         SELECT 'sourcing'::text AS candidate_source,
            s.id AS candidate_source_id,
            j.job_id,
            s.candidate_key,
            s.candidate_name,
            s.current_title,
            s.current_company,
            NULL::text AS location,
            COALESCE(s.personal_email, s.business_email, s.email) AS email,
            COALESCE(s.mobile_number, s.phone, s.work_number, s.other_phone) AS phone,
            COALESCE(NULLIF(s.review_status, ''::text), 'Needs checking'::text) AS stage,
                CASE
                    WHEN (NULLIF(s.profile_url, ''::text) IS NOT NULL) THEN 'profile_only'::text
                    ELSE 'none'::text
                END AS resume_state,
            NULL::text AS resume_text,
            NULL::text AS profile_summary,
            s.source_notes AS additional_notes,
            s.fit_evidence,
            s.gaps,
            s.profile_url,
            s.tracker_row,
            NULL::date AS source_verified_date,
            s.imported_at AS source_updated_at
           FROM (sourcing_ids s
             JOIN tracker_jobs j ON ((j.job_id = s.parsed_job_id)))
        ), submission_matches AS (
         SELECT s.id AS submission_id,
            j.job_id,
            count(*) OVER (PARTITION BY s.id) AS match_count
           FROM (tracker_submissions s
             JOIN tracker_jobs j ON (((lower(TRIM(BOTH FROM s.role_submitted_for)) = lower(TRIM(BOTH FROM j.job_title))) AND ((NULLIF(TRIM(BOTH FROM s.client_submitted_to), ''::text) IS NULL) OR (lower(TRIM(BOTH FROM s.client_submitted_to)) = lower(TRIM(BOTH FROM j.company)))))))
        ), submission_mapped AS (
         SELECT 'submission'::text AS candidate_source,
            s.id AS candidate_source_id,
            m.job_id,
            s.candidate_key,
            s.candidate_name,
            s.current_title,
            s.current_company,
            s.location,
            NULL::text AS email,
            NULL::text AS phone,
            COALESCE(NULLIF(s.activity_status, ''::text), 'Submitted'::text) AS stage,
                CASE
                    WHEN (NULLIF(s.profile_summary, ''::text) IS NOT NULL) THEN 'profile_only'::text
                    ELSE 'none'::text
                END AS resume_state,
            NULL::text AS resume_text,
            s.profile_summary,
            s.additional_notes,
            NULL::text AS fit_evidence,
            NULL::text AS gaps,
            NULL::text AS profile_url,
            s.tracker_row,
            s.source_verified_date,
            s.imported_at AS source_updated_at
           FROM (tracker_submissions s
             JOIN submission_matches m ON (((m.submission_id = s.id) AND (m.match_count = 1))))
        )
 SELECT sourcing_mapped.candidate_source,
    sourcing_mapped.candidate_source_id,
    sourcing_mapped.job_id,
    sourcing_mapped.candidate_key,
    sourcing_mapped.candidate_name,
    sourcing_mapped.current_title,
    sourcing_mapped.current_company,
    sourcing_mapped.location,
    sourcing_mapped.email,
    sourcing_mapped.phone,
    sourcing_mapped.stage,
    sourcing_mapped.resume_state,
    sourcing_mapped.resume_text,
    sourcing_mapped.profile_summary,
    sourcing_mapped.additional_notes,
    sourcing_mapped.fit_evidence,
    sourcing_mapped.gaps,
    sourcing_mapped.profile_url,
    sourcing_mapped.tracker_row,
    sourcing_mapped.source_verified_date,
    sourcing_mapped.source_updated_at
   FROM sourcing_mapped
UNION ALL
 SELECT submission_mapped.candidate_source,
    submission_mapped.candidate_source_id,
    submission_mapped.job_id,
    submission_mapped.candidate_key,
    submission_mapped.candidate_name,
    submission_mapped.current_title,
    submission_mapped.current_company,
    submission_mapped.location,
    submission_mapped.email,
    submission_mapped.phone,
    submission_mapped.stage,
    submission_mapped.resume_state,
    submission_mapped.resume_text,
    submission_mapped.profile_summary,
    submission_mapped.additional_notes,
    submission_mapped.fit_evidence,
    submission_mapped.gaps,
    submission_mapped.profile_url,
    submission_mapped.tracker_row,
    submission_mapped.source_verified_date,
    submission_mapped.source_updated_at
   FROM submission_mapped;
```

## Applied migrations

- `20261102083608` — candidate_review_tracker_tables
- `20261102083622` — candidate_review_indexes
- `20261102083914` — tracker_source_tables_no_deals
- `20261102084457` — ja_email_access_policies
- `20261102090140` — candidate_review_live_feed_and_actions
- `20261102090153` — candidate_review_feed_job_fk_guard
- `20261102091019` — authorize_current_and_legacy_ja_emails
- `20261107080441` — workbench_profile_and_outreach_log
- `20261107080447` — leads
- `20261107080455` — meeting_drafts
- `20261107103756` — meeting_capture_metadata
- `20261107104806` — meeting_transcription_metadata
