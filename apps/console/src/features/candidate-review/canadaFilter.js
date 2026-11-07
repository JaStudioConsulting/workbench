// Canada filter (A6). Preference is remembered in localStorage when it is available.

const STORAGE_KEY = "workbench.review.canadaFilter";
export const DEFAULT_CANADA_PREFS = Object.freeze({ canadaOnly: true, showUnknown: false });

function getStorage(storage) {
  if (storage) return storage;
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

export function loadCanadaPrefs(storage) {
  try {
    const raw = getStorage(storage)?.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CANADA_PREFS };
    const parsed = JSON.parse(raw);
    return {
      canadaOnly: typeof parsed.canadaOnly === "boolean" ? parsed.canadaOnly : true,
      showUnknown: Boolean(parsed.showUnknown),
    };
  } catch {
    return { ...DEFAULT_CANADA_PREFS };
  }
}

export function saveCanadaPrefs(prefs, storage) {
  try {
    getStorage(storage)?.setItem(STORAGE_KEY, JSON.stringify(prefs));
    return true;
  } catch {
    return false;
  }
}

// isInCanadaFn is injected so this file does not depend on the pipeline module.
export function filterByCanada(candidates, prefs, isInCanadaFn) {
  const list = Array.isArray(candidates) ? candidates : [];
  if (!prefs?.canadaOnly) return list;
  return list.filter((candidate) => {
    const location = String(candidate.location || "").trim();
    if (!location) return Boolean(prefs.showUnknown);
    return isInCanadaFn(location);
  });
}
