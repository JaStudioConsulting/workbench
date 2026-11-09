// Note saves are serialized through one queue per panel. Each save reads the
// session's latest version when it actually runs, so a flush that arrives while
// another save is in flight becomes a no-op or a single follow-up PATCH that
// uses the revision the previous save returned. Each session is bound to the
// note it edits, so a save never lands on whichever subject is on screen later.

const noop = () => {};

export function createNoteSession(note) {
  return {
    id: note.id,
    title: note.title ?? "",
    body: note.body,
    revision: note.updated_at || null,
    version: 0,
    persisted: 0,
  };
}

export function hasUnsavedChanges(session) {
  return Boolean(session) && session.version > session.persisted;
}

export function createNoteSaveQueue(save) {
  let tail = Promise.resolve();
  return function enqueueSave(session) {
    const run = tail.then(() => saveSession(session, save));
    tail = run.then(noop, noop);
    return run;
  };
}

async function saveSession(session, save) {
  if (!hasUnsavedChanges(session)) return { ok: true, saved: null };
  const target = session.version;
  const snapshot = structuredClone({ title: session.title, body: session.body });
  try {
    const saved = await save(session.id, { ...snapshot, expected_updated_at: session.revision });
    session.revision = saved.updated_at;
    session.persisted = target;
    return { ok: true, saved };
  } catch (error) {
    return { ok: false, error };
  }
}
