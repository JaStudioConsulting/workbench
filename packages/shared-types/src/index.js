import { z } from "zod";

export const SessionSchema = z.object({
  userId: z.string().min(1),
  email: z.string().email(),
  expiresAt: z.string().datetime(),
});

export const GOOGLE_WORKSPACE_CONTAINER_SCOPES = Object.freeze([
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/spreadsheets",
]);

export const VerifiedFactSchema = z.object({
  label: z.string().min(1),
  value: z.string().min(1),
  source: z.enum(["resume", "transcript", "call_notes"]),
  evidence: z.string().min(1),
});

export const CandidateInputSchema = z.object({
  name: z.string().min(1),
  title: z.string().min(1),
  resumeText: z.string().min(1),
  transcriptText: z.string().optional(),
  jobDescription: z.string().min(1),
  callNotes: z.string().optional(),
  verifiedFacts: z.array(VerifiedFactSchema).optional().default([]),
});

export const WorkflowOutputSchema = z.object({
  authority: z.literal("recruiter"),
  audit: z.object({
    providedSources: z.array(z.enum(["resume", "transcript", "call_notes"])),
    missingSources: z.array(z.enum(["resume", "transcript", "call_notes"])),
    supportedClaims: z.array(VerifiedFactSchema),
  }),
  brandedResume: z.object({ status: z.literal("draft"), content: z.string() }),
  submission: z.object({ status: z.literal("draft"), fields: z.object({ profileSummary: z.array(z.string()) }) }),
  presentationEmail: z.object({ status: z.literal("draft"), subject: z.string(), body: z.string() }),
  loxoDraft: z.object({ status: z.literal("draft"), bullets: z.array(z.string()) }),
  reviewRequired: z.literal(true),
});

export const SafetyStateSchema = z.object({
  auth: z.enum(["configured", "unavailable"]),
  storage: z.enum(["durable", "memory_test_only", "unavailable"]),
  gmail: z.literal("draft_only"),
  neo4j: z.enum(["disabled", "read_only"]),
  externalWrites: z.literal(false),
});

export const McpDiscoverySchema = z.object({
  frontDoor: z.literal("recruiter"),
  tools: z.array(z.object({ id: z.string(), access: z.enum(["router", "read_only"]) })),
});

export const GoogleWorkspaceStartSchema = z.object({
  authorizationUrl: z.string().url(),
  expiresAt: z.string().datetime(),
}).strict();

export const GoogleWorkspaceStatusSchema = z.discriminatedUnion("connected", [
  z.object({ connected: z.literal(false) }).strict(),
  z.object({
    connected: z.literal(true),
    account: z.object({ email: z.string().email() }).strict(),
    scopes: z.array(z.literal("https://www.googleapis.com/auth/calendar.readonly")),
  }).strict(),
]);

const GoogleCalendarEventTimeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("dateTime"), value: z.string().datetime() }).strict(),
  z.object({ kind: z.literal("date"), value: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict(),
]);

export const GoogleCalendarUpcomingSchema = z.object({
  connected: z.literal(true),
  range: z.object({
    from: z.string().datetime(),
    to: z.string().datetime(),
  }).strict(),
  events: z.array(z.object({
    title: z.string().min(1).max(200).nullable(),
    start: GoogleCalendarEventTimeSchema,
    end: GoogleCalendarEventTimeSchema,
    allDay: z.boolean(),
    joinUrl: z.string().url().nullable().optional(),
  }).strict()).max(10),
}).strict();

export const GoogleWorkspaceSyncRequestSchema = z.discriminatedUnion("service", [
  z.object({
    service: z.literal("sheets"),
    spreadsheetId: z.string().trim().min(1).max(200),
    range: z.string().trim().min(1).max(200),
  }).strict(),
  z.object({
    service: z.literal("gmail"),
    query: z.string().trim().max(500).default(""),
    maxResults: z.number().int().min(1).max(20).default(20),
  }).strict(),
]);

