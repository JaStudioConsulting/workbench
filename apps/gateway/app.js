import express from "express";
import { registerAutomationRoutes } from "./src/automation-routes.js";
import { errorEnvelope, McpDiscoverySchema, SafetyStateSchema } from "@ja/shared-types";
import { createConfiguredAuth, getBetterAuthAvailability, parseExactHttpsOrigins } from "./src/auth.js";
import { createGoogleWorkspaceHandlers } from "./src/google-workspace-routes.js";
import { createGoogleApiHandlers } from "./src/google-api.js";
import { createMcpRequestHandler } from "./src/mcp.js";
import { discoverMcp, loadRecruitmentContext } from "./src/recruitment-package.js";
import { createNativeCaptureManager, parseByteRange } from "./src/native-capture.js";
import { registerCandidateRoutes } from "./src/candidate-routes.js";
import { registerNotesBoardsRoutes } from "./src/notes-boards-routes.js";
import { registerSearchRoutes } from "./src/search-routes.js";
import { registerTrackerImportRoutes } from "./src/tracker-import-routes.js";
import { createSupabaseRecruiterAccess } from "./src/supabase-recruiter-auth.js";
import { registerBrandedResumeEditRoutes } from "./src/branded-resume-edit-routes.js";
import { registerResumeFormatRoutes } from "./src/resume-format-routes.js";
import { getLocalSessionAvailability, registerLocalSessionRoute } from "./src/local-session.js";

function respondError(res, code, message, status = 503) {
  return res.status(status).json(errorEnvelope(code, message));
}

export function createCorsGuard(env) {
  const origins = parseExactHttpsOrigins(env.APP_TRUSTED_ORIGINS || env.AUTH_TRUSTED_ORIGINS) || [];
  return (req, res, next) => {
    const origin = req.get("origin");
    if (!origin) return next();
    const sameOrigin = origin === `${req.protocol}://${req.get("host")}`;
    if (!sameOrigin && !origins.includes(origin)) return respondError(res, "ORIGIN_FORBIDDEN", "Browser origin is not trusted", 403);
    res.set({
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Protocol-Version, Mcp-Session-Id",
      "Access-Control-Expose-Headers": "Mcp-Session-Id, Content-Disposition",
      Vary: "Origin",
    });
    if (req.method === "OPTIONS") return res.status(204).end();
    return next();
  };
}

function requireSession(auth, { authoritative = false, requireStableUser = false } = {}) {
  return async (req, res, next) => {
    if (!auth.enabled) return respondError(res, "AUTH_UNAVAILABLE", auth.reason);
    const getSession = authoritative ? auth.getAuthoritativeSession : auth.getSession;
    if (typeof getSession !== "function") return respondError(res, "AUTH_UNAVAILABLE", "Authentication is unavailable");
    const session = await getSession.call(auth, req);
    if (!session?.session) return respondError(res, "UNAUTHORIZED", "A valid session is required", 401);
    if (requireStableUser && (!session?.user?.id || !session.session.userId || session.user.id !== session.session.userId || !session.session.id)) {
      return respondError(res, "UNAUTHORIZED", "A valid session is required", 401);
    }
    if (typeof auth.isApprovedEmail !== "function" || !auth.isApprovedEmail(session?.user?.email)) {
      return respondError(res, "ACCOUNT_FORBIDDEN", "This Google account is not approved for this Workbench", 403);
    }
    req.workbenchSession = session;
    return next();
  };
}

