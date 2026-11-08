// Keep recoverable audio until a meeting draft has been durably saved.
export async function saveMeetingAndReleaseArchive({ saveDraft, discardArchive, recordingId, logger = console }) {
  const result = await saveDraft();
  if (result?.ok === false) throw new Error(result.error || "Meeting draft could not be saved.");
  if (result?.persistence === "durable" && result?.draft?.id && recordingId) {
    try {
      await discardArchive(recordingId);
    } catch (cleanupError) {
      logger.error("Recoverable recording cleanup failed after meeting draft save.", { recordingId, error: cleanupError });
      return { ...result, archiveRetained: true };
    }
  }
  return result;
}
