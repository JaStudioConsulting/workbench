import express from "express";
import { errorEnvelope, McpDiscoverySchema, SafetyStateSchema } from "@ja/shared-types";
import { createConfiguredAuth, parseExactHttpsOrigins } from "./src/auth.js";
import { createGoogleWorkspaceHandlers } from "./src/google-workspace-routes.js";
import { createGoogleApiHandlers } from "./src/google-api.js";
import { prepareAfterCallWorkflow } from "./src/after-call.js";
import { createMcpRequestHandler } from "./src/mcp.js";
import { createReadOnlyNeo4jAdapter } from "./src/neo4j.js";
import { discoverMcp, loadRecruitmentContext } from "./src/recruitment-package.js";
import { createLocalTranscriptionAdapter, meetingAudioBody } from "./src/local-transcription.js";
import { createNativeCaptureManager, parseByteRange } from "./src/native-capture.js";
import { createMeetingTranscriptionAccess } from "./src/local-trust.js";
import { registerAiRoutes } from "./src/ai-routes.js";
import { registerCandidateRoutes } from "./src/candidate-routes.js";
import { registerMailRoutes } from "./src/mail-routes.js";
import { registerNotesBoardsRoutes } from "./src/notes-boards-routes.js";
import { registerSearchRoutes } from "./src/search-routes.js";

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
      "Access-Control-Expose-Headers": "Mcp-Session-Id",
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
  transcriptionAdapter = createLocalTranscriptionAdapter(),
  captureManager = createNativeCaptureManager(),
  mcpHandlerFactory = createMcpRequestHandler,
  neo4j = createReadOnlyNeo4jAdapter(),
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
  await captureManager.initialize?.().catch(() => {});

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
  const authoritativeGoogleSession = requireSession(configuredAuth, { authoritative: true, requireStableUser: true });
  const meetingTranscriptionAccess = createMeetingTranscriptionAccess({ env, authenticated });
  app.get("/api/meetings/status", meetingTranscriptionAccess, async (_req, res) => {
    res.set("Cache-Control", "private, no-store");
    return res.json({
      available: await transcriptionAdapter.available(),
      enhanced: env.WORKBENCH_NATIVE_MEETING_ENHANCEMENTS === "1",
      captureAvailable: await captureManager.available?.() || false,
    });
  });
  app.post("/api/meetings/transcribe", meetingTranscriptionAccess, express.raw(meetingAudioBody), async (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return respondError(res, "INVALID_INPUT", "Meeting audio is required", 400);
    }
    if (!await transcriptionAdapter.available()) {
      return respondError(res, "TRANSCRIPTION_UNAVAILABLE", "Local transcription is unavailable");
    }
    try {
      return res.json({ ok: true, ...await transcriptionAdapter.transcribe({
        audio: req.body,
        contentType: req.get("content-type"),
      }) });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Meeting transcription failed";
      const status = /unsupported|empty|required/i.test(message) ? 400 : 502;
      return respondError(res, "TRANSCRIPTION_FAILED", message, status);
    }
  });
  app.post("/api/meetings/capture/start", authoritativeGoogleSession, async (req, res) => {
    try {
      const capture = await captureManager.start({ jobId: req.body?.jobId, candidateId: req.body?.candidateId, ownerId: req.workbenchSession.user.id });
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
    const tracks = [];
    for (const source of ["microphone", "system"]) {
      const audio = await captureManager.audioInfo(id, source, ownerId).catch(() => null);
      if (!audio) continue;
      try {
        const result = await transcriptionAdapter.transcribeFile({ path: audio.path });
        const fallbackSpeaker = source === "microphone" ? "You" : "Remote speaker";
        const segments = result.segments?.length
          ? result.segments.map((segment) => ({ ...segment, source, speaker: source === "microphone" ? "You" : (segment.speaker || fallbackSpeaker) }))
          : [{ start: 0, end: 0, text: result.transcript, source, speaker: fallbackSpeaker }];
        tracks.push({ source, result, segments });
      } catch (error) {
        tracks.push({ source, error: error instanceof Error ? error.message : "Transcription failed", segments: [] });
      }
    }
    const segments = tracks.flatMap((track) => track.segments).sort((left, right) => left.start - right.start || left.end - right.end);
    const speakers = [...new Set(segments.map((segment) => segment.speaker).filter(Boolean))];
    const transcript = [];
    for (const segment of segments) {
      const previous = transcript.at(-1);
      if (previous?.speaker === segment.speaker) previous.text += ` ${segment.text}`;
      else transcript.push({ speaker: segment.speaker || "Speaker", text: segment.text });
    }
    const warnings = [capture.warning, ...tracks.map((track) => track.error || track.result?.warning)].filter(Boolean);
    const transcriptionReady = transcript.length > 0;
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
        status: transcriptionReady ? "ready" : "failed",
        source: "workbench_native",
        model: tracks.find((track) => track.result?.model)?.result.model || null,
        warning: warnings.join(" ") || null,
      },
      transcript: transcript.map((turn) => `${turn.speaker}: ${turn.text}`).join("\n"),
      segments,
      speakers,
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
  app.post("/api/meetings/capture/:id/stop", authoritativeGoogleSession, async (req, res) => {
    try {
      return res.json(await serializedFinalization(req.params.id, req.workbenchSession.user.id));
    } catch (error) {
      return respondError(res, "CAPTURE_STOP_FAILED", error instanceof Error ? error.message : "Native capture could not stop", 502);
    }
  });
  app.get("/api/meetings/capture/:id/audio", authoritativeGoogleSession, async (req, res) => {
    try {
      const audio = await captureManager.audioInfo(req.params.id, String(req.query.source || "mixed"), req.workbenchSession.user.id);
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
  // AI routes accept the same private-network trust as meetings when LOCAL_TRUSTED_MODE=1.
  registerAiRoutes(app, { authenticated: meetingTranscriptionAccess, env });
  registerMailRoutes(app, {
    authenticated: authoritativeGoogleSession,
    getGoogleProviderAccessToken: configuredAuth.getGoogleProviderAccessToken?.bind(configuredAuth),
  });
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
  app.get("/api/mcp/discovery", authenticated, async (_req, res) => {
    try { return res.json(McpDiscoverySchema.parse(discoverMcp(recruiterAuthority))); }
    catch { return respondError(res, "RECRUITER_UNAVAILABLE", "Recruitment authority is unavailable"); }
  });
  app.post("/api/workflows/after-call/prepare", authenticated, async (req, res) => {
    if (!recruiterAuthority) return respondError(res, "RECRUITER_UNAVAILABLE", "Recruitment authority is unavailable");
    try { return res.status(202).json(prepareAfterCallWorkflow(req.body, recruiterAuthority)); }
    catch (error) { return respondError(res, "INVALID_INPUT", error instanceof Error ? error.message : "Invalid workflow input", 400); }
  });
  app.all("/mcp", authenticated, async (req, res) => {
    if (!["GET", "POST"].includes(req.method)) return res.status(405).end();
    if (!mcpHandler) return respondError(res, "RECRUITER_UNAVAILABLE", "Recruitment authority is unavailable");
    try { return await mcpHandler(req, res); }
    catch { return respondError(res, "RECRUITER_UNAVAILABLE", "Recruitment authority is unavailable"); }
  });
  return app;
}
