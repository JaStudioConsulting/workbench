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

export const SEARCH_ENTITY_TYPES = Object.freeze(["candidate", "lead", "job", "client", "note"]);

export const WORKBENCH_SUBJECT_TYPES = Object.freeze([
  "candidate",
  "job",
  "meeting",
]);

export const NOTE_SUBJECT_TYPES = WORKBENCH_SUBJECT_TYPES;
export const BOARD_SUBJECT_TYPES = WORKBENCH_SUBJECT_TYPES;

export const WorkbenchSubjectTypeSchema = z.enum(WORKBENCH_SUBJECT_TYPES);
export const NoteSubjectTypeSchema = WorkbenchSubjectTypeSchema;
export const BoardSubjectTypeSchema = WorkbenchSubjectTypeSchema;

export const NoteIdSchema = SupabaseUserIdSchema.transform((value) => value.toLowerCase());
export const BoardIdSchema = SupabaseUserIdSchema.transform((value) => value.toLowerCase());
export const MeetingSubjectIdSchema = SupabaseUserIdSchema.transform((value) => value.toLowerCase());

export const JobSubjectIdSchema = z.string().trim().refine((value) => {
  if (!POSITIVE_INT_ID_PATTERN.test(value)) return false;
  const numericId = Number(value);
  return Number.isSafeInteger(numericId) && numericId > 0;
}, "Job subject_id must be a positive integer string");

export const MAX_WORKBENCH_TITLE_LENGTH = 300;
export const MAX_NOTE_BODY_BYTES = 64 * 1024;
export const MAX_NOTE_BODY_DEPTH = 16;
export const MAX_NOTE_BODY_NODES = 2_000;
export const MAX_NOTE_TEXT_LENGTH = 20_000;
export const MAX_BOARD_SCENE_BYTES = 96 * 1024;
export const MAX_BOARD_SCENE_DEPTH = 16;
export const MAX_BOARD_ELEMENTS = 1_000;
export const MAX_BOARD_FILES = 50;

const FORBIDDEN_OBJECT_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const IDENTIFIER_TOKEN_PATTERN = /^[a-zA-Z0-9_:-]{1,100}$/;

function isPlainJsonObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function measureJsonTree(root, { maxDepth, maxNodes }) {
  let nodeCount = 0;

  function visit(current, depth) {
    if (depth > maxDepth) {
      return { ok: false, reason: `JSON structure exceeds maximum depth of ${maxDepth}` };
    }
    if (current === null) return { ok: true };
    const valueType = typeof current;
    if (valueType === "string" || valueType === "boolean") return { ok: true };
    if (valueType === "number") {
      return Number.isFinite(current)
        ? { ok: true }
        : { ok: false, reason: "JSON numbers must be finite" };
    }
    if (Array.isArray(current)) {
      nodeCount += 1;
      if (nodeCount > maxNodes) {
        return { ok: false, reason: `JSON structure exceeds maximum of ${maxNodes} container nodes` };
      }
      for (const item of current) {
        const res = visit(item, depth + 1);
        if (!res.ok) return res;
      }
      return { ok: true };
    }
    if (isPlainJsonObject(current)) {
      nodeCount += 1;
      if (nodeCount > maxNodes) {
        return { ok: false, reason: `JSON structure exceeds maximum of ${maxNodes} container nodes` };
      }
      for (const key of Object.keys(current)) {
        if (FORBIDDEN_OBJECT_KEYS.has(key)) {
          return { ok: false, reason: `Forbidden JSON property key: ${key}` };
        }
        const res = visit(current[key], depth + 1);
        if (!res.ok) return res;
      }
      return { ok: true };
    }
    return { ok: false, reason: "Unsupported JSON value type" };
  }

  return visit(root, 0);
}