export const GoogleWorkspaceSyncResponseSchema = z.discriminatedUnion("service", [
  z.object({
    service: z.literal("sheets"),
    spreadsheetId: z.string().min(1),
    range: z.string().min(1),
    rows: z.array(z.array(z.string().max(2000)).max(50)).max(200),
  }).strict(),
  z.object({
    service: z.literal("gmail"),
    threads: z.array(z.object({ id: z.string().min(1).max(200) }).strict()).max(20),
  }).strict(),
]);

export const ErrorEnvelopeSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

export function errorEnvelope(code, message) {
  return ErrorEnvelopeSchema.parse({ error: { code, message } });
}

export const CANDIDATE_SOURCES = Object.freeze([
  "tracker_candidates",
  "sourcing",
  "submission",
  "manual",
]);

export const TRACKER_CANDIDATE_SOURCES = Object.freeze([
  "tracker_candidates",
  "sourcing",
  "submission",
]);

export const TRACKER_SOURCES = Object.freeze([
  "tracker_candidates",
  "tracker_sourcing",
  "tracker_submissions",
]);

export const CANDIDATE_TO_TRACKER_SOURCE = Object.freeze({
  tracker_candidates: "tracker_candidates",
  sourcing: "tracker_sourcing",
  submission: "tracker_submissions",
  manual: null,
});

export const TRACKER_TO_CANDIDATE_SOURCE = Object.freeze({
  tracker_candidates: "tracker_candidates",
  tracker_sourcing: "sourcing",
  tracker_submissions: "submission",
});

export const MANUAL_CANDIDATE_EDITABLE_FIELDS = Object.freeze([
  "candidate_name",
  "current_title",
  "current_company",
  "location",
  "industry",
  "shift",
  "email",
  "phone",
  "compensation_target",
  "current_compensation",
  "notes",
]);

export const TRACKER_CANDIDATE_OVERLAY_FIELDS = Object.freeze([
  ...MANUAL_CANDIDATE_EDITABLE_FIELDS,
  "compensation_context",
  "profile_url",
  "role_context",
  "client_context",
]);

export const CandidateSourceSchema = z.enum(CANDIDATE_SOURCES);
export const TrackerSourceSchema = z.enum(TRACKER_SOURCES);
export const SupabaseUserIdSchema = z.string().uuid();

const POSITIVE_INT_ID_PATTERN = /^[1-9]\d*$/;

export function parseCandidateSourceKey(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const parts = trimmed.split(":");
  if (parts.length !== 2) return null;
  const [candidateSource, rawSourceId] = parts;
  if (!CANDIDATE_SOURCES.includes(candidateSource) || !rawSourceId) return null;

  if (candidateSource === "manual") {
    const parsedUuid = SupabaseUserIdSchema.safeParse(rawSourceId);
    if (!parsedUuid.success) return null;
    const normalizedUuid = parsedUuid.data.toLowerCase();
    return Object.freeze({
      id: `manual:${normalizedUuid}`,
      candidate_source: "manual",
      tracker_source: null,
      candidate_source_id: normalizedUuid,
      is_manual: true,
    });
  }

  if (!POSITIVE_INT_ID_PATTERN.test(rawSourceId)) return null;
  const numericId = Number(rawSourceId);
  if (!Number.isSafeInteger(numericId) || numericId <= 0) return null;
  return Object.freeze({
    id: `${candidateSource}:${rawSourceId}`,
    candidate_source: candidateSource,
    tracker_source: CANDIDATE_TO_TRACKER_SOURCE[candidateSource],
    candidate_source_id: rawSourceId,
    is_manual: false,
  });
}

export const CandidateIdSchema = z.string().trim().transform((value, ctx) => {
  const parsed = parseCandidateSourceKey(value);
  if (!parsed) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Candidate ID must be a valid candidate_source:candidate_source_id key",
    });
    return z.NEVER;
  }
  return parsed.id;
});

const CandidateNameSchema = z.string().trim().min(1, "Candidate name is required").max(300);

function nullableCandidateField(max = 300) {
  return z.string().trim().min(1).max(max).nullable().optional();
}

