export function createMemoryTestStorage() {
  const records = new Map();
  return Object.freeze({
    kind: "memory_test_only",
    async get(id) { return records.get(id) ?? null; },
    async put(id, value) { records.set(id, structuredClone(value)); return records.get(id); },
    async remove(id) { return records.delete(id); },
  });
}

export function requireDurableStorage(storage) {
  if (!storage || storage.kind !== "durable") {
    throw Object.assign(new Error("Durable storage is not configured"), { code: "STORAGE_UNAVAILABLE" });
  }
  return storage;
}
