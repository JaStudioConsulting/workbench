import express from "express";
import { errorEnvelope, McpDiscoverySchema, SafetyStateSchema } from "@ja/shared-types";
import { createConfiguredAuth, parseExactHttpsOrigins } from "./src/auth.js";
import { prepareAfterCallWorkflow } from "./src/after-call.js";
import { createMcpRequestHandler } from "./src/mcp.js";
import { createReadOnlyNeo4jAdapter } from "./src/neo4j.js";
import { discoverMcp, loadRecruitmentAuthority } from "./src/recruitment-package.js";

function respondError(res, code, message, status = 503) {
  return res.status(status).json(errorEnvelope(code, message));
}

export function createCorsGuard(env) {
  const origins = parseExactHttpsOrigins(env.APP_TRUSTED_ORIGINS || env.AUTH_TRUSTED_ORIGINS) || [];
  return (req, res, next) => {
    const origin = req.get("origin");
    if (!origin) return next();
    if (!origins.includes(origin)) return respondError(res, "ORIGIN_FORBIDDEN", "Browser origin is not trusted", 403);
    res.set({
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Protocol-Version, Mcp-Session-Id",
      "Access-Control-Expose-Headers": "Mcp-Session-Id",
      Vary: "Origin",
    });
    if (req.method === "OPTIONS") return res.status(204).end();
    return next();
  };
}

function requireSession(auth) {
  return async (req, res, next) => {
    if (!auth.enabled) return respondError(res, "AUTH_UNAVAILABLE", auth.reason);
    const session = await auth.getSession(req);
    if (!session?.session) return respondError(res, "UNAUTHORIZED", "A valid session is required", 401);
    req.workbenchSession = session;
    return next();
  };
}

export async function createApp({ env = process.env, authorityLoader = loadRecruitmentAuthority, authConfig, mcpHandlerFactory = createMcpRequestHandler, neo4j = createReadOnlyNeo4jAdapter() } = {}) {
  const app = express();
  app.disable("x-powered-by");
  const configuredAuth = authConfig ?? await createConfiguredAuth(env);
  app.use(createCorsGuard(env));

  // Better Auth must receive raw requests. JSON parsing is intentionally mounted after it.
  if (configuredAuth.enabled) app.all("/api/auth/*", configuredAuth.handler);
  else app.all("/api/auth/*", (_req, res) => respondError(res, "AUTH_UNAVAILABLE", configuredAuth.reason));

  app.use(express.json({ limit: "128kb" }));
  app.get("/healthz", (_req, res) => res.json({ ok: true, service: "recruiting-workbench-gateway" }));
  app.get("/api/safety", (_req, res) => res.json(SafetyStateSchema.parse({
    auth: configuredAuth.enabled ? "configured" : "unavailable",
    storage: "unavailable",
    gmail: "draft_only",
    neo4j: neo4j.enabled ? "read_only" : "disabled",
    externalWrites: false,
  })));

  const authenticated = requireSession(configuredAuth);
  app.get("/api/mcp/discovery", authenticated, async (_req, res) => {
    try { return res.json(McpDiscoverySchema.parse(discoverMcp(await authorityLoader()))); }
    catch { return respondError(res, "RECRUITER_UNAVAILABLE", "Recruitment authority is unavailable"); }
  });
  app.post("/api/workflows/after-call/prepare", authenticated, async (req, res) => {
    let authority;
    try {
      authority = await authorityLoader();
    } catch { return respondError(res, "RECRUITER_UNAVAILABLE", "Recruitment authority is unavailable"); }
    try { return res.status(202).json(prepareAfterCallWorkflow(req.body, authority)); }
    catch (error) { return respondError(res, "INVALID_INPUT", error instanceof Error ? error.message : "Invalid workflow input", 400); }
  });
  app.all("/mcp", authenticated, async (req, res) => {
    if (!["GET", "POST"].includes(req.method)) return res.status(405).end();
    try { return await (await mcpHandlerFactory())(req, res); }
    catch { return respondError(res, "RECRUITER_UNAVAILABLE", "Recruitment authority is unavailable"); }
  });
  return app;
}
