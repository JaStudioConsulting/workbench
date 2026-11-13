const IDENTITY_RE = /^(sourcing|submission):([1-9]\d*)$/;
const SIGNAL_MAX_AGE_DAYS = 30;

function candidateSourceId(value) {
  const match = IDENTITY_RE.exec(String(value || ""));
  if (!match || !Number.isSafeInteger(Number(match[2]))) return null;
  return `${match[1]}:${Number(match[2])}`;
}

function canonicalUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (!["http:", "https:"].includes(url.protocol)) return "";
    url.hash = "";
    url.search = "";
    return url.href.replace(/\/$/, "");
  } catch {
    return "";
  }
}

function websiteDomain(value) {
  try {
    const host = new URL(canonicalUrl(value)).hostname.toLowerCase().replace(/^www\./, "");
    return host || "";
  } catch {
    return "";
  }
}

function normalizedText(value) {
  return String(value || "").trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function validObservedAt(value, now = new Date()) {
  const ms = Date.parse(value || "");
  return Number.isFinite(ms) && ms <= now.getTime() ? new Date(ms).toISOString() : null;
}

export function buildMpcCaseReferences(candidateId) {
  const id = candidateSourceId(candidateId);
  if (!id) throw new Error("Choose a source-linked candidate before opening MPC.");
  return Object.freeze({
    caseKey: `mpc:${id}:candidate-marketing`,
    candidateId: id,
    source: Object.freeze({ source_type: "candidate", source_system: "supabase_tracker", source_id: id, label: "Selected candidate", evidence_status: "confirmed", required: true, metadata: {} }),
  });
}

function matchResults(items, identityFor, possibleKeyFor, reason) {
  const list = Array.isArray(items) ? items : [];
  const seen = new Map();
  const duplicates = [];
  const possibleMatches = [];
  list.forEach((item, index) => {
    const identity = identityFor(item);
    if (identity && seen.has(identity.key)) {
      duplicates.push({ keepIndex: seen.get(identity.key), duplicateIndex: index, reason: identity.reason });
    } else if (identity) seen.set(identity.key, index);
  });
  for (let leftIndex = 0; leftIndex < list.length; leftIndex += 1) {
    const left = possibleKeyFor(list[leftIndex]);
    if (!left) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < list.length; rightIndex += 1) {
      const right = possibleKeyFor(list[rightIndex]);
      if (left === right && !duplicates.some((item) => item.keepIndex === leftIndex && item.duplicateIndex === rightIndex)) {
        possibleMatches.push({ leftIndex, rightIndex, reason });
      }
    }
  }
  const duplicateIndexes = new Set(duplicates.map((item) => item.duplicateIndex));
  return { items: list.filter((_, index) => !duplicateIndexes.has(index)), duplicates, possibleMatches };
}

export function deduplicateMpcTargets(targets = []) {
  return matchResults(
    targets,
    (target) => {
      const externalId = normalizedText(target?.externalId);
      if (externalId) return { key: `external:${normalizedText(target?.externalIdSource || "source")}:${externalId}`, reason: "same stable external company ID" };
      const domain = websiteDomain(target?.website);
      return domain ? { key: `domain:${domain}`, reason: "same company website domain" } : null;
    },
    (target) => {
      const name = normalizedText(target?.companyName);
      const location = normalizedText(target?.location);
      return name && location ? `${name}|${location}` : "";
    },
    "company name and location match; review before merging",
  );
}