function utf8ByteLength(value) {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export function parseWorkbenchSubjectLink(input) {
  if (!input || typeof input !== "object") return null;
  const rawType = input.subject_type;
  const rawId = input.subject_id;

  if (rawType == null && rawId == null) {
    return Object.freeze({ subject_type: null, subject_id: null });
  }
  if ((rawType == null) !== (rawId == null)) {
    return null;
  }
  if (typeof rawType !== "string" || typeof rawId !== "string") {
    return null;
  }

  const subjectType = rawType.trim();
  const trimmedId = rawId.trim();
  if (!WORKBENCH_SUBJECT_TYPES.includes(subjectType) || !trimmedId || /[\r\n\0]/.test(trimmedId)) {
    return null;
  }

  if (subjectType === "candidate") {
    const parsedCandidate = parseCandidateSourceKey(trimmedId);
    if (!parsedCandidate) return null;
    return Object.freeze({
      subject_type: "candidate",
      subject_id: parsedCandidate.id,
    });
  }

  if (subjectType === "job") {
    if (!POSITIVE_INT_ID_PATTERN.test(trimmedId)) return null;
    const numericId = Number(trimmedId);
    if (!Number.isSafeInteger(numericId) || numericId <= 0) return null;
    return Object.freeze({
      subject_type: "job",
      subject_id: trimmedId,
    });
  }

  if (subjectType === "meeting") {
    const parsedUuid = SupabaseUserIdSchema.safeParse(trimmedId);
    if (!parsedUuid.success) return null;
    return Object.freeze({
      subject_type: "meeting",
      subject_id: parsedUuid.data.toLowerCase(),
    });
  }

  return null;
}

export const WorkbenchSubjectLinkSchema = z.object({
  subject_type: WorkbenchSubjectTypeSchema.nullable(),
  subject_id: z.string().trim().min(1).max(200).nullable(),
}).strict().superRefine((value, ctx) => {
  const parsed = parseWorkbenchSubjectLink(value);
  if (!parsed) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: value.subject_type == null ? ["subject_type"] : ["subject_id"],
      message: "subject_type and subject_id must both be null or a valid candidate, job, or meeting reference",
    });
  }
}).transform((value) => parseWorkbenchSubjectLink(value));

const ALLOWED_NOTE_ROOT_KEYS = new Set(["type", "content", "attrs"]);
const ALLOWED_NOTE_NODE_KEYS = new Set(["type", "attrs", "content", "marks", "text"]);
const ALLOWED_NOTE_MARK_KEYS = new Set(["type", "attrs"]);

function validateNoteEditorNode(node, path, depth) {
  if (depth > MAX_NOTE_BODY_DEPTH) {
    return { ok: false, path, message: `Note editor node exceeds maximum depth of ${MAX_NOTE_BODY_DEPTH}` };
  }
  if (!isPlainJsonObject(node)) {
    return { ok: false, path, message: "Note content node must be a JSON object" };
  }
  for (const key of Object.keys(node)) {
    if (!ALLOWED_NOTE_NODE_KEYS.has(key) || FORBIDDEN_OBJECT_KEYS.has(key)) {
      return { ok: false, path: [...path, key], message: `Unsupported note editor node key: ${key}` };
    }
  }
  if (typeof node.type !== "string" || !IDENTIFIER_TOKEN_PATTERN.test(node.type.trim())) {
    return { ok: false, path: [...path, "type"], message: "Note editor node requires a valid type string" };
  }
  if (node.attrs !== undefined && node.attrs !== null && !isPlainJsonObject(node.attrs)) {
    return { ok: false, path: [...path, "attrs"], message: "Note editor node attrs must be a JSON object or null" };
  }
  if (node.text !== undefined) {
    if (typeof node.text !== "string") {
      return { ok: false, path: [...path, "text"], message: "Note editor node text must be a string" };
    }
    if (node.text.length > MAX_NOTE_TEXT_LENGTH) {
      return { ok: false, path: [...path, "text"], message: `Note text node exceeds ${MAX_NOTE_TEXT_LENGTH} characters` };
    }
    if (node.content !== undefined) {
      return { ok: false, path: [...path, "content"], message: "Note text leaf node cannot also contain child content" };
    }
  }
  if (node.marks !== undefined) {
    if (!Array.isArray(node.marks) || node.marks.length > 32) {
      return { ok: false, path: [...path, "marks"], message: "Note editor node marks must be an array of at most 32 marks" };
    }
    for (let i = 0; i < node.marks.length; i += 1) {
      const mark = node.marks[i];
      if (!isPlainJsonObject(mark)) {
        return { ok: false, path: [...path, "marks", i], message: "Note mark must be a JSON object" };
      }
      for (const key of Object.keys(mark)) {
        if (!ALLOWED_NOTE_MARK_KEYS.has(key) || FORBIDDEN_OBJECT_KEYS.has(key)) {
          return { ok: false, path: [...path, "marks", i, key], message: `Unsupported note mark key: ${key}` };
        }
      }
      if (typeof mark.type !== "string" || !IDENTIFIER_TOKEN_PATTERN.test(mark.type.trim())) {
        return { ok: false, path: [...path, "marks", i, "type"], message: "Note mark requires a valid type string" };
      }
      if (mark.attrs !== undefined && mark.attrs !== null && !isPlainJsonObject(mark.attrs)) {
        return { ok: false, path: [...path, "marks", i, "attrs"], message: "Note mark attrs must be a JSON object or null" };
      }
    }
  }
  if (node.content !== undefined) {
    if (!Array.isArray(node.content)) {
      return { ok: false, path: [...path, "content"], message: "Note editor node content must be an array" };
    }
    for (let i = 0; i < node.content.length; i += 1) {
      const childCheck = validateNoteEditorNode(node.content[i], [...path, "content", i], depth + 1);
      if (!childCheck.ok) return childCheck;
    }
  }
  return { ok: true };
}

