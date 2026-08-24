export function createDraftOnlyMailService(adapter) {
  if (!adapter || typeof adapter.createDraft !== "function") throw new TypeError("A draft adapter is required");
  return Object.freeze({
    async createDraft(message) {
      if (!message?.to || !message?.subject || !message?.body) throw new Error("Draft needs recipient, subject, and body");
      return adapter.createDraft({ ...message, labels: ["DRAFT"] });
    },
  });
}
