import Anthropic from "@anthropic-ai/sdk";
import { errorEnvelope } from "@ja/shared-types";
import { z } from "zod";

const LEVELS = ["strong", "possible", "weak", "unknown"];
const SOURCE_CITATION = /\[(?:candidate|job)\.[^\]]+\]|not in source/i;
const EvidenceSchema = z.string().trim().min(1).max(500)
  .refine((value) => !value.includes("\u2014"), "Em dashes are not allowed")
  .refine((value) => SOURCE_CITATION.test(value), "Evidence must cite a source field or say not in source");
const SpecialistSchema = z.object({
  level: z.enum(LEVELS),
  reasons: z.array(EvidenceSchema).min(1).max(4),
}).strict();
const SpecialistMapSchema = z.object({
  skills: SpecialistSchema,
  culture: SpecialistSchema,
  risk: SpecialistSchema,
  market: SpecialistSchema,
}).strict();
const FitResultSchema = z.object({
  level: z.enum(LEVELS),
  strengths: z.array(EvidenceSchema).max(6),
  gaps: z.array(EvidenceSchema).max(6),
  specialists: SpecialistMapSchema,
}).strict();
const JsonRecordSchema = z.record(z.string().max(100), z.unknown());
const FitInputSchema = z.object({ job: JsonRecordSchema, candidate: JsonRecordSchema }).strict()
  .refine((value) => JSON.stringify(value).length <= 120_000, "Fit source is too large");
const OutreachInputSchema = z.object({
  job: JsonRecordSchema,
  candidate: JsonRecordSchema,
  template: z.union([z.string().max(10_000), JsonRecordSchema]),
  body: z.string().trim().min(1).max(20_000),
}).strict().refine((value) => JSON.stringify(value).length <= 120_000, "Outreach source is too large");
const OutreachResultSchema = z.object({
  subject: z.string().trim().min(1).max(300).refine((value) => !value.includes("\u2014")),
  body: z.string().trim().min(1).max(20_000).refine((value) => !value.includes("\u2014")),
}).strict();

const SOURCE_FIELDS = {
  job: ["id", "title", "jobTitle", "company", "location", "description", "jobDescription", "summary", "industry", "skills", "requirements", "responsibilities", "processes", "compensation"],
  candidate: ["id", "candidateId", "name", "title", "currentTitle", "employer", "currentCompany", "location", "profileSummary", "fitEvidence", "gaps", "skills", "certifications", "workHistory", "additionalNotes", "fullResumeText", "activityTrail"],
};

const SPECIALISTS = {
  skills: "Evaluate resume, skills, responsibilities, and relevant experience against the role. Note exact matches and missing requirements.",
  culture: "Evaluate career trajectory, work environment signals, stability, leadership, and collaboration. Do not speculate about personality or protected traits.",
  risk: "Identify only source-supported hiring risks such as short tenures, unexplained gaps, or inconsistent progression. If dates are missing, say not in source.",
  market: "Evaluate source-supported market positioning and role alignment. Do not invent compensation, demand, or external market facts.",
};

function cleanSourceValue(value, depth = 0) {
  if (depth > 4 || value == null) return null;
  if (typeof value === "string") return value.slice(0, 20_000);
  if (["number", "boolean"].includes(typeof value)) return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => cleanSourceValue(item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).slice(0, 100).map(([key, item]) => [key, cleanSourceValue(item, depth + 1)]));
  }
  return null;
}

function sourceFields(kind, value) {
  return Object.fromEntries(SOURCE_FIELDS[kind]
    .filter((field) => value[field] !== undefined && value[field] !== "")
    .map((field) => [field, cleanSourceValue(value[field])]));
}

function sourcePayload(input) {
  return {
    job: sourceFields("job", input.job),
    candidate: sourceFields("candidate", input.candidate),
  };
}

function responseText(message) {
  return (message?.content || [])
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function parseJsonText(raw) {
  const clean = String(raw || "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  return JSON.parse(clean);
}

async function callJson(client, { model, system, prompt, schema, maxTokens = 1200 }) {
  const message = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: prompt }],
  }, { timeout: 60_000 });
  return schema.parse(parseJsonText(responseText(message)));
}

function specialistSystem(name) {
  return [
    "You are one specialist in a recruiter fit check.",
    SPECIALISTS[name],
    "Use only the supplied job and candidate JSON.",
    "Every reason must cite a field like [candidate.title] or [job.requirements].",
    "When evidence is absent, write not in source.",
    "Do not infer demographics, personality, culture, credentials, compensation, or achievements.",
    "Use levels strong, possible, weak, or unknown. Do not output numbers.",
    "Do not use em dashes.",
    'Return only JSON: {"level":"strong|possible|weak|unknown","reasons":["reason with [source.field]"]}',
  ].join("\n");
}