const CandidateEmailFieldSchema = z.string().trim().toLowerCase().email().max(320).nullable().optional();

const CandidateProfileUrlFieldSchema = z.string()
  .trim()
  .url()
  .max(2000)
  .refine((value) => /^https?:\/\//i.test(value), "Profile URL must use http or https")
  .nullable()
  .optional();

const manualEditableShape = {
  current_title: nullableCandidateField(300),
  current_company: nullableCandidateField(300),
  location: nullableCandidateField(300),
  industry: nullableCandidateField(300),
  shift: nullableCandidateField(200),
  email: CandidateEmailFieldSchema,
  phone: nullableCandidateField(100),
  compensation_target: nullableCandidateField(300),
  current_compensation: nullableCandidateField(300),
  notes: nullableCandidateField(20_000),
};

const trackerOverlayExtraShape = {
  compensation_context: nullableCandidateField(500),
  profile_url: CandidateProfileUrlFieldSchema,
  role_context: nullableCandidateField(300),
  client_context: nullableCandidateField(300),
};

export const CandidateCreateRequestSchema = z.object({
  candidate_name: CandidateNameSchema,
  ...manualEditableShape,
}).strict();

export const ManualCandidateCreateSchema = CandidateCreateRequestSchema;

function hasAtLeastOneDefinedField(value) {
  return Object.keys(value).some((key) => value[key] !== undefined);
}

export const ManualCandidateEditsSchema = z.object({
  candidate_name: CandidateNameSchema.optional(),
  ...manualEditableShape,
}).strict().refine(hasAtLeastOneDefinedField, {
  message: "At least one candidate field must be provided",
});

export const TrackerCandidateEditsSchema = z.object({
  candidate_name: CandidateNameSchema.optional(),
  ...manualEditableShape,
  ...trackerOverlayExtraShape,
}).strict().refine(hasAtLeastOneDefinedField, {
  message: "At least one candidate edit field must be provided",
});

const WrappedCandidateEditRequestSchema = z.object({
  edits: TrackerCandidateEditsSchema,
  tracker_source: TrackerSourceSchema.optional(),
  tracker_row: z.number().int().positive().optional(),
}).strict();

export const CandidateEditRequestSchema = z.union([
  WrappedCandidateEditRequestSchema,
  TrackerCandidateEditsSchema,
]);

export const CandidateRecordSchema = z.object({
  id: CandidateIdSchema,
  candidate_source: CandidateSourceSchema,
  tracker_source: TrackerSourceSchema.nullable(),
  candidate_source_id: z.string().min(1),
  tracker_row: z.number().int().positive().nullable(),
  candidate_name: z.string().min(1).nullable(),
  current_title: z.string().nullable(),
  current_company: z.string().nullable(),
  location: z.string().nullable(),
  industry: z.string().nullable(),
  shift: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  compensation_target: z.string().nullable(),
  current_compensation: z.string().nullable(),
  compensation_context: z.string().nullable(),
  notes: z.string().nullable(),
  profile_url: z.string().nullable(),
  role_context: z.string().nullable(),
  client_context: z.string().nullable(),
  source_candidate_key: z.string().nullable(),
  source_updated_at: z.string().datetime({ offset: true }).nullable(),
  edited_at: z.string().datetime({ offset: true }).nullable(),
  is_manual: z.boolean(),
}).strict().superRefine((record, ctx) => {
  const parsedKey = parseCandidateSourceKey(record.id);
  if (!parsedKey) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["id"], message: "Invalid candidate source key" });
    return;
  }
  if (record.candidate_source !== parsedKey.candidate_source) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["candidate_source"], message: "candidate_source does not match id prefix" });
  }
  if (record.candidate_source_id.toLowerCase() !== parsedKey.candidate_source_id.toLowerCase()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["candidate_source_id"], message: "candidate_source_id does not match id suffix" });
  }
  if (record.tracker_source !== parsedKey.tracker_source) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["tracker_source"], message: "tracker_source does not match candidate_source" });
  }
  if (record.is_manual !== parsedKey.is_manual) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["is_manual"], message: "is_manual does not match candidate_source" });
  }
  if (parsedKey.is_manual) {
    if (record.tracker_row !== null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["tracker_row"], message: "Manual candidates cannot have tracker_row" });
    }
    if (!record.candidate_name || !record.candidate_name.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["candidate_name"], message: "Manual candidates must have candidate_name" });
    }
    for (const field of ["compensation_context", "profile_url", "role_context", "client_context", "source_candidate_key"]) {
      if (record[field] !== null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: `Manual candidates cannot set ${field}` });
      }
    }
  } else if (record.tracker_row === null || record.tracker_row <= 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["tracker_row"], message: "Tracker candidates require a positive tracker_row" });
  }
});