export const NoteBodySchema = z.custom((value) => isPlainJsonObject(value), {
  message: "Note body must be a JSON object",
}).superRefine((value, ctx) => {
  if (!isPlainJsonObject(value)) return;

  const byteSize = utf8ByteLength(value);
  if (byteSize > MAX_NOTE_BODY_BYTES) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Note body exceeds maximum size of ${MAX_NOTE_BODY_BYTES} bytes`,
    });
    return;
  }

  const treeCheck = measureJsonTree(value, {
    maxDepth: MAX_NOTE_BODY_DEPTH,
    maxNodes: MAX_NOTE_BODY_NODES,
  });
  if (!treeCheck.ok) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: treeCheck.reason,
    });
    return;
  }

  const keys = Object.keys(value);
  if (keys.length === 0) {
    return;
  }

  for (const key of keys) {
    if (!ALLOWED_NOTE_ROOT_KEYS.has(key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: `Unsupported note body root key: ${key}`,
      });
      return;
    }
  }

  if (value.type !== "doc") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["type"],
      message: 'Non-empty note body must have root type "doc"',
    });
    return;
  }

  if (value.attrs !== undefined && value.attrs !== null && !isPlainJsonObject(value.attrs)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["attrs"],
      message: "Note body attrs must be a JSON object or null",
    });
    return;
  }

  if (value.content !== undefined) {
    if (!Array.isArray(value.content)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["content"],
        message: "Note body content must be an array of editor nodes",
      });
      return;
    }
    for (let i = 0; i < value.content.length; i += 1) {
      const check = validateNoteEditorNode(value.content[i], ["content", i], 1);
      if (!check.ok) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: check.path,
          message: check.message,
        });
        return;
      }
    }
  }
});

const ALLOWED_BOARD_SCENE_ROOT_KEYS = new Set([
  "type",
  "version",
  "source",
  "elements",
  "appState",
  "files",
]);

const EXCALIDRAW_NUMERIC_FIELDS = [
  "x",
  "y",
  "width",
  "height",
  "angle",
  "strokeWidth",
  "roughness",
  "opacity",
  "seed",
  "version",
  "versionNonce",
  "updated",
  "fontSize",
  "baseline",
  "lineHeight",
];

const EXCALIDRAW_STRING_FIELDS = [
  "strokeColor",
  "backgroundColor",
  "fillStyle",
  "strokeStyle",
  "text",
  "originalText",
  "link",
  "frameId",
  "containerId",
  "fileId",
  "status",
  "index",
];

function validateExcalidrawElement(element, index) {
  if (!isPlainJsonObject(element)) {
    return { ok: false, path: ["elements", index], message: "Excalidraw element must be a JSON object" };
  }
  if (typeof element.id !== "string" || !element.id.trim() || element.id.length > 200) {
    return { ok: false, path: ["elements", index, "id"], message: "Excalidraw element requires a non-empty string id" };
  }
  if (typeof element.type !== "string" || !IDENTIFIER_TOKEN_PATTERN.test(element.type.trim())) {
    return { ok: false, path: ["elements", index, "type"], message: "Excalidraw element requires a valid type string" };
  }
  for (const field of EXCALIDRAW_NUMERIC_FIELDS) {
    const val = element[field];
    if (val !== undefined && val !== null && (typeof val !== "number" || !Number.isFinite(val))) {
      return { ok: false, path: ["elements", index, field], message: `Excalidraw element ${field} must be a finite number` };
    }
  }
  for (const field of ["isDeleted", "locked"]) {
    const val = element[field];
    if (val !== undefined && typeof val !== "boolean") {
      return { ok: false, path: ["elements", index, field], message: `Excalidraw element ${field} must be a boolean` };
    }
  }
  for (const field of EXCALIDRAW_STRING_FIELDS) {
    const val = element[field];
    if (val !== undefined && val !== null && (typeof val !== "string" || val.length > 10_000)) {
      return { ok: false, path: ["elements", index, field], message: `Excalidraw element ${field} must be a string of at most 10000 characters` };
    }
  }
  for (const field of ["groupIds", "points", "scale"]) {
    const val = element[field];
    if (val !== undefined && val !== null && !Array.isArray(val)) {
      return { ok: false, path: ["elements", index, field], message: `Excalidraw element ${field} must be an array` };
    }
  }
  return { ok: true };
}

export const BoardSceneSchema = z.custom((value) => isPlainJsonObject(value), {
  message: "Board scene must be a JSON object",
}).superRefine((value, ctx) => {
  if (!isPlainJsonObject(value)) return;

  const byteSize = utf8ByteLength(value);
  if (byteSize > MAX_BOARD_SCENE_BYTES) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Board scene exceeds maximum size of ${MAX_BOARD_SCENE_BYTES} bytes`,
    });
    return;
  }

  const treeCheck = measureJsonTree(value, {
    maxDepth: MAX_BOARD_SCENE_DEPTH,
    maxNodes: MAX_BOARD_ELEMENTS * 8,
  });
  if (!treeCheck.ok) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: treeCheck.reason,
    });
    return;
  }

  const keys = Object.keys(value);
  if (keys.length === 0) {
    return;
  }

  for (const key of keys) {
    if (!ALLOWED_BOARD_SCENE_ROOT_KEYS.has(key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: `Unsupported board scene root key: ${key}`,
      });
      return;
    }
  }

  if (value.type !== undefined && value.type !== "excalidraw") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["type"],
      message: 'Board scene type must be "excalidraw" when provided',
    });
    return;
  }

  if (
    value.version !== undefined
    && (typeof value.version !== "number" || !Number.isInteger(value.version) || value.version < 1 || value.version > 1_000)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["version"],
      message: "Board scene version must be a positive integer",
    });
    return;
  }

  if (value.source !== undefined && (typeof value.source !== "string" || value.source.length > 500)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["source"],
      message: "Board scene source must be a string of at most 500 characters",
    });
    return;
  }

  if (!Array.isArray(value.elements)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["elements"],
      message: "Non-empty board scene must include an elements array",
    });
    return;
  }

  if (value.elements.length > MAX_BOARD_ELEMENTS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["elements"],
      message: `Board scene elements cannot exceed ${MAX_BOARD_ELEMENTS} items`,
    });
    return;
  }

  for (let i = 0; i < value.elements.length; i += 1) {
    const check = validateExcalidrawElement(value.elements[i], i);
    if (!check.ok) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: check.path,
        message: check.message,
      });
      return;
    }
  }

  if (value.appState !== undefined && value.appState !== null && !isPlainJsonObject(value.appState)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["appState"],
      message: "Board scene appState must be a JSON object or null",
    });
    return;
  }

  if (value.files !== undefined && value.files !== null) {
    if (!isPlainJsonObject(value.files)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["files"],
        message: "Board scene files must be a JSON object or null",
      });
      return;
    }
    const fileEntries = Object.entries(value.files);
    if (fileEntries.length > MAX_BOARD_FILES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["files"],
        message: `Board scene files cannot exceed ${MAX_BOARD_FILES} entries`,
      });
      return;
    }
    for (const [fileKey, fileVal] of fileEntries) {
      if (!isPlainJsonObject(fileVal)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["files", fileKey],
          message: "Board scene file entry must be a JSON object",
        });
        return;
      }
      if (fileVal.id !== undefined && (typeof fileVal.id !== "string" || !fileVal.id.trim() || fileVal.id.length > 200)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["files", fileKey, "id"],
          message: "Board scene file id must be a non-empty string",
        });
        return;
      }
      if (fileVal.mimeType !== undefined && (typeof fileVal.mimeType !== "string" || !fileVal.mimeType.trim() || fileVal.mimeType.length > 200)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["files", fileKey, "mimeType"],
          message: "Board scene file mimeType must be a non-empty string",
        });
        return;
      }
      if (fileVal.dataURL !== undefined && typeof fileVal.dataURL !== "string") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["files", fileKey, "dataURL"],
          message: "Board scene file dataURL must be a string",
        });
        return;
      }
    }
  }
});