function summarySystem() {
  return [
    "You are a senior recruiter combining four source-grounded specialist checks.",
    "Use only the supplied source JSON and specialist results.",
    "Every strength and gap must cite [candidate.field] or [job.field], or say not in source.",
    "Do not output numbers. Do not add facts. Do not use em dashes.",
    "Return only JSON with level, strengths, and gaps. Levels are strong, possible, weak, or unknown.",
  ].join("\n");
}

async function evaluateWithAi(client, model, input) {
  const source = sourcePayload(input);
  const prompt = `Source JSON:\n${JSON.stringify(source)}`;
  const entries = await Promise.all(Object.keys(SPECIALISTS).map(async (name) => [
    name,
    await callJson(client, { model, system: specialistSystem(name), prompt, schema: SpecialistSchema }),
  ]));
  const specialists = SpecialistMapSchema.parse(Object.fromEntries(entries));
  const summary = await callJson(client, {
    model,
    system: summarySystem(),
    prompt: `Source JSON:\n${JSON.stringify(source)}\n\nSpecialist JSON:\n${JSON.stringify(specialists)}`,
    schema: z.object({
      level: z.enum(LEVELS),
      strengths: z.array(EvidenceSchema).max(6),
      gaps: z.array(EvidenceSchema).max(6),
    }).strict(),
    maxTokens: 1600,
  });
  return FitResultSchema.parse({ ...summary, specialists });
}

async function personalizeWithAi(client, model, input) {
  const source = sourcePayload(input);
  const prompt = JSON.stringify({
    source,
    template: cleanSourceValue(input.template),
    body: input.body,
  });
  return callJson(client, {
    model,
    system: [
      "Rewrite this recruiter outreach draft using one or two candidate-specific details found in source JSON.",
      "Keep the template voice, length, and intent. Do not invent details.",
      "If candidate-specific evidence is missing, keep the draft general.",
      "Do not use em dashes. This is a draft only. Never claim it was sent.",
      'Return only JSON: {"subject":"draft subject","body":"draft body"}',
    ].join("\n"),
    prompt,
    schema: OutreachResultSchema,
    maxTokens: 1400,
  });
}

function validationError(res, error) {
  return res.status(400).json(errorEnvelope("INVALID_REQUEST", error.issues?.[0]?.message || "Invalid request"));
}

function aiError(res, error) {
  const badOutput = error instanceof z.ZodError || error instanceof SyntaxError;
  return res.status(badOutput ? 502 : 500).json(errorEnvelope(
    badOutput ? "AI_INVALID_OUTPUT" : "AI_REQUEST_FAILED",
    badOutput ? "AI returned an invalid response" : "AI check failed",
  ));
}

export function registerAiRoutes(app, {
  authenticated,
  env = process.env,
  clientFactory = (apiKey) => new Anthropic({ apiKey }),
} = {}) {
  if (typeof authenticated !== "function") throw new Error("authenticated middleware is required");

  app.get("/api/ai/status", authenticated, (_req, res) => {
    res.json({ available: Boolean(env.ANTHROPIC_API_KEY) });
  });

  app.post("/api/fit/evaluate", authenticated, async (req, res) => {
    const input = FitInputSchema.safeParse(req.body);
    if (!input.success) return validationError(res, input.error);
    if (!env.ANTHROPIC_API_KEY) return res.status(503).json(errorEnvelope("AI_NOT_CONFIGURED", "AI check not set up"));
    try {
      const result = await evaluateWithAi(clientFactory(env.ANTHROPIC_API_KEY), env.ANTHROPIC_MODEL || "claude-sonnet-5-5", input.data);
      return res.json(result);
    } catch (error) {
      return aiError(res, error);
    }
  });

  app.post("/api/outreach/personalize", authenticated, async (req, res) => {
    const input = OutreachInputSchema.safeParse(req.body);
    if (!input.success) return validationError(res, input.error);
    if (!env.ANTHROPIC_API_KEY) return res.status(503).json(errorEnvelope("AI_NOT_CONFIGURED", "AI check not set up"));
    try {
      const result = await personalizeWithAi(clientFactory(env.ANTHROPIC_API_KEY), env.ANTHROPIC_MODEL || "claude-sonnet-5-5", input.data);
      return res.json(result);
    } catch (error) {
      return aiError(res, error);
    }
  });
}

export const aiSchemas = Object.freeze({ FitInputSchema, FitResultSchema, OutreachInputSchema, OutreachResultSchema });