export const CandidateListQuerySchema = z.object({
  source: CandidateSourceSchema.optional(),
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
}).strict();

export const CandidateResponseSchema = z.object({
  candidate: CandidateRecordSchema,
}).strict();

export const CandidateListResponseSchema = z.object({
  candidates: z.array(CandidateRecordSchema).max(500),
}).strict();

export const SEARCH_ENTITY_TYPES = Object.freeze([
  "candidate",
  "lead",
  "job",
  "client",
  "note",
]);

export const NOTE_SUBJECT_TYPES = Object.freeze([
  "candidate",
  "job",
  "meeting",
]);

export const MIN_SEARCH_QUERY_LENGTH = 1;
export const MAX_SEARCH_QUERY_LENGTH = 200;
export const DEFAULT_SEARCH_LIMIT_PER_GROUP = 20;
export const MAX_SEARCH_LIMIT_PER_GROUP = 100;

export const SearchEntityTypeSchema = z.enum(SEARCH_ENTITY_TYPES);
export const NoteSubjectTypeSchema = z.enum(NOTE_SUBJECT_TYPES);

const SearchLimitParamSchema = z.preprocess((value) => {
  if (value === undefined) return undefined;
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return Number.NaN;
    return Number(trimmed);
  }
  return Number.NaN;
}, z.number().int().min(1).max(MAX_SEARCH_LIMIT_PER_GROUP).optional());

export const SearchQuerySchema = z.object({
  q: z.string()
    .trim()
    .min(MIN_SEARCH_QUERY_LENGTH, "Search query is required")
    .max(MAX_SEARCH_QUERY_LENGTH, `Search query must be at most ${MAX_SEARCH_QUERY_LENGTH} characters`)
    .refine((value) => !/[\r\n\0]/.test(value), "Search query cannot contain control characters"),
  limit: SearchLimitParamSchema,
  max_per_group: SearchLimitParamSchema,
}).strict().superRefine((value, ctx) => {
  if (value.limit !== undefined && value.max_per_group !== undefined && value.limit !== value.max_per_group) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["max_per_group"],
      message: "limit and max_per_group must match when both are provided",
    });
  }
}).transform((value) => {
  const resolvedLimit = value.limit ?? value.max_per_group ?? DEFAULT_SEARCH_LIMIT_PER_GROUP;
  return {
    q: value.q,
    limit: resolvedLimit,
    max_per_group: resolvedLimit,
  };
});

const NullableSearchTextSchema = z.string().trim().min(1).max(20_000).nullable();
const SearchTimestampSchema = z.string().datetime({ offset: true }).nullable();
const SearchRankSchema = z.number().finite().nonnegative();

const BaseSearchFieldsShape = {
  title: NullableSearchTextSchema,
  subtitle: NullableSearchTextSchema,
  company: NullableSearchTextSchema,
  location: NullableSearchTextSchema,
  snippet: NullableSearchTextSchema,
  updated_at: SearchTimestampSchema,
  rank: SearchRankSchema,
};

const SearchCandidateBaseObjectSchema = z.object({
  id: z.string().trim().min(1),
  entity_type: z.literal("candidate"),
  entity_id: CandidateIdSchema,
  ...BaseSearchFieldsShape,
  status: CandidateSourceSchema.nullable(),
  subject_type: z.null(),
  subject_id: z.null(),
}).strict();

