// Outreach templates and pure helpers for the composer (A2). Drafts only, nothing sends.

export const OUTREACH_TEMPLATES = [
  {
    id: "quick-one",
    name: "Quick One",
    subject: "Quick One",
    body:
      "Hey {first},\n\nWanted to reach out, currently working on a {title} role{blurb}. Given your background, I think this one's worth a conversation.\n\nOpen to a quick 10 minutes today or this week?\n\nLooking forward to hearing back.",
  },
];

const DASHES = new RegExp("[" + String.fromCharCode(0x2013, 0x2014) + "]", "g");

export function stripDashes(text) {
  return String(text ?? "").replace(DASHES, "-");
}

export function firstName(candidate) {
  const name = String(candidate?.name || "").trim();
  return name ? name.split(/\s+/)[0] : "there";
}

// " - <company> in <place>" built only from job data, or "".
export function buildBlurb(job) {
  const company = String(job?.companyDescriptor || job?.company || "").trim();
  const place = String(job?.location || "").trim();
  const hasCompany = company && company !== "Company not recorded";
  if (hasCompany && place) return ` - ${company} in ${place}`;
  if (hasCompany) return ` - ${company}`;
  if (place) return ` in ${place}`;
  return "";
}

export function renderOutreach({ template, candidate, job, signature }) {
  const tpl = template || OUTREACH_TEMPLATES[0];
  const title = String(job?.title || "").trim() || "open";
  let body = tpl.body
    .replace("{first}", firstName(candidate))
    .replace("{title}", title)
    .replace("{blurb}", buildBlurb(job));
  const sig = String(signature || "").trim();
  if (sig) body = `${body}\n\n${sig}`;
  return { subject: tpl.subject, body: stripDashes(body) };
}

// Current job first, then other open jobs in the same province.
export function pickRoleOptions(currentJob, jobs, provinceOf) {
  const list = Array.isArray(jobs) ? jobs : [];
  const options = currentJob ? [currentJob] : [];
  const home = currentJob && provinceOf ? String(provinceOf(currentJob.location) || "") : "";
  if (!home) return options;
  for (const job of list) {
    if (!job || (currentJob && String(job.id) === String(currentJob.id))) continue;
    if (job.status && String(job.status).toLowerCase() !== "active") continue;
    if (String(provinceOf(job.location) || "") === home) options.push(job);
  }
  return options;
}

export function buildMailto({ to, subject, body }) {
  const params = `subject=${encodeURIComponent(subject || "")}&body=${encodeURIComponent(body || "")}`;
  return `mailto:${encodeURIComponent(to || "").replace(/%40/g, "@")}?${params}`;
}

// The mail status shape belongs to the mail builder, so read it defensively.
export function canSaveGmailDraft(status) {
  if (!status || typeof status !== "object") return true;
  if (status.ok === false) return false;
  const flags = [status.canDraft, status.compose, status.draft, status.scopes?.compose, status.scopes?.draft];
  return !flags.some((flag) => flag === false);
}