const WorkbenchTitleSchema = z.string()
  .trim()
  .max(MAX_WORKBENCH_TITLE_LENGTH, `Title must be at most ${MAX_WORKBENCH_TITLE_LENGTH} characters`)
  .refine((value) => !/[\r\n\0]/.test(value), "Title cannot contain control characters");

function refineWorkbenchRecordSubject(record, ctx) {
  const parsed = parseWorkbenchSubjectLink({
    subject_type: record.subject_type,
    subject_id: record.subject_id,
  });
  if (!parsed) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: record.subject_type == null ? ["subject_type"] : ["subject_id"],
      message: "subject_type and subject_id must both be null or a valid candidate, job, or meeting key",
    });
    return;
  }
  if (parsed.subject_id !== record.subject_id) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["subject_id"],
      message: "subject_id must be normalized to canonical entity key",
    });
  }
}

export const NOTE_ORIGIN_KEY_MAX_LENGTH = 200;

export const NoteOriginKeySchema = z.string()
  .trim()
  .min(1)
  .max(NOTE_ORIGIN_KEY_MAX_LENGTH)
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), "origin_key cannot contain control characters");

export const NoteRecordSchema = z.object({
  id: NoteIdSchema,
  owner_id: SupabaseUserIdSchema.transform((value) => value.toLowerCase()),
  title: WorkbenchTitleSchema,
  subject_type: NoteSubjectTypeSchema.nullable(),
  subject_id: z.string().trim().min(1).max(200).nullable(),
  body: NoteBodySchema,
  origin_key: NoteOriginKeySchema.nullable().optional(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
}).strict().superRefine(refineWorkbenchRecordSubject);

export const BoardRecordSchema = z.object({
  id: BoardIdSchema,
  owner_id: SupabaseUserIdSchema.transform((value) => value.toLowerCase()),
  title: WorkbenchTitleSchema,
  subject_type: BoardSubjectTypeSchema.nullable(),
  subject_id: z.string().trim().min(1).max(200).nullable(),
  scene: BoardSceneSchema,
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
}).strict().superRefine(refineWorkbenchRecordSubject);

export const NoteCreateRequestSchema = z.object({
  title: WorkbenchTitleSchema.optional().default(""),
  subject_type: NoteSubjectTypeSchema.nullable().optional().default(null),
  subject_id: z.string().trim().min(1).max(200).nullable().optional().default(null),
  body: NoteBodySchema.optional().default({}),
  origin_key: NoteOriginKeySchema.nullable().optional().default(null),
}).strict().superRefine((value, ctx) => {
  const parsedLink = parseWorkbenchSubjectLink({
    subject_type: value.subject_type,
    subject_id: value.subject_id,
  });
  if (!parsedLink) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: value.subject_type == null ? ["subject_type"] : ["subject_id"],
      message: "subject_type and subject_id must both be null or a valid candidate, job, or meeting reference",
    });
  }
}).transform((value) => {
  const parsedLink = parseWorkbenchSubjectLink({
    subject_type: value.subject_type,
    subject_id: value.subject_id,
  });
  return {
    title: value.title,
    subject_type: parsedLink.subject_type,
    subject_id: parsedLink.subject_id,
    body: value.body,
    origin_key: value.origin_key,
  };
});