const SearchLeadBaseObjectSchema = z.object({
  id: z.string().trim().min(1),
  entity_type: z.literal("lead"),
  entity_id: SupabaseUserIdSchema.transform((value) => value.toLowerCase()),
  ...BaseSearchFieldsShape,
  status: NullableSearchTextSchema,
  subject_type: z.null(),
  subject_id: z.null(),
}).strict();

const SearchJobIdSchema = z.string().trim().refine((value) => {
  if (!POSITIVE_INT_ID_PATTERN.test(value)) return false;
  const num = Number(value);
  return Number.isSafeInteger(num) && num > 0;
}, "Job entity_id must be a positive integer string");

const SearchJobBaseObjectSchema = z.object({
  id: z.string().trim().min(1),
  entity_type: z.literal("job"),
  entity_id: SearchJobIdSchema,
  ...BaseSearchFieldsShape,
  status: NullableSearchTextSchema,
  subject_type: z.null(),
  subject_id: z.null(),
}).strict();

const SearchClientBaseObjectSchema = z.object({
  id: z.string().trim().min(1),
  entity_type: z.literal("client"),
  entity_id: z.string().trim().min(1).max(500),
  ...BaseSearchFieldsShape,
  status: NullableSearchTextSchema,
  subject_type: z.null(),
  subject_id: z.null(),
}).strict();

const SearchNoteBaseObjectSchema = z.object({
  id: z.string().trim().min(1),
  entity_type: z.literal("note"),
  entity_id: SupabaseUserIdSchema.transform((value) => value.toLowerCase()),
  ...BaseSearchFieldsShape,
  status: NullableSearchTextSchema,
  subject_type: NoteSubjectTypeSchema.nullable(),
  subject_id: z.string().trim().min(1).max(500).nullable(),
}).strict();

function refineSearchItem(item, ctx) {
  if (item.entity_type === "candidate") {
    const parsedKey = parseCandidateSourceKey(item.entity_id);
    if (!parsedKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["entity_id"],
        message: "Candidate search result entity_id must be a valid candidate source key",
      });
      return;
    }
    if (item.id !== `candidate:${parsedKey.id}`) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["id"],
        message: "Candidate search result id must match candidate:<entity_id>",
      });
    }
    if (item.status !== null && item.status !== parsedKey.candidate_source) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["status"],
        message: "Candidate search result status must match candidate_source",
      });
    }
    return;
  }

  if (item.entity_type === "lead") {
    if (item.id.toLowerCase() !== `lead:${item.entity_id.toLowerCase()}`) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["id"],
        message: "Lead search result id must match lead:<entity_id>",
      });
    }
    return;
  }

  if (item.entity_type === "job") {
    if (item.id !== `job:${item.entity_id}`) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["id"],
        message: "Job search result id must match job:<entity_id>",
      });
    }
    return;
  }

  if (item.entity_type === "client") {
    const expectedClientId = `client:${item.entity_id.trim().toLowerCase()}`;
    if (item.id !== expectedClientId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["id"],
        message: "Client search result id must match client:<lower(entity_id)>",
      });
    }
    return;
  }

  if (item.entity_type === "note") {
    if (item.id.toLowerCase() !== `note:${item.entity_id.toLowerCase()}`) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["id"],
        message: "Note search result id must match note:<entity_id>",
      });
    }
    const hasSubjectType = item.subject_type !== null;
    const hasSubjectId = item.subject_id !== null;
    if (hasSubjectType !== hasSubjectId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["subject_id"],
        message: "Note subject_type and subject_id must both be present or both be null",
      });
      return;
    }
    if (item.subject_type === "candidate" && item.subject_id !== null && !parseCandidateSourceKey(item.subject_id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["subject_id"],
        message: "Candidate note subject_id must be a valid candidate source key",
      });
    }
  }
}

