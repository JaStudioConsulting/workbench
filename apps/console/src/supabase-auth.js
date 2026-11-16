import { supabase } from "./supabase-client.js";

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
