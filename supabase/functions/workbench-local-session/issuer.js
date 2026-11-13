export async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function equalHex(left, right) {
  if (typeof left !== "string" || typeof right !== "string" || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function safeSession(session, ownerId, email) {
  if (!session || session.user?.id !== ownerId || String(session.user?.email || "").trim().toLowerCase() !== email) return null;
  if (typeof session.access_token !== "string" || !session.access_token
    || typeof session.refresh_token !== "string" || !session.refresh_token) return null;
  return {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    token_type: session.token_type,
    expires_in: session.expires_in,
    expires_at: session.expires_at,
    user: { id: ownerId },
  };
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store, private", pragma: "no-cache" },
  });
}

export async function handleLocalSessionRequest(request, config) {
  if (request.method !== "POST") return json({ error: "not found" }, 404);
  if (request.body !== null) return json({ error: "invalid request" }, 400);
  const token = request.headers.get("x-workbench-session-token") || "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)
    || !/^[a-f0-9]{64}$/i.test(config.expectedTokenHash || "")
    || !config.ownerId || !config.supabaseUrl || !config.serviceRoleKey || !config.publishableKey) {
    return json({ error: "unauthorized" }, 403);
  }
  try {
    const session = await issueExistingUserSession({ ...config, token });
    return json({ session }, 200);
  } catch {
    return json({ error: "session unavailable" }, 503);
  }
}

export async function issueExistingUserSession({
  createClient,
  supabaseUrl,
  serviceRoleKey,
  publishableKey,
  ownerId,
  expectedLoginHash,
  token,
  expectedTokenHash,
}) {
  if (!/^[0-9a-f-]{36}$/i.test(ownerId || "") || !/^[a-f0-9]{64}$/i.test(expectedLoginHash || "")
    || !supabaseUrl || !serviceRoleKey || !publishableKey
    || !/^[a-f0-9]{64}$/i.test(expectedTokenHash || "")) throw new Error("not authorized");
  if (!equalHex(await sha256Hex(token || ""), expectedTokenHash.toLowerCase())) throw new Error("not authorized");

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: userResult, error: userError } = await admin.auth.admin.getUserById(ownerId);
  const user = userResult?.user;
  const email = String(user?.email || "").trim().toLowerCase();
  const bannedUntil = Date.parse(user?.banned_until || "");
  if (userError || !user || user.id !== ownerId || !email || !user.email_confirmed_at
    || user.deleted_at || (Number.isFinite(bannedUntil) && bannedUntil > Date.now())
    || !equalHex(await sha256Hex(email), expectedLoginHash.toLowerCase())) {
    throw new Error("owner unavailable");
  }

  const { data: generated, error: generationError } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (generationError || generated?.user?.id !== ownerId
    || String(generated.user.email || "").trim().toLowerCase() !== email
    || !generated?.properties?.hashed_token) throw new Error("session could not be created");

  const userClient = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: verified, error: verifyError } = await userClient.auth.verifyOtp({
    token_hash: generated.properties.hashed_token,
    type: "magiclink",
  });
  const session = safeSession(verified?.session, ownerId, email);
  if (verifyError || !session) throw new Error("session could not be verified");

  const scopedClient = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${session.access_token}` } },
  });
  const { data: authorized, error: authorizationError } = await scopedClient.rpc("is_authorized_recruiter");
  if (authorizationError || authorized !== true) throw new Error("owner is not authorized");
  return session;
}