export async function createApp({
  env = process.env,
  recruitmentContextLoader = loadRecruitmentContext,
  authConfig,
  googleWorkspaceConfig,
  googleWorkspaceOptions,
  googleApiHandlers,
  candidateStore,
  candidateFetch,
  notesBoardsStore,
  notesBoardsFetch,
  searchStore,
  searchFetch,
  trackerImportDependencies = {},
  localSessionFetch = globalThis.fetch,
  captureManager = createNativeCaptureManager(),
  mcpHandlerFactory = createMcpRequestHandler,
} = {}) {
  const app = express();
  app.disable("x-powered-by");
  const configuredAuth = authConfig ?? await createConfiguredAuth(env);
  let recruiterAuthority = null;
  let mcpHandler = null;
  try {
    const recruitmentContext = await recruitmentContextLoader();
    const initializedMcpHandler = await mcpHandlerFactory({ context: recruitmentContext });
    recruiterAuthority = recruitmentContext.authority;
    mcpHandler = initializedMcpHandler;
  } catch {
    // Keep public health and safety routes available while every recruiter route fails closed.
  }
  app.use(createCorsGuard(env));
  await captureManager.initialize?.().catch((error) => {
    console.error("Native capture initialization failed.", { error });
  });

  // Better Auth must receive raw requests. JSON parsing is intentionally mounted after it.
  registerLocalSessionRoute(app, { env, fetchImpl: localSessionFetch });
  app.get("/api/auth/workbench-status", (_req, res) => {
    res.set("Cache-Control", "private, no-store");
    return res.json({
      googleSignIn: getBetterAuthAvailability(configuredAuth),
      localDataSession: getLocalSessionAvailability(env),
    });
  });
  if (configuredAuth.enabled) app.all("/api/auth/*", configuredAuth.handler);
  else app.all("/api/auth/*", (_req, res) => respondError(res, "AUTH_UNAVAILABLE", configuredAuth.reason));

  // Import confirmations can contain up to 10,000 reviewed row choices.
  // Parse all importer requests before the gateway-wide 128 KB default.
  app.use("/api/tracker-imports", express.json({ limit: "10mb" }));
  // After-call accepts bounded source bundles (2 MiB UTF-8 source text); JSON escaping adds overhead.
  app.use("/api/workflows/after-call", express.json({ limit: "5mb" }));
  // Resume edits have a separate 1 MiB structured-content ceiling.
  app.use("/api/operator-cases", express.json({ limit: "2mb" }));
  app.use("/api/documents", express.json({ limit: "29mb" }));
  app.use("/api/automation", express.json({ limit: "2mb" }));
  // Resume text to format: at most 200,000 characters, plus JSON escaping.
  app.use("/api/resume-format", express.json({ limit: "1mb" }));
  app.use(express.json({ limit: "128kb" }));
  app.get("/healthz", (_req, res) => res.json({ ok: true, service: "recruiting-workbench-gateway" }));
  // This release has no AI execution path, regardless of installed credentials.
  app.get("/api/capabilities", (_req, res) => {
    res.set("Cache-Control", "no-store");
    return res.json({ ai: false, transcription: false, automation: true });
  });
  app.get("/api/safety", (_req, res) => res.json(SafetyStateSchema.parse({
    auth: configuredAuth.enabled ? "configured" : "unavailable",
    storage: "unavailable",
    externalWrites: false,
  })));

  const authenticated = requireSession(configuredAuth);
  const authoritativeGoogleSession = requireSession(configuredAuth, { authoritative: true, requireStableUser: true });
  const supabaseRecruiterAccess = createSupabaseRecruiterAccess({ env, fetchImpl: candidateFetch });
  registerAutomationRoutes(app, { access: supabaseRecruiterAccess, env, fetchImpl: candidateFetch || globalThis.fetch });
  registerBrandedResumeEditRoutes(app, { access: supabaseRecruiterAccess, env, fetchImpl: candidateFetch || globalThis.fetch });
  registerResumeFormatRoutes(app, { access: supabaseRecruiterAccess });
  app.get("/api/meetings/status", supabaseRecruiterAccess, async (_req, res) => {
    res.set("Cache-Control", "private, no-store");
    return res.json({
      available: false,
      transcription: false,
      transcriptionStatus: "disabled",
      enhanced: env.WORKBENCH_NATIVE_MEETING_ENHANCEMENTS === "1",
      captureAvailable: await captureManager.available?.() || false,
    });
  });
  app.post("/api/meetings/transcribe", supabaseRecruiterAccess, (_req, res) => {
    return respondError(res, "AI_DISABLED", "AI and transcription are disabled in this release", 409);
  });
  app.post("/api/meetings/capture/start", supabaseRecruiterAccess, async (req, res) => {
    try {
      const capture = await captureManager.start({ jobId: req.body?.jobId, candidateId: req.body?.candidateId, ownerId: req.supabaseRecruiter.ownerId });
      return res.status(201).json({ ok: true, capture });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Native meeting capture could not start";
      const status = /required|invalid/i.test(message) ? 400 : 503;
      return respondError(res, "CAPTURE_START_FAILED", message, status);
    }
  });
  const captureFinalizations = new Map();
  async function finalizeCapture(id, ownerId) {
    const persisted = await captureManager.loadFinalizedResponse?.(id, ownerId);
    if (persisted) return persisted;
    const capture = await captureManager.stop(id, ownerId);
    // Audio finalization must never start transcription. Existing saved transcripts
    // remain readable through the persisted-response branch above.
    const response = {
      ok: true,
      capture: {
        id: capture.id,
        status: capture.state,
        warning: capture.warning || null,
        audioUrl: `/api/meetings/capture/${capture.id}/audio`,
        jobId: capture.jobId,
        candidateId: capture.candidateId,
      },
      transcription: {
        status: "disabled",
        source: "workbench_native",
        model: null,
        warning: null,
      },
      transcript: "",
      segments: [],
      speakers: [],
    };
    await captureManager.saveFinalizedResponse?.(id, ownerId, response);
    return response;
  }
  function serializedFinalization(id, ownerId) {
    const now = Date.now();
    for (const [key, entry] of captureFinalizations) {
      if (entry.expiresAt <= now) captureFinalizations.delete(key);
    }
    const key = `${ownerId}:${id}`;
    const existing = captureFinalizations.get(key);
    if (existing) return existing.promise;
    const promise = finalizeCapture(id, ownerId).catch((error) => {
      captureFinalizations.delete(key);
      throw error;
    });
    captureFinalizations.set(key, { promise, expiresAt: now + 15 * 60_000 });
    while (captureFinalizations.size > 100) captureFinalizations.delete(captureFinalizations.keys().next().value);
    return promise;
  }
  app.post("/api/meetings/capture/:id/stop", supabaseRecruiterAccess, async (req, res) => {
    try {
      return res.json(await serializedFinalization(req.params.id, req.supabaseRecruiter.ownerId));
    } catch (error) {
      return respondError(res, "CAPTURE_STOP_FAILED", error instanceof Error ? error.message : "Native capture could not stop", 502);
    }
  });
  app.get("/api/meetings/capture/:id/audio", supabaseRecruiterAccess, async (req, res) => {
    try {
      const audio = await captureManager.audioInfo(req.params.id, String(req.query.source || "mixed"), req.supabaseRecruiter.ownerId);
      const range = parseByteRange(req.get("range"), audio.size);
      res.set({
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, no-store",
        "Content-Type": audio.contentType,
        "Content-Disposition": 'inline; filename="meeting-recording.wav"',
      });
      if (range) {
        res.status(206).set({ "Content-Range": `bytes ${range.start}-${range.end}/${audio.size}`, "Content-Length": String(range.end - range.start + 1) });
        return audio.stream(range).pipe(res);
      }
      res.set("Content-Length", String(audio.size));
      return audio.stream().pipe(res);
    } catch (error) {
      const status = /range/i.test(error?.message || "") ? 416 : 404;
      return respondError(res, "CAPTURE_AUDIO_UNAVAILABLE", "Capture audio is unavailable", status);
    }
  });
  const googleWorkspace = googleWorkspaceConfig ?? createGoogleWorkspaceHandlers({ env, auth: configuredAuth, ...googleWorkspaceOptions });
  const googleWorkspaceHandler = (name) => async (req, res) => {
    if (!googleWorkspace.enabled || typeof googleWorkspace[name] !== "function") {
      res.set("Cache-Control", "private, no-store");
      return respondError(res, "GOOGLE_WORKSPACE_UNAVAILABLE", googleWorkspace.reason || "Google Workspace authorization is unavailable");
    }
    return googleWorkspace[name](req, res);
  };
  const googleApi = googleApiHandlers ?? (typeof configuredAuth.getGoogleProviderAccessToken === "function"
    ? createGoogleApiHandlers({ auth: configuredAuth })
    : { sync: (_req, res) => respondError(res, "GOOGLE_WORKSPACE_UNAVAILABLE", "Google Workspace authorization is unavailable") });
  app.get("/api/google-workspace/status", authoritativeGoogleSession, googleWorkspaceHandler("status"));
  app.get("/api/google-workspace/calendar/upcoming", authoritativeGoogleSession, googleWorkspaceHandler("upcomingEvents"));
  if (googleWorkspace.legacyEnabled) {
    app.post("/api/google-workspace/oauth/start", authoritativeGoogleSession, googleWorkspaceHandler("start"));
    app.get("/api/google-workspace/oauth/callback", authoritativeGoogleSession, googleWorkspaceHandler("callback"));
    app.post("/api/google-workspace/disconnect", authoritativeGoogleSession, googleWorkspaceHandler("disconnect"));
  }
  app.post("/api/gws/sync", authoritativeGoogleSession, googleApi.sync);
  registerCandidateRoutes(app, {
    env,
    authConfig: configuredAuth,
    candidateStore,
    fetchImpl: candidateFetch,
  });
  registerNotesBoardsRoutes(app, {
    env,
    authConfig: configuredAuth,
    notesBoardsStore,
    fetchImpl: notesBoardsFetch ?? candidateFetch,
  });
  registerSearchRoutes(app, {
    env,
    authConfig: configuredAuth,
    searchStore,
    fetchImpl: searchFetch ?? candidateFetch,
  });
  registerTrackerImportRoutes(app, {
    ...trackerImportDependencies,
    env,
    auth: configuredAuth,
    authenticated: supabaseRecruiterAccess,
    googleAuthenticated: authoritativeGoogleSession,
    fetchImpl: candidateFetch,
  });
  app.get("/api/mcp/discovery", authenticated, async (_req, res) => {
    try { return res.json(McpDiscoverySchema.parse(discoverMcp(recruiterAuthority))); }
    catch { return respondError(res, "RECRUITER_UNAVAILABLE", "Recruitment authority is unavailable"); }
  });
  app.post("/api/workflows/after-call/prepare", supabaseRecruiterAccess, (_req, res) => {
    return respondError(res, "AI_DISABLED", "AI and transcription are disabled in this release", 409);
  });
  app.all("/mcp", authenticated, async (req, res) => {
    if (!["GET", "POST"].includes(req.method)) return res.status(405).end();
    if (!mcpHandler) return respondError(res, "RECRUITER_UNAVAILABLE", "Recruitment authority is unavailable");
    try { return await mcpHandler(req, res); }
    catch { return respondError(res, "RECRUITER_UNAVAILABLE", "Recruitment authority is unavailable"); }
  });
  app.use((error, _req, res, _next) => {
    if (error?.type === "entity.too.large" || error?.status === 413) {
      return respondError(res, "PAYLOAD_TOO_LARGE", "Request is too large. Shorten the source text or split the transcript, then try again.", 413);
    }
    if (error instanceof SyntaxError && Object.hasOwn(error, "body")) {
      return respondError(res, "INVALID_JSON", "Request body must be valid JSON", 400);
    }
    return respondError(res, "REQUEST_FAILED", "The request could not be processed", 400);
  });
  return app;
}