export function deduplicateMpcContacts(contacts = []) {
  return matchResults(
    contacts,
    (contact) => {
      const externalId = normalizedText(contact?.externalId);
      if (externalId) return { key: `external:${normalizedText(contact?.externalIdSource || "source")}:${externalId}`, reason: "same stable external contact ID" };
      if (contact?.linkedinVerified === true) {
        const url = canonicalUrl(contact?.linkedinUrl);
        if (url) {
          const parsed = new URL(url);
          parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
          if (parsed.hostname === "linkedin.com" || parsed.hostname.endsWith(".linkedin.com")) return { key: `linkedin:${parsed.href.toLowerCase().replace(/\/$/, "")}`, reason: "same verified LinkedIn URL" };
        }
      }
      if (contact?.emailVerified === true && normalizedText(contact?.email).includes("@")) return { key: `email:${normalizedText(contact.email)}`, reason: "same verified email address" };
      return null;
    },
    (contact) => {
      const name = normalizedText(contact?.name);
      const company = normalizedText(contact?.companyName);
      return name && company ? `${name}|${company}` : "";
    },
    "contact name and company match; review before merging",
  );
}

export function assessMpcEvidence(item, { kind = "source", now = new Date() } = {}) {
  const sourceUrl = canonicalUrl(item?.sourceUrl);
  const observedAt = validObservedAt(item?.observedAt, now);
  if (!sourceUrl || !observedAt) return { evidenceStatus: "missing", sourceUrl: sourceUrl || null, observedAt, reason: "Add a valid source URL and observed date." };
  if (kind === "signal") {
    const ageDays = Math.floor((now.getTime() - Date.parse(observedAt)) / 86_400_000);
    if (item?.status === "expired" || ageDays > SIGNAL_MAX_AGE_DAYS) return { evidenceStatus: "stale", sourceUrl, observedAt, reason: "Signal is expired or older than 30 days." };
  }
  return { evidenceStatus: "confirmed", sourceUrl, observedAt, reason: "Source URL and observed date were supplied for recruiter review." };
}

const APPROVED_FIELD_KEYS = ["location", "availability", "compensationTarget", "currentCompensation"];

export function buildMpcReview({ positioning = {}, targets = [], contacts = [], signals = [], outreachDraft = {}, approvedFields = {}, approvedFieldEvidence = {} } = {}, { now = new Date() } = {}) {
  const targetMatches = deduplicateMpcTargets(targets);
  const contactMatches = deduplicateMpcContacts(contacts);
  const evidence = [];
  const assessRows = (kind, rows) => (rows || []).map((row, index) => {
    const assessment = assessMpcEvidence(row, { kind, now });
    evidence.push({ kind, index, label: row?.companyName || row?.name || row?.text || `${kind} ${index + 1}`, ...assessment });
    return { ...row, sourceUrl: assessment.sourceUrl, observedAt: assessment.observedAt, evidenceStatus: assessment.evidenceStatus, evidenceReason: assessment.reason };
  });
  const positioningEvidence = assessMpcEvidence(positioning, { now });
  if (positioning.headline || positioning.summary) evidence.push({ kind: "positioning_summary", index: -1, label: "Candidate positioning", ...positioningEvidence });
  const positioned = { ...positioning, ...positioningEvidence, strengths: assessRows("positioning", positioning.strengths || []) };
  const reviewedTargets = assessRows("target", targetMatches.items);
  const reviewedContacts = assessRows("contact", contactMatches.items);
  const reviewedSignals = assessRows("signal", signals).map((signal) => ({
    ...signal,
    activeStatus: signal.evidenceStatus === "confirmed" && signal.status === "active" ? "active" : signal.status === "expired" || signal.evidenceStatus === "stale" ? "expired" : "unknown",
  }));
  const reviewedApprovedFields = {};
  for (const field of APPROVED_FIELD_KEYS) {
    const value = String(approvedFields?.[field] || "").trim();
    const proof = approvedFieldEvidence?.[field] || {};
    const assessment = value ? assessMpcEvidence(proof, { now }) : { evidenceStatus: "missing", sourceUrl: null, observedAt: null, reason: "No value supplied." };
    reviewedApprovedFields[field] = { value, ...assessment };
    if (value) evidence.push({ kind: "profile_field", field, index: APPROVED_FIELD_KEYS.indexOf(field), label: field, ...assessment });
  }
  return {
    positioning: positioned,
    targets: reviewedTargets,
    contacts: reviewedContacts,
    signals: reviewedSignals,
    outreachDraft: { subject: String(outreachDraft?.subject || ""), body: String(outreachDraft?.body || "") },
    approvedFields: reviewedApprovedFields,
    evidence,
    dedupe: { targets: { duplicates: targetMatches.duplicates, possibleMatches: targetMatches.possibleMatches }, contacts: { duplicates: contactMatches.duplicates, possibleMatches: contactMatches.possibleMatches } },
    gaps: evidence.filter((item) => item.evidenceStatus !== "confirmed"),
  };
}

