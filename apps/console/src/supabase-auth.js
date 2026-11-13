import { supabase } from "./supabase-client.js";

export const SIGN_IN_LINK_MESSAGE = "If this email has an existing Workbench account, open the sign-in link sent to your inbox.";

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
    await client.auth.signInWithOtp({
      email: address,
      options: {
        shouldCreateUser: false,
        ...(redirectTo ? { emailRedirectTo: redirectTo } : {}),
      },
    });
  } catch {
    // Keep account-existence and provider errors indistinguishable in the UI.
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
