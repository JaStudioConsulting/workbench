import { supabase } from "../../supabase-client.js";

const STORAGE_KEY = "workbench.profile.v1";
const PROFILE_FIELDS = ["name", "businessName", "title", "phone", "signature", "defaultProvince"];

function emptyProfile() {
  return {
    name: "",
    businessName: "",
    title: "",
    phone: "",
    signature: "",
    defaultProvince: "",
  };
}

function cleanProfile(profile = {}) {
  return PROFILE_FIELDS.reduce((result, field) => {
    result[field] = String(profile[field] || "").trim();
    return result;
  }, emptyProfile());
}

function browserStorage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

function readFallback(storage) {
  if (!storage) return emptyProfile();
  try {
    return cleanProfile(JSON.parse(storage.getItem(STORAGE_KEY) || "{}"));
  } catch {
    return emptyProfile();
  }
}

function writeFallback(storage, profile) {
  storage?.setItem(STORAGE_KEY, JSON.stringify(profile));
  return profile;
}

function isMissingTable(error) {
  return error?.code === "42P01"
    || error?.code === "PGRST205"
    || /workbench_profile.*(not find|does not exist|schema cache)/i.test(error?.message || "");
}

function fromRow(row) {
  if (!row) return emptyProfile();
  return cleanProfile({
    name: row.name,
    businessName: row.business_name,
    title: row.title,
    phone: row.phone,
    signature: row.signature,
    defaultProvince: row.default_province,
  });
}

async function authenticatedUser(client) {
  const { data, error } = await client.auth.getUser();
  if (error) throw error;
  return data?.user || null;
}

export async function getProfile({ client = supabase, storage = browserStorage() } = {}) {
  const user = await authenticatedUser(client);
  if (!user) return readFallback(storage);

  const { data, error } = await client
    .from("workbench_profile")
    .select("name,business_name,title,phone,signature,default_province")
    .eq("owner_id", user.id)
    .maybeSingle();

  if (isMissingTable(error)) return readFallback(storage);
  if (error) throw new Error("Profile could not be loaded");
  return data ? fromRow(data) : readFallback(storage);
}

export async function saveProfile(profile, { client = supabase, storage = browserStorage() } = {}) {
  const cleaned = cleanProfile(profile);
  const user = await authenticatedUser(client);
  if (!user) throw new Error("Sign in to save your profile");

  const row = {
    owner_id: user.id,
    name: cleaned.name,
    business_name: cleaned.businessName,
    title: cleaned.title,
    phone: cleaned.phone,
    signature: cleaned.signature,
    default_province: cleaned.defaultProvince,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await client
    .from("workbench_profile")
    .upsert(row, { onConflict: "owner_id" })
    .select("name,business_name,title,phone,signature,default_province")
    .single();

  if (isMissingTable(error)) return writeFallback(storage, cleaned);
  if (error) throw new Error("Profile could not be saved");
  const saved = fromRow(data || row);
  storage?.removeItem(STORAGE_KEY);
  return saved;
}

export const PROFILE_STORAGE_KEY = STORAGE_KEY;