function hasIdentityLeak(text, terms) {
  const normalized = normalizedText(text);
  if (/(https?:\/\/|www\.)\S+|\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b|\+?\d[\d\s().-]{7,}\d/i.test(String(text || ""))) return true;
  return terms.some((term) => term.length >= 3 && normalized.includes(term));
}

export function buildMpcBlindExport({ candidate = {}, positioning = {}, approvedFields = {}, targets = [], contacts = [], signals = [], evidence = [] } = {}) {
  const identityTerms = [
    candidate.name, candidate.candidate_name, candidate.currentCompany, candidate.current_company,
    ...(Array.isArray(candidate.employers) ? candidate.employers.map((item) => typeof item === "string" ? item : item?.name) : []),
    ...targets.map((item) => item.companyName),
    ...contacts.flatMap((item) => [item.name, item.companyName]),
  ].map(normalizedText).filter(Boolean);
  const warnings = [];
  const redact = (value) => {
    const text = String(value || "").trim();
    if (!text || hasIdentityLeak(text, identityTerms)) {
      if (text) warnings.push("A detail was withheld because it could identify a candidate, employer, company, contact, or source.");
      return "";
    }
    return text;
  };
  const positioningIsSourced = assessMpcEvidence(positioning).evidenceStatus === "confirmed";
  const sourcedTitle = positioningIsSourced ? positioning.headline : "";
  const title = redact(sourcedTitle || candidate.current_title);
  const positioningText = positioningIsSourced ? redact(positioning.summary || positioning.headline) : "";
  const sellingBullets = (positioning.strengths || [])
    .filter((item) => assessMpcEvidence(item).evidenceStatus === "confirmed")
    .map((item) => redact(item.text))
    .filter(Boolean).slice(0, 5);
  const publicFields = {};
  for (const key of ["location", "availability", "compensationTarget", "currentCompensation"]) {
    const field = approvedFields[key];
    const value = assessMpcEvidence(field).evidenceStatus === "confirmed" ? redact(field.value) : "";
    if (value) publicFields[key] = value;
  }
  const unresolvedEvidenceCount = evidence.filter((item) => item.evidenceStatus !== "confirmed").length;
  const complete = Boolean(title && (positioningText || sellingBullets.length >= 4) && sellingBullets.length >= 4);
  if (!title) warnings.push("Add a source-backed title or use the candidate's saved Tracker title before export.");
  if (sellingBullets.length < 4) warnings.push("Add at least four source-backed, identity-safe selling bullets before export.");
  if (unresolvedEvidenceCount) warnings.push(`${unresolvedEvidenceCount} source gap${unresolvedEvidenceCount === 1 ? "" : "s"} remain in the case.`);
  return {
    format: "tttg-blind-mpc-v1",
    status: complete ? "ready_for_review" : "incomplete",
    complete,
    warnings: [...new Set(warnings)],
    preview: { title, positioning: positioningText, sellingBullets, approvedFields: publicFields },
    coverage: {
      sourcedTargetCount: targets.filter((item) => item.evidenceStatus === "confirmed").length,
      sourcedContactCount: contacts.filter((item) => item.evidenceStatus === "confirmed").length,
      activeSignalCount: signals.filter((item) => item.evidenceStatus === "confirmed" && item.activeStatus === "active").length,
      unresolvedEvidenceCount,
    },
    // Keep provenance out of the external object; the operator case retains it.
    exportedAt: new Date().toISOString(),
  };
}

export { canonicalUrl as canonicalMpcSourceUrl };
