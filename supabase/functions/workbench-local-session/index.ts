import { createClient } from "npm:@supabase/supabase-js@2";
import { handleLocalSessionRequest } from "./issuer.js";

const OWNER_ID = "5f00e2f9-fef4-4213-a54f-fc79dd8d7752";
const TAILSCALE_LOGIN_SHA256 = "56b7ebe5cdb30d74f97a4769911c0bca6861daf22f1699f58d0cdcddc59391fb";
const MACHINE_TOKEN_SHA256 = "ac18dd728a4c6e1864413a70fb4e053a064d0685d53a57954f2ad3910afd22e4";

function parseKeyMap(value: string | undefined): Record<string, string> {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

async function handle(request: Request): Promise<Response> {
  const url = Deno.env.get("SUPABASE_URL") || "";
  const secretKeys = parseKeyMap(Deno.env.get("SUPABASE_SECRET_KEYS"));
  const publishableKeys = parseKeyMap(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS"));
  const serviceRoleKey = secretKeys.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const publishableKey = publishableKeys.default || Deno.env.get("SUPABASE_ANON_KEY") || "";
  return await handleLocalSessionRequest(request, {
    createClient,
    supabaseUrl: url,
    serviceRoleKey,
    publishableKey,
    ownerId: OWNER_ID,
    expectedLoginHash: TAILSCALE_LOGIN_SHA256,
    expectedTokenHash: MACHINE_TOKEN_SHA256,
  });
}

Deno.serve(handle);