export const BoardCreateRequestSchema = z.object({
  title: WorkbenchTitleSchema.optional().default(""),
  subject_type: BoardSubjectTypeSchema.nullable().optional().default(null),
  subject_id: z.string().trim().min(1).max(200).nullable().optional().default(null),
  scene: BoardSceneSchema.optional().default({}),
}).strict().superRefine((value, ctx) => {
  const parsedLink = parseWorkbenchSubjectLink({
    subject_type: value.subject_type,
    subject_id: value.subject_id,
  });
  if (!parsedLink) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: value.subject_type == null ? ["subject_type"] : ["subject_id"],
      message: "subject_type and subject_id must both be null or a valid candidate, job, or meeting reference",
    });
  }
}).transform((value) => {
  const parsedLink = parseWorkbenchSubjectLink({
    subject_type: value.subject_type,
    subject_id: value.subject_id,
  });
  return {
    title: value.title,
    subject_type: parsedLink.subject_type,
    subject_id: parsedLink.subject_id,
    scene: value.scene,
  };
});

function validateWorkbenchUpdateSubject(value, ctx, contentKey) {
  const hasSubjectType = value.subject_type !== undefined;
  const hasSubjectId = value.subject_id !== undefined;
  const hasTitle = value.title !== undefined;
  const hasContent = value[contentKey] !== undefined;

  if (!hasTitle && !hasContent && !hasSubjectType && !hasSubjectId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `At least one field (title, ${contentKey}, or subject link) must be provided`,
    });
    return;
  }

  if (hasSubjectType !== hasSubjectId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: hasSubjectType ? ["subject_id"] : ["subject_type"],
      message: "subject_type and subject_id must be provided together when updating subject link",
    });
    return;
  }

  if (hasSubjectType && hasSubjectId) {
    const parsedLink = parseWorkbenchSubjectLink({
      subject_type: value.subject_type,
      subject_id: value.subject_id,
    });
    if (!parsedLink) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: value.subject_type == null ? ["subject_type"] : ["subject_id"],
        message: "subject_type and subject_id must both be null or a valid candidate, job, or meeting reference",
      });
    }
  }
}

