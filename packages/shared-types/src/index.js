import { z } from "zod";

export const SessionSchema = z.object({
  userId: z.string().min(1),
  email: z.string().email(),
  expiresAt: z.string().datetime(),
});

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

export const ErrorEnvelopeSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

export function errorEnvelope(code, message) {
  return ErrorEnvelopeSchema.parse({ error: { code, message } });
}
