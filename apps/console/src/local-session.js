import { supabase } from "./supabase-client.js";

const LOCAL_SESSION_ERROR = "Workbench could not open this private session. Check your connection and try again.";
let localSessionRequest = null;

/** Install the ordinary Supabase session returned by the private local gateway. */
async function installLocalWorkbenchSession({
  client = supabase,
  fetchImpl = globalThis.fetch,
  endpoint = "/api/auth/local-session",
  expectedUserId,
} = {}) {
  if (typeof fetchImpl !== "function" || !expectedUserId || !client?.auth?.setSession || !client?.auth?.getSession || !client?.auth?.getUser) {
    throw new Error(LOCAL_SESSION_ERROR);
  }

  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
  } catch {
    throw new Error(LOCAL_SESSION_ERROR);
  }

  if (!response?.ok) throw new Error(LOCAL_SESSION_ERROR);

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(LOCAL_SESSION_ERROR);
  }
  const accessToken = payload?.session?.access_token;
  const refreshToken = payload?.session?.refresh_token;
  if (typeof accessToken !== "string" || !accessToken.trim()
    || typeof refreshToken !== "string" || !refreshToken.trim()) {
    throw new Error(LOCAL_SESSION_ERROR);
  }

  try {
    const { error } = await client.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
    if (error) throw error;
    const { data: verifiedData, error: verificationError } = await client.auth.getUser();
    if (verificationError || verifiedData?.user?.id !== expectedUserId) {
      await client.auth.signOut?.();
      throw verificationError || new Error("Unexpected local session owner");
    }
    const { data, error: readError } = await client.auth.getSession();
    if (readError || !data?.session?.access_token || !data?.session?.user?.id) throw readError || new Error("Missing session");
    if (data.session.user.id !== expectedUserId) {
      await client.auth.signOut?.();
      throw new Error("Unexpected local session owner");
    }
    return { ...data.session, user: verifiedData.user };
  } catch {
    throw new Error(LOCAL_SESSION_ERROR);
  }
}

// React StrictMode mounts effects twice in development. Share one mint request
// so that two one-time server tokens cannot race to replace one another.
export function openLocalWorkbenchSession(options = {}) {
  if (localSessionRequest) return localSessionRequest;
  localSessionRequest = installLocalWorkbenchSession(options).finally(() => {
    localSessionRequest = null;
  });
  return localSessionRequest;
}

/** Verify a restored browser session against the Auth server before reusing it. */
export async function getVerifiedLocalWorkbenchSession({ client = supabase, expectedUserId } = {}) {
  if (!expectedUserId || !client?.auth?.getUser || !client?.auth?.getSession) return null;
  try {
    const { data: verifiedData, error: verificationError } = await client.auth.getUser();
    if (verificationError || verifiedData?.user?.id !== expectedUserId) return null;
    const { data, error } = await client.auth.getSession();
    if (error || !data?.session?.access_token || !data?.session?.refresh_token) return null;
    return { ...data.session, user: verifiedData.user };
  } catch {
    return null;
  }
}

export { LOCAL_SESSION_ERROR };