export const NoteUpdateRequestSchema = z.object({
  title: WorkbenchTitleSchema.optional(),
  subject_type: NoteSubjectTypeSchema.nullable().optional(),
  subject_id: z.string().trim().min(1).max(200).nullable().optional(),
  body: NoteBodySchema.optional(),
  expected_updated_at: z.string().datetime({ offset: true }).optional(),
}).strict().superRefine((value, ctx) => validateWorkbenchUpdateSubject(value, ctx, "body")).transform((value) => {
  const out = {};
  if (value.title !== undefined) out.title = value.title;
  if (value.body !== undefined) out.body = value.body;
  if (value.expected_updated_at !== undefined) out.expected_updated_at = value.expected_updated_at;
  if (value.subject_type !== undefined && value.subject_id !== undefined) {
    const parsedLink = parseWorkbenchSubjectLink({
      subject_type: value.subject_type,
      subject_id: value.subject_id,
    });
    out.subject_type = parsedLink.subject_type;
    out.subject_id = parsedLink.subject_id;
  }
  return out;
});

export const NoteAutosaveRequestSchema = NoteUpdateRequestSchema;
export const NoteSaveRequestSchema = NoteUpdateRequestSchema;

export const BoardUpdateRequestSchema = z.object({
  title: WorkbenchTitleSchema.optional(),
  subject_type: BoardSubjectTypeSchema.nullable().optional(),
  subject_id: z.string().trim().min(1).max(200).nullable().optional(),
  scene: BoardSceneSchema.optional(),
  expected_updated_at: z.string().datetime({ offset: true }).optional(),
}).strict().superRefine((value, ctx) => validateWorkbenchUpdateSubject(value, ctx, "scene")).transform((value) => {
  const out = {};
  if (value.title !== undefined) out.title = value.title;
  if (value.scene !== undefined) out.scene = value.scene;
  if (value.expected_updated_at !== undefined) out.expected_updated_at = value.expected_updated_at;
  if (value.subject_type !== undefined && value.subject_id !== undefined) {
    const parsedLink = parseWorkbenchSubjectLink({
      subject_type: value.subject_type,
      subject_id: value.subject_id,
    });
    out.subject_type = parsedLink.subject_type;
    out.subject_id = parsedLink.subject_id;
  }
  return out;
});