export const SearchCandidateResultSchema = SearchCandidateBaseObjectSchema.superRefine(refineSearchItem);
export const SearchLeadResultSchema = SearchLeadBaseObjectSchema.superRefine(refineSearchItem);
export const SearchJobResultSchema = SearchJobBaseObjectSchema.superRefine(refineSearchItem);
export const SearchClientResultSchema = SearchClientBaseObjectSchema.superRefine(refineSearchItem);
export const SearchNoteResultSchema = SearchNoteBaseObjectSchema.superRefine(refineSearchItem);

export const SearchResultItemSchema = z.discriminatedUnion("entity_type", [
  SearchCandidateBaseObjectSchema,
  SearchLeadBaseObjectSchema,
  SearchJobBaseObjectSchema,
  SearchClientBaseObjectSchema,
  SearchNoteBaseObjectSchema,
]).superRefine(refineSearchItem);

export const SearchGroupsSchema = z.object({
  candidates: z.array(SearchCandidateResultSchema).max(MAX_SEARCH_LIMIT_PER_GROUP),
  leads: z.array(SearchLeadResultSchema).max(MAX_SEARCH_LIMIT_PER_GROUP),
  jobs: z.array(SearchJobResultSchema).max(MAX_SEARCH_LIMIT_PER_GROUP),
  clients: z.array(SearchClientResultSchema).max(MAX_SEARCH_LIMIT_PER_GROUP),
  notes: z.array(SearchNoteResultSchema).max(MAX_SEARCH_LIMIT_PER_GROUP),
}).strict();

export const SearchResponseSchema = z.object({
  query: z.string().trim().min(MIN_SEARCH_QUERY_LENGTH).max(MAX_SEARCH_QUERY_LENGTH),
  limit: z.number().int().min(1).max(MAX_SEARCH_LIMIT_PER_GROUP),
  results: z.array(SearchResultItemSchema).max(MAX_SEARCH_LIMIT_PER_GROUP * SEARCH_ENTITY_TYPES.length),
  groups: SearchGroupsSchema,
  candidates: z.array(SearchCandidateResultSchema).max(MAX_SEARCH_LIMIT_PER_GROUP),
  leads: z.array(SearchLeadResultSchema).max(MAX_SEARCH_LIMIT_PER_GROUP),
  jobs: z.array(SearchJobResultSchema).max(MAX_SEARCH_LIMIT_PER_GROUP),
  clients: z.array(SearchClientResultSchema).max(MAX_SEARCH_LIMIT_PER_GROUP),
  notes: z.array(SearchNoteResultSchema).max(MAX_SEARCH_LIMIT_PER_GROUP),
}).strict().superRefine((value, ctx) => {
  const counts = {
    candidate: 0,
    lead: 0,
    job: 0,
    client: 0,
    note: 0,
  };
  for (const item of value.results) {
    counts[item.entity_type] += 1;
    if (counts[item.entity_type] > value.limit) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["results"],
        message: `Result group ${item.entity_type} exceeds limit ${value.limit}`,
      });
      break;
    }
  }

  const groupMappings = [
    ["candidates", "candidate"],
    ["leads", "lead"],
    ["jobs", "job"],
    ["clients", "client"],
    ["notes", "note"],
  ];

  for (const [groupKey, entityType] of groupMappings) {
    if (value[groupKey].length > value.limit) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [groupKey],
        message: `Group ${groupKey} exceeds limit ${value.limit}`,
      });
    }
    if (value.groups[groupKey].length > value.limit) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["groups", groupKey],
        message: `Group groups.${groupKey} exceeds limit ${value.limit}`,
      });
    }
    const expectedIds = value.results
      .filter((item) => item.entity_type === entityType)
      .map((item) => item.id);
    const topIds = value[groupKey].map((item) => item.id);
    const nestedIds = value.groups[groupKey].map((item) => item.id);
    if (topIds.length !== expectedIds.length || topIds.some((id, idx) => id !== expectedIds[idx])) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [groupKey],
        message: `${groupKey} must match filtered results for ${entityType}`,
      });
    }
    if (nestedIds.length !== expectedIds.length || nestedIds.some((id, idx) => id !== expectedIds[idx])) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["groups", groupKey],
        message: `groups.${groupKey} must match filtered results for ${entityType}`,
      });
    }
  }
});
