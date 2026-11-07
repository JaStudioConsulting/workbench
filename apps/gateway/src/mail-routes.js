import { google } from "googleapis";
import { createDraftOnlyMailService } from "./gmail.js";

const GMAIL_READ_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const GMAIL_COMPOSE_SCOPE = "https://www.googleapis.com/auth/gmail.compose";
const GMAIL_MODIFY_SCOPE = "https://www.googleapis.com/auth/gmail.modify";
const GMAIL_BROAD_SCOPE = "https://mail.google.com/";
const READ_SCOPES = new Set([GMAIL_READ_SCOPE, GMAIL_MODIFY_SCOPE, GMAIL_BROAD_SCOPE]);
const DRAFT_SCOPES = new Set([GMAIL_COMPOSE_SCOPE, GMAIL_MODIFY_SCOPE, GMAIL_BROAD_SCOPE]);
const MAX_EMAILS = 25;
const MAX_QUERY_LENGTH = 4_000;
const MAX_SUBJECT_LENGTH = 998;
const MAX_BODY_LENGTH = 100_000;

function noStore(res) {
  res.set("Cache-Control", "private, no-store");
  return res;
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res)).catch(next);
}

function hasScope(scopes, allowed) {
  return Array.isArray(scopes) && scopes.some((scope) => allowed.has(scope));
}

function mailStatus(grant) {
  const connected = Boolean(grant?.accessToken || grant?.access_token);
  const scopes = Array.isArray(grant?.scopes) ? grant.scopes : [];
  return {
    connected,
    canDraft: connected && hasScope(scopes, DRAFT_SCOPES),
    canRead: connected && hasScope(scopes, READ_SCOPES),
  };
}

function normalizedEmail(value) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (!email || email.length > 320 || /[\r\n]/.test(email)) return null;
  const domainPart = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
  return new RegExp(`^[^\\s@]+@${domainPart}(?:\\.${domainPart})+$`).test(email) ? email : null;
}

function parsedEmails(value) {
  const raw = Array.isArray(value) ? value.join(",") : String(value || "");
  if (raw.length > MAX_QUERY_LENGTH) throw Object.assign(new Error("Email query is too long"), { status: 400 });
  const items = raw.split(",").map((item) => item.trim()).filter(Boolean);
  if (items.length > MAX_EMAILS) throw Object.assign(new Error(`Choose no more than ${MAX_EMAILS} candidate emails`), { status: 400 });
  const emails = items.map(normalizedEmail);
  if (emails.some((email) => !email)) throw Object.assign(new Error("Candidate email query is invalid"), { status: 400 });
  return [...new Set(emails)];
}

function checkedDraft(body = {}) {
  const to = normalizedEmail(body.to);
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const text = typeof body.body === "string" ? body.body : "";
  if (!to || !subject || !text || /[\r\n]/.test(subject) || subject.length > MAX_SUBJECT_LENGTH || text.length > MAX_BODY_LENGTH) {
    throw Object.assign(new Error("Draft recipient, subject, or body is invalid"), { status: 400 });
  }
  return { to, subject, body: text };
}

function rawMessage({ to, subject, body }) {
  const message = [
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    body,
  ].join("\r\n");
  return Buffer.from(message, "utf8").toString("base64url");
}

function defaultGmailClientFactory(accessToken) {
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });
  return google.gmail({ version: "v1", auth: oauth2Client });
}

function dateFromMessage(message) {
  const internalDate = Number(message?.internalDate);
  if (Number.isFinite(internalDate) && internalDate > 0) return new Date(internalDate).toISOString();
  const header = message?.payload?.headers?.find((item) => String(item?.name).toLowerCase() === "date")?.value;
  const parsed = Date.parse(header || "");
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

async function latestInboundDate(gmail, email) {
  const listed = await gmail.users.messages.list({
    userId: "me",
    q: `from:${email} -from:me`,
    maxResults: 1,
  });
  const id = listed?.data?.messages?.[0]?.id;
  if (!id) return null;
  const message = await gmail.users.messages.get({
    userId: "me",
    id,
    format: "metadata",
    metadataHeaders: ["Date"],
  });
  return dateFromMessage(message?.data);
}

export function registerMailRoutes(app, {
  authenticated,
  getGoogleProviderAccessToken,
  gmailClientFactory = defaultGmailClientFactory,
} = {}) {
  if (!app || typeof app.get !== "function" || typeof app.post !== "function") throw new TypeError("An Express app is required");
  if (typeof authenticated !== "function") throw new TypeError("Authenticated middleware is required");

  async function grantFor(req) {
    return typeof getGoogleProviderAccessToken === "function"
      ? await getGoogleProviderAccessToken(req)
      : null;
  }

  app.get("/api/mail/status", authenticated, asyncRoute(async (req, res) => {
    try {
      return noStore(res).json(mailStatus(await grantFor(req)));
    } catch {
      return noStore(res).status(503).json({ connected: false, canDraft: false, canRead: false });
    }
  }));

  app.post("/api/mail/draft", authenticated, asyncRoute(async (req, res) => {
    let grant;
    try { grant = await grantFor(req); }
    catch { return noStore(res).status(503).json({ ok: false, reason: "unavailable" }); }
    if (!mailStatus(grant).canDraft) return noStore(res).status(403).json({ ok: false, reason: "no_scope" });

    let draft;
    try { draft = checkedDraft(req.body); }
    catch (error) { return noStore(res).status(error.status || 400).json({ ok: false, reason: "invalid_input" }); }

    try {
      const accessToken = grant.accessToken || grant.access_token;
      const gmail = await gmailClientFactory(accessToken);
      const service = createDraftOnlyMailService({
        async createDraft(message) {
          const result = await gmail.users.drafts.create({
            userId: "me",
            requestBody: { message: { raw: rawMessage(message) } },
          });
          return { id: result?.data?.id || null };
        },
      });
      return noStore(res).status(201).json({ ok: true, ...await service.createDraft(draft) });
    } catch {
      return noStore(res).status(502).json({ ok: false, reason: "unavailable" });
    }
  }));

  app.get("/api/mail/replies", authenticated, asyncRoute(async (req, res) => {
    let emails;
    try { emails = parsedEmails(req.query.emails); }
    catch (error) { return noStore(res).status(error.status || 400).json({ available: false, latestByEmail: {}, reason: "invalid_input" }); }

    let grant;
    try { grant = await grantFor(req); }
    catch { return noStore(res).status(503).json({ available: false, latestByEmail: {} }); }
    if (!mailStatus(grant).canRead) return noStore(res).json({ available: false, latestByEmail: {} });

    try {
      const accessToken = grant.accessToken || grant.access_token;
      const gmail = await gmailClientFactory(accessToken);
      const dates = await Promise.all(emails.map((email) => latestInboundDate(gmail, email)));
      return noStore(res).json({
        available: true,
        latestByEmail: Object.fromEntries(emails.map((email, index) => [email, dates[index]])),
      });
    } catch {
      return noStore(res).status(502).json({ available: false, latestByEmail: {} });
    }
  }));
}