export const BoardAutosaveRequestSchema = BoardUpdateRequestSchema;
export const BoardSaveRequestSchema = BoardUpdateRequestSchema;

const BooleanQueryParamSchema = z.preprocess((value) => {
  if (value === undefined) return undefined;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") return true;
    if (normalized === "false" || normalized === "0") return false;
  }
  return value;
}, z.boolean());

function createWorkbenchListQuerySchema() {
  return z.object({
    subject_type: WorkbenchSubjectTypeSchema.optional(),
    subject_id: z.string().trim().min(1).max(200).optional(),
    unlinked: BooleanQueryParamSchema.optional(),
    q: z.string().trim().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).max(10_000).default(0),
  }).strict().superRefine((value, ctx) => {
    if (value.unlinked === true && (value.subject_type !== undefined || value.subject_id !== undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["unlinked"],
        message: "unlinked filter cannot be combined with subject_type or subject_id",
      });
      return;
    }
    if (value.subject_id !== undefined && value.subject_type === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["subject_type"],
        message: "subject_type is required when filtering by subject_id",
      });
      return;
    }
    if (value.subject_type !== undefined && value.subject_id !== undefined) {
      const parsedLink = parseWorkbenchSubjectLink({
        subject_type: value.subject_type,
        subject_id: value.subject_id,
      });
      if (!parsedLink) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["subject_id"],
          message: `Invalid subject_id for subject_type ${value.subject_type}`,
        });
      }
    }
  }).transform((value) => {
    const out = {
      limit: value.limit,
      offset: value.offset,
    };
    if (value.unlinked !== undefined) out.unlinked = value.unlinked;
    if (value.q !== undefined && value.q.length > 0) out.q = value.q;
    if (value.subject_type !== undefined && value.subject_id !== undefined) {
      const parsedLink = parseWorkbenchSubjectLink({
        subject_type: value.subject_type,
        subject_id: value.subject_id,
      });
      out.subject_type = parsedLink.subject_type;
      out.subject_id = parsedLink.subject_id;
    } else if (value.subject_type !== undefined) {
      out.subject_type = value.subject_type;
    }
    return out;
  });
}

export const NoteListQuerySchema = createWorkbenchListQuerySchema();
export const BoardListQuerySchema = createWorkbenchListQuerySchema();

export const NoteResponseSchema = z.object({
  note: NoteRecordSchema,
}).strict();

export const NoteListResponseSchema = z.object({
  notes: z.array(NoteRecordSchema).max(200),
}).strict();

export const NoteDeleteResponseSchema = z.object({
  deleted: z.literal(true),
  id: NoteIdSchema,
}).strict();

export const BoardResponseSchema = z.object({
  board: BoardRecordSchema,
}).strict();

export const BoardListResponseSchema = z.object({
  boards: z.array(BoardRecordSchema).max(200),
}).strict();

export const BoardDeleteResponseSchema = z.object({
  deleted: z.literal(true),
  id: BoardIdSchema,
}).strict();

export const MIN_SEARCH_QUERY_LENGTH = 1;
export const MAX_SEARCH_QUERY_LENGTH = 200;
export const DEFAULT_SEARCH_LIMIT_PER_GROUP = 20;
export const MAX_SEARCH_LIMIT_PER_GROUP = 100;

export const SearchEntityTypeSchema = z.enum(SEARCH_ENTITY_TYPES);

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
