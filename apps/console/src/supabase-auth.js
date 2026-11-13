import { supabase } from "./supabase-client.js";

export const SIGN_IN_LINK_MESSAGE = "If this email has an existing Workbench account, open the sign-in link sent to your inbox.";
export const SIGN_IN_LINK_ERROR_MESSAGE = "Unable to send a sign-in link. Check your connection and try again. If the problem continues, try again later.";

const NON_ENUMERATING_AUTH_ERROR_CODES = new Set(["user_not_found", "signup_disabled"]);

function normalizedEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export async function requestExistingAccountLink(email, {
  client = supabase,
  redirectTo = typeof window === "undefined" ? undefined : window.location.origin,
} = {}) {
  const address = normalizedEmail(email);
  if (!address || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
    throw new TypeError("Enter a valid email address");
  }

  try {
    const { error } = await client.auth.signInWithOtp({
      email: address,
      options: {
        shouldCreateUser: false,
        ...(redirectTo ? { emailRedirectTo: redirectTo } : {}),
      },
    });
    if (error && !NON_ENUMERATING_AUTH_ERROR_CODES.has(error.code)) {
      throw new Error(SIGN_IN_LINK_ERROR_MESSAGE);
    }
  } catch (error) {
    if (error?.message === SIGN_IN_LINK_ERROR_MESSAGE) throw error;
    if (NON_ENUMERATING_AUTH_ERROR_CODES.has(error?.code)) return { message: SIGN_IN_LINK_MESSAGE };
    // Do not expose provider, server, network, or account details in the UI.
    throw new Error(SIGN_IN_LINK_ERROR_MESSAGE);
  }
  return { message: SIGN_IN_LINK_MESSAGE };
}

export async function getWorkbenchSession(client = supabase) {
  const { data, error } = await client.auth.getSession();
  if (error) throw new Error("Unable to check the Workbench session");
  return data?.session || null;
}

export function subscribeToWorkbenchSession(onChange, client = supabase) {
  const { data } = client.auth.onAuthStateChange((_event, session) => onChange(session || null));
  const subscription = data?.subscription;
  return () => subscription?.unsubscribe?.();
}

export async function signOutWorkbench(client = supabase) {
  const { error } = await client.auth.signOut();
  if (error) throw new Error("Unable to sign out of Workbench");
}
