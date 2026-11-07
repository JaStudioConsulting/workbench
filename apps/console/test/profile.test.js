import test from "node:test";
import assert from "node:assert/strict";

import {
  getProfile,
  saveProfile,
  PROFILE_STORAGE_KEY,
} from "../src/features/profile/profileService.js";

function storageDouble() {
  const values = new Map();
  return {
    getItem(key) { return values.get(key) || null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
  };
}

function profileClient(result, capture = {}) {
  return {
    auth: {
      async getUser() {
        return { data: { user: { id: "10000000-0000-4000-8000-000000000001" } }, error: null };
      },
    },
    from(table) {
      assert.equal(table, "workbench_profile");
      return {
        select() {
          return {
            eq(column, value) {
              assert.equal(column, "owner_id");
              capture.ownerId = value;
              return { async maybeSingle() { return result; } };
            },
          };
        },
        upsert(row, options) {
          capture.row = row;
          capture.options = options;
          return {
            select() {
              return { async single() { return result; } };
            },
          };
        },
      };
    },
  };
}

test("getProfile maps the owner row to the public profile contract", async () => {
  const profile = await getProfile({
    client: profileClient({
      data: {
        name: "Ja",
        business_name: "Top Tier Talent Group",
        title: "Recruitment Consultant",
        phone: "555-0100",
        signature: "Regards,\nJa",
        default_province: "Ontario",
      },
      error: null,
    }),
    storage: storageDouble(),
  });

  assert.deepEqual(profile, {
    name: "Ja",
    businessName: "Top Tier Talent Group",
    title: "Recruitment Consultant",
    phone: "555-0100",
    signature: "Regards,\nJa",
    defaultProvince: "Ontario",
  });
});

test("saveProfile falls back to localStorage only when the table is absent", async () => {
  const storage = storageDouble();
  const saved = await saveProfile({ name: " Ja ", defaultProvince: " Ontario " }, {
    client: profileClient({ data: null, error: { code: "PGRST205", message: "table missing from schema cache" } }),
    storage,
  });

  assert.equal(saved.name, "Ja");
  assert.equal(saved.defaultProvince, "Ontario");
  assert.equal(JSON.parse(storage.getItem(PROFILE_STORAGE_KEY)).name, "Ja");
});

test("getProfile surfaces non-schema failures instead of masking them", async () => {
  await assert.rejects(
    getProfile({
      client: profileClient({ data: null, error: { code: "42501", message: "permission denied" } }),
      storage: storageDouble(),
    }),
    /Profile could not be loaded/,
  );
});
