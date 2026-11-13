import { createClient } from "npm:@supabase/supabase-js@2";
import { handleLocalSessionRequest } from "./issuer.js";

const OWNER_ID = "5f00e2f9-fef4-4213-a54f-fc79dd8d7752";
const TAILSCALE_LOGIN_SHA256 = "56b7ebe5cdb30d74f97a4769911c0bca6861daf22f1699f58d0cdcddc59391fb";
const MACHINE_TOKEN_SHA256 = "019f245a16a0760e79503e0ae9021d384c6c4aaefa4c16040d882c781a8fde3e";

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
