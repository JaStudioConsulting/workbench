const entries = new Map();
const objectIds = new WeakMap();
let nextObjectId = 1;

export function scopedReadKey(namespace, scope) {
  if ((typeof scope !== "object" && typeof scope !== "function") || scope === null) return String(namespace);
  if (!objectIds.has(scope)) objectIds.set(scope, nextObjectId++);
  return `${namespace}:${objectIds.get(scope)}`;
}

function isRetryableReadError(error) {
  if (!error) return false;
  const status = Number(error.status || error.statusCode || error.response?.status);
  if (status >= 500 && status <= 599) return true;
  const text = `${error.name || ""} ${error.message || ""} ${error.code || ""}`.toLowerCase();
  return error.name === "AbortError"
    || /\b5\d\d\b|timeout|timed out|cancelled|canceled|statement timeout|57014/.test(text);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function invalidateReadCache(keyOrPrefix) {
  const value = String(keyOrPrefix || "");
  if (!value) return;
  for (const key of entries.keys()) {
    if (key === value || key.startsWith(value)) entries.delete(key);
  }
}

export function clearReadCache() {
  entries.clear();
}

function evictExpiredEntries(now = Date.now()) {
  for (const [key, entry] of entries) {
    if (!entry.promise && entry.expiresAt <= now) entries.delete(key);
  }
}

export function readThroughCache(key, fetcher, {
  ttlMs = 60_000,
  force = false,
  retry = true,
  backoffMs = 25,
  jitter = Math.random,
} = {}) {
  const normalizedKey = String(key);
  const current = entries.get(normalizedKey);
  if (!force && current?.promise) return current.promise;
  if (!force && current && current.expiresAt > Date.now()) return Promise.resolve(current.value);
  evictExpiredEntries();
  const entry = {};
  entries.set(normalizedKey, entry);

  const promise = (async () => {
    try {
      let value;
      try {
        value = await fetcher();
      } catch (error) {
        if (!retry || !isRetryableReadError(error)) throw error;
        await delay(backoffMs + Math.floor(Math.max(0, Math.min(1, jitter())) * backoffMs));
        value = await fetcher();
      }
      if (entries.get(normalizedKey) === entry) {
        entries.set(normalizedKey, { value, expiresAt: Date.now() + ttlMs });
      }
      return value;
    } catch (error) {
      if (entries.get(normalizedKey) === entry) entries.delete(normalizedKey);
      throw error;
    }
  })();
  entry.promise = promise;
  return promise;
}

export function _clearReadCacheForTesting() {
  clearReadCache();
}

export function _readCacheSizeForTesting() {
  return entries.size;
}
