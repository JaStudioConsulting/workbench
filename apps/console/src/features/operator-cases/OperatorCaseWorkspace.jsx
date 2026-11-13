import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Clock3, FileCheck2, ShieldCheck, X } from "lucide-react";
import { Badge } from "../../components/ui/badge.tsx";
import { Button } from "../../components/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card.tsx";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../../components/ui/sheet.tsx";
import { Textarea } from "../../components/ui/textarea.tsx";
import { downloadWorkflowResumePdf } from "../meetings/meetingExport.js";
import { blockingEvidence, loadOperatorCase, markDailyReviewActionReported, markLoxoEntryReported, reviewCaseAction, reviewCaseArtifact, updateCaseArtifact } from "./operatorCaseService.js";
import { updateMpcArtifact } from "./mpcService.js";
import { renderBrandedResumeVersion } from "./resumeVersionClient.js";

const labels = {
  after_call: "After-call case", mpc: "MPC case", daily: "Daily review case",
  branded_resume: "Branded resume", candidate_submission: "Candidate submission",
  presentation_email: "Presentation email", loxo_update: "Loxo update bullets",
  candidate_positioning: "Candidate positioning", target_companies: "Target companies",
  contacts: "Contacts", hiring_signals: "Hiring signals", outreach_draft: "Outreach draft",
  gmail_draft: "Create Gmail draft", loxo_queue: "Manual Loxo update", tracker_write: "Tracker write",
  external_submission: "External submission", review: "Review",
};

const submissionLabels = {
  name: "Name", title: "Title", compensationTarget: "Compensation target", currentCompensation: "Current compensation",
  vacation: "Vacation", location: "Location", workStatus: "Work status", interviewAvailability: "Interview availability",
  startDate: "Start date / notice period", reasonForLeaving: "Reason for leaving", profileSummary: "Profile summary",
};
const evidenceLabels = { candidate_record: "candidate record", resume: "resume", transcript: "call transcript", call_notes: "call notes", job_description: "job description" };
const actionStatusLabels = { proposed: "Needs review", approved: "Approved", queued: "Waiting", completed: "Completed", rejected: "Not approved" };
const operationLabels = { manual_loxo_entry: "Manual Loxo entry", review_submission: "Review candidate submission", create_gmail_draft: "Create an email draft" };

function fieldText(field) {
  if (field && typeof field === "object" && "value" in field) return field.value == null || field.value === "" ? "Not provided" : String(field.value);
  return field == null || field === "" ? "Not provided" : String(field);
}

function EvidenceQuotes({ evidence = [] }) {
  const quotes = (Array.isArray(evidence) ? evidence : []).filter((item) => item?.quote);
  if (!quotes.length) return <span className="text-xs text-muted-foreground">No source quote saved.</span>;
  return <details className="mt-1 text-xs"><summary className="cursor-pointer text-muted-foreground">View source quotes ({quotes.length})</summary><ul className="mt-1 list-disc pl-4 text-muted-foreground">{quotes.map((item, index) => <li key={`${item.source}:${index}`}>“{item.quote}” · {evidenceLabels[item.source] || "source"}</li>)}</ul></details>;
}

function displayPlainText(content = {}, type = "") {
  if (type === "candidate_submission") return "Submission fields are shown below.";
  if (type === "candidate_positioning") return "Candidate positioning is shown below.";
  if (type === "target_companies") return "Target companies are shown below.";
  if (type === "contacts") return "Contact details are shown below.";
  if (type === "hiring_signals") return "Hiring signals are shown below.";
  if (type === "outreach_draft" || type === "presentation_email") return [content.subject ? `Subject: ${content.subject}` : "", content.body || ""].filter(Boolean).join("\n\n");
  if (Array.isArray(content.bullets)) return content.bullets.map((line) => `• ${line?.text || line}`).join("\n");
  if (typeof content.text === "string") return content.text;
  if (content.source === "candidate_review_actions") return content.note || "No note was provided.";
  return "No readable content was saved.";
}

function AuditSummary({ audit }) {
  if (!audit) return null;
  const sourceLabels = { candidate_record: "candidate record", resume: "resume", transcript: "call transcript", call_notes: "call notes", job_description: "job description" };
  return <div className="grid gap-2 rounded-md border bg-background p-3 text-sm" aria-label="Draft source review">
    {audit.finalizationBlocked || audit.identityReviewRequired ? <p className="font-medium text-destructive">Resolve the source or candidate identity review before finalization.</p> : <p className="font-medium">Draft for recruiter review. Check each claim against its source.</p>}
    {audit.identityReviewRequired ? <p className="font-medium text-destructive">Candidate identity needs review before these outputs can be approved.</p> : null}
    {audit.missingSources?.length ? <div><p className="font-medium">Sources not provided</p><ul className="list-disc pl-5 text-muted-foreground">{audit.missingSources.map((item) => <li key={item}>{sourceLabels[item] || item}</li>)}</ul></div> : null}
    {audit.conflicts?.length ? <div><p className="font-medium">Source differences</p><ul className="list-disc pl-5">{audit.conflicts.map((item, index) => <li key={`${item.field}:${index}`}>{item.description || `${item.field}: ${item.evidence?.map((evidence) => `“${evidence.quote}” (${sourceLabels[evidence.source] || evidence.source})`).join(" versus ")}`}</li>)}</ul></div> : null}
    {audit.supportedClaims?.length ? <details className="rounded-md border p-2"><summary className="cursor-pointer font-medium">Check claims against source quotes ({audit.supportedClaims.length})</summary><ul className="mt-2 grid gap-2">{audit.supportedClaims.map((claim, index) => <li key={`${index}:${claim.text}`}><p>{claim.text}</p><ul className="list-disc pl-5 text-muted-foreground">{claim.evidence?.map((item, evidenceIndex) => <li key={`${item.source}:${evidenceIndex}`}>“{item.quote}” · {sourceLabels[item.source] || item.source}</li>)}</ul></li>)}</ul></details> : null}
  </div>;
}

function collectEvidence(value, result = [], seen = new Set()) {
  if (!value || typeof value !== "object") return result;
  if (Array.isArray(value.evidence)) {
    for (const item of value.evidence) {
      const key = `${item?.source || ""}:${item?.quote || ""}`;
      if (item?.quote && !seen.has(key)) { seen.add(key); result.push(item); }
    }
  }
  for (const [key, child] of Object.entries(value)) {
    if (["evidence", "audit", "pdf"].includes(key)) continue;
    collectEvidence(child, result, seen);
  }
  return result;
}

function SourceStatus({ source }) {
  const blocking = source.required && source.evidence_status !== "confirmed";
  const statusLabel = ({ confirmed: "Source supplied", missing: "Source missing", stale: "Out of date", conflicting: "Needs review", unknown: "Unknown" })[source.evidence_status] || source.evidence_status;
  return <li className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
    <div className="min-w-0"><p className="font-medium">{source.label || labels[source.source_type] || source.source_type}</p>{source.observed_at ? <p className="mt-1 text-xs text-muted-foreground">Checked {new Date(source.observed_at).toLocaleDateString()}</p> : null}{source.metadata?.sourceUrl ? <a className="mt-1 inline-block text-xs text-primary underline" href={source.metadata.sourceUrl} target="_blank" rel="noreferrer">Open source</a> : null}{source.metadata?.evidenceReason ? <p className="mt-1 text-xs text-muted-foreground">{source.metadata.evidenceReason}</p> : null}</div>
    <Badge variant={blocking ? "destructive" : "outline"}>{statusLabel}</Badge>
  </li>;
}

function SourceBackedValue({ label, value }) {
  const field = value && typeof value === "object" && "value" in value ? value : null;
  return <div className="grid gap-0.5"><dt className="text-xs font-medium text-muted-foreground">{label}</dt><dd className="whitespace-pre-wrap text-sm">{fieldText(value)}</dd>{field ? <EvidenceQuotes evidence={field.evidence} /> : null}</div>;
}

function SourceLink({ url, date, status }) {
  const statusText = ({ confirmed: "Source supplied", missing: "Source missing", stale: "Out of date", unknown: "Unknown" })[status] || "Evidence not checked";
  return <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"><span>{statusText}</span>{date ? <span>Checked {new Date(date).toLocaleDateString()}</span> : null}{url ? <a className="text-primary underline" href={url} target="_blank" rel="noreferrer">Open source</a> : null}</div>;
}

function ClaimList({ title, items = [] }) {
  if (!items?.length) return <section><h4 className="text-sm font-medium">{title}</h4><p className="text-sm text-muted-foreground">No details provided.</p></section>;
  return <section className="grid gap-2"><h4 className="text-sm font-medium">{title}</h4><ul className="grid gap-2">{items.map((item, index) => <li className="rounded-md border p-3" key={`${index}:${item?.text || item?.companyName || "item"}`}><p className="whitespace-pre-wrap text-sm">{item?.text || item?.companyName || item?.signal || "Details not on file"}</p>{item?.evidence ? <EvidenceQuotes evidence={item.evidence} /> : null}{item?.evidenceStatus || item?.sourceUrl ? <SourceLink url={item.sourceUrl} date={item.observedAt} status={item.evidenceStatus || item.activeStatus} /> : null}</li>)}</ul></section>;
}

function ArtifactContent({ artifact }) {
  const content = artifact.content || {};
  switch (artifact.artifact_type) {
    case "branded_resume":
      return <div className="whitespace-pre-wrap rounded-md border bg-muted/20 p-3 text-sm leading-6">{content.text || "No resume text was returned."}</div>;
    case "candidate_submission": {
      const fields = content.fields || {};
      return <div className="grid gap-4 rounded-md border p-3"><dl className="grid gap-3 sm:grid-cols-2">{Object.entries(submissionLabels).filter(([key]) => key !== "profileSummary").map(([key, label]) => <SourceBackedValue key={key} label={label} value={fields[key]} />)}<SourceBackedValue label="Client" value={content.client} /></dl><ClaimList title="Profile summary" items={fields.profileSummary} /></div>;
    }
    case "presentation_email":
    case "outreach_draft":
      return <div className="grid gap-2 rounded-md border p-3"><p className="text-sm"><strong>Subject:</strong> {content.subject || "Not provided"}</p><div><h4 className="text-xs font-medium text-muted-foreground">Message</h4><p className="mt-1 whitespace-pre-wrap text-sm">{content.body || "No message text was saved."}</p></div>{artifact.artifact_type === "presentation_email" ? <p className="text-xs text-muted-foreground">{content.attachmentStatus === "generated" ? "An attachment was generated." : "No attachment was generated."}</p> : null}</div>;
    case "loxo_update":
      return <ClaimList title="Proposed update notes" items={content.bullets} />;
    case "candidate_positioning":
      return <div className="grid gap-3 rounded-md border p-3"><SourceBackedValue label="Anonymous target title" value={content.headline} /><SourceBackedValue label="Positioning summary" value={content.summary} /><SourceLink url={content.sourceUrl} date={content.observedAt} status={content.evidenceStatus} /><ClaimList title="Selling points" items={content.strengths} /><ClaimList title="Caveats" items={(content.caveats || []).map((text) => ({ text }))} /></div>;
    case "target_companies":
      return <div className="grid gap-3">{(content.items || []).length ? content.items.map((item, index) => <div className="grid gap-2 rounded-md border p-3" key={`${index}:${item.companyName}`}><strong>{item.companyName || `Target ${index + 1}`}</strong>{item.location ? <p className="text-sm">{item.location}</p> : null}{item.reason ? <p className="whitespace-pre-wrap text-sm">{item.reason}</p> : null}{item.website ? <a className="text-sm text-primary underline" href={item.website} target="_blank" rel="noreferrer">Company website</a> : null}<SourceLink url={item.sourceUrl} date={item.observedAt} status={item.evidenceStatus} /></div>) : <p className="text-sm text-muted-foreground">No target companies were saved.</p>}</div>;
    case "contacts":
      return <div className="grid gap-3">{(content.items || []).length ? content.items.map((item, index) => <div className="grid gap-1 rounded-md border p-3" key={`${index}:${item.name}`}><strong>{item.name || `Contact ${index + 1}`}</strong><p className="text-sm text-muted-foreground">{[item.title, item.companyName].filter(Boolean).join(" · ") || "Title or company not provided"}</p>{item.email ? <p className="text-sm">Email: {item.email}</p> : null}{item.linkedinUrl ? <a className="text-sm text-primary underline" href={item.linkedinUrl} target="_blank" rel="noreferrer">LinkedIn profile</a> : null}{item.notes ? <p className="whitespace-pre-wrap text-sm">{item.notes}</p> : null}<SourceLink url={item.sourceUrl} date={item.observedAt} status={item.evidenceStatus} /></div>) : <p className="text-sm text-muted-foreground">No contacts were saved.</p>}</div>;
    case "hiring_signals":
      return <ClaimList title="Hiring signals" items={(Array.isArray(content) ? content : content.items || []).map((item) => ({ ...item, text: `${item.companyName || "Company not on file"}: ${item.signal || "Signal not provided"} · ${item.activeStatus || "status unknown"}` }))} />;
    default:
      return <p className="rounded-md border p-3 text-sm text-muted-foreground">{displayPlainText(content, artifact.artifact_type)}</p>;
  }
}

function updateSourceField(content, key, value) {
  const current = content.fields?.[key] || { value: null, evidence: [] };
  return { ...content, fields: { ...content.fields, [key]: { ...current, value: value || null } } };
}

function updateResumeField(sections, key, value) {
  const field = sections[key] || { value: "", evidence: [] };
  const text = value.trim();
  return { ...sections, [key]: { ...field, value: text || null, evidence: text ? field.evidence : [] } };
}

function ResumeClaimEditor({ title, items, onChange, onRemove, idPrefix }) {
  return <section className="grid gap-2"><h4 className="text-sm font-medium">{title}</h4>{(items || []).map((claim, index) => <div className="grid gap-1" key={`${idPrefix}-${index}`}><label className="text-sm" htmlFor={`${idPrefix}-${index}`}>{title} {index + 1}</label><Textarea id={`${idPrefix}-${index}`} rows={2} value={claim.text || ""} onChange={(event) => { if (event.target.value.trim()) onChange(index, { ...claim, text: event.target.value }); }} /><EvidenceQuotes evidence={claim.evidence} /><Button type="button" variant="ghost" size="sm" className="justify-self-start" onClick={() => onRemove(index)}>Remove this claim</Button></div>)}</section>;
}

function ResumeSectionEditor({ artifact, content, onChange }) {
  const sections = content.sections;
  if (!sections) return <p className="rounded-md border p-3 text-sm text-muted-foreground">This older resume has no structured source details for safe editing. Reopen after-call preparation to create a new version.</p>;
  const updateField = (key, value) => onChange({ ...content, sections: updateResumeField(sections, key, value) });
  const updateClaims = (key, index, claim) => onChange({ ...content, sections: { ...sections, [key]: sections[key].map((item, itemIndex) => itemIndex === index ? claim : item) } });
  const removeClaim = (key, index) => onChange({ ...content, sections: { ...sections, [key]: sections[key].filter((_, itemIndex) => itemIndex !== index) } });
  const updateRoleField = (index, key, value) => onChange({ ...content, sections: { ...sections, experience: sections.experience.map((role, roleIndex) => { if (roleIndex !== index) return role; const prior = role[key] || { value: "", evidence: [] }; const text = value.trim(); return { ...role, [key]: { ...prior, value: text || null, evidence: text ? prior.evidence : [] } }; }) } });
  const updateRoleBullet = (roleIndex, bulletIndex, claim) => onChange({ ...content, sections: { ...sections, experience: sections.experience.map((role, index) => index === roleIndex ? { ...role, bullets: role.bullets.map((item, itemIndex) => itemIndex === bulletIndex ? claim : item) } : role) } });
  const removeRoleBullet = (roleIndex, bulletIndex) => onChange({ ...content, sections: { ...sections, experience: sections.experience.map((role, index) => index === roleIndex ? { ...role, bullets: role.bullets.filter((_, itemIndex) => itemIndex !== bulletIndex) } : role) } });
  const field = (key, label) => <div className="grid gap-1" key={key}><label className="text-sm font-medium" htmlFor={`resume-${artifact.id}-${key}`}>{label}</label><Textarea id={`resume-${artifact.id}-${key}`} rows={2} value={sections[key]?.value || ""} onChange={(event) => updateField(key, event.target.value)} /><EvidenceQuotes evidence={sections[key]?.evidence} /></div>;
  return <div className="grid gap-4 rounded-md border p-3"><p className="text-sm text-muted-foreground">Edited wording needs fresh recruiter source review. Retained quotes are reference material only. Clear a named field to remove its quote, or remove a claim to remove that text and its quotes. Saving creates a new PDF from these same sections.</p>
    {field("name", "Name")}{field("title", "Title")}
    <ResumeClaimEditor title="Professional summary" idPrefix={`resume-${artifact.id}-summary`} items={sections.summary} onChange={(index, claim) => updateClaims("summary", index, claim)} onRemove={(index) => removeClaim("summary", index)} />
    <ResumeClaimEditor title="Core competencies and skills" idPrefix={`resume-${artifact.id}-skill`} items={sections.skills} onChange={(index, claim) => updateClaims("skills", index, claim)} onRemove={(index) => removeClaim("skills", index)} />
    <section className="grid gap-3"><h4 className="text-sm font-medium">Professional experience</h4>{sections.experience.map((role, roleIndex) => <div className="grid gap-2 rounded-md border p-3" key={`role-${roleIndex}`}><h5 className="text-sm font-medium">Role {roleIndex + 1}</h5>{[["title", "Role title"], ["dates", "Dates"], ["company", "Company"], ["location", "Location"]].map(([key, label]) => <div className="grid gap-1" key={key}><label className="text-sm" htmlFor={`resume-${artifact.id}-role-${roleIndex}-${key}`}>{label}</label><Textarea id={`resume-${artifact.id}-role-${roleIndex}-${key}`} rows={2} value={role[key]?.value || ""} onChange={(event) => updateRoleField(roleIndex, key, event.target.value)} /><EvidenceQuotes evidence={role[key]?.evidence} /></div>)}<ResumeClaimEditor title="Role details" idPrefix={`resume-${artifact.id}-role-${roleIndex}-bullet`} items={role.bullets} onChange={(bulletIndex, claim) => updateRoleBullet(roleIndex, bulletIndex, claim)} onRemove={(bulletIndex) => removeRoleBullet(roleIndex, bulletIndex)} /></div>)}</section>
    <ResumeClaimEditor title="Education" idPrefix={`resume-${artifact.id}-education`} items={sections.education} onChange={(index, claim) => updateClaims("education", index, claim)} onRemove={(index) => removeClaim("education", index)} />
    <ResumeClaimEditor title="Certifications" idPrefix={`resume-${artifact.id}-certification`} items={sections.certifications} onChange={(index, claim) => updateClaims("certifications", index, claim)} onRemove={(index) => removeClaim("certifications", index)} />
    <ResumeClaimEditor title="Additional information" idPrefix={`resume-${artifact.id}-additional`} items={sections.additionalInformation} onChange={(index, claim) => updateClaims("additionalInformation", index, claim)} onRemove={(index) => removeClaim("additionalInformation", index)} />
  </div>;
}

function ArtifactEditor({ artifact, content, onChange }) {
  const setField = (key, value) => onChange(updateSourceField(content, key, value));
  const plainValue = (field) => field && typeof field === "object" && "value" in field ? field.value || "" : field || "";
  if (artifact.artifact_type === "candidate_submission") return <div className="grid gap-3 rounded-md border p-3">{Object.entries(submissionLabels).filter(([key]) => key !== "profileSummary").map(([key, label]) => <div className="grid gap-1" key={key}><label className="text-sm font-medium" htmlFor={`case-${artifact.id}-${key}`}>{label}</label><Textarea id={`case-${artifact.id}-${key}`} rows={2} value={plainValue(content.fields?.[key])} onChange={(event) => setField(key, event.target.value)} /><EvidenceQuotes evidence={content.fields?.[key]?.evidence} /></div>)}<div className="grid gap-1"><label className="text-sm font-medium" htmlFor={`case-${artifact.id}-client`}>Client</label><Textarea id={`case-${artifact.id}-client`} rows={2} value={plainValue(content.client)} onChange={(event) => onChange({ ...content, client: { ...(content.client || {}), value: event.target.value || null } })} /><EvidenceQuotes evidence={content.client?.evidence} /></div>{(content.fields?.profileSummary || []).map((claim, index) => <div className="grid gap-1" key={`summary-${index}`}><label className="text-sm font-medium" htmlFor={`case-${artifact.id}-summary-${index}`}>Profile summary {index + 1}</label><Textarea id={`case-${artifact.id}-summary-${index}`} rows={2} value={claim.text || ""} onChange={(event) => onChange({ ...content, fields: { ...content.fields, profileSummary: content.fields.profileSummary.map((item, itemIndex) => itemIndex === index ? { ...item, text: event.target.value } : item) } })} /><EvidenceQuotes evidence={claim.evidence} /></div>)}</div>;
  if (artifact.artifact_type === "branded_resume") return <ResumeSectionEditor artifact={artifact} content={content} onChange={onChange} />;
  if (artifact.artifact_type === "presentation_email" || artifact.artifact_type === "outreach_draft") return <div className="grid gap-3"><div className="grid gap-1"><label className="text-sm font-medium" htmlFor={`case-${artifact.id}-subject`}>Subject</label><Textarea id={`case-${artifact.id}-subject`} rows={2} value={content.subject || ""} onChange={(event) => onChange({ ...content, subject: event.target.value })} /></div><div className="grid gap-1"><label className="text-sm font-medium" htmlFor={`case-${artifact.id}-body`}>Message</label><Textarea id={`case-${artifact.id}-body`} rows={8} value={content.body || ""} onChange={(event) => onChange({ ...content, body: event.target.value })} /></div></div>;
  if (artifact.artifact_type === "loxo_update") return <div className="grid gap-3">{(content.bullets || []).map((bullet, index) => <div className="grid gap-1" key={`bullet-${index}`}><label className="text-sm font-medium" htmlFor={`case-${artifact.id}-bullet-${index}`}>Update note {index + 1}</label><Textarea id={`case-${artifact.id}-bullet-${index}`} rows={2} value={bullet?.text || bullet || ""} onChange={(event) => onChange({ ...content, bullets: content.bullets.map((item, itemIndex) => itemIndex === index ? typeof item === "object" ? { ...item, text: event.target.value } : event.target.value : item) })} />{bullet?.evidence ? <EvidenceQuotes evidence={bullet.evidence} /> : null}</div>)}</div>;
  return <p className="rounded-md border p-3 text-sm text-muted-foreground">Edit this content in its originating review form. Structured records are read-only here.</p>;
}

function latestArtifactVersions(artifacts = []) {
  const currentByType = new Map();
  const sorted = [...artifacts].sort((left, right) => Date.parse(right.created_at || "") - Date.parse(left.created_at || ""));
  const totals = new Map();
  for (const artifact of sorted) totals.set(artifact.artifact_type, (totals.get(artifact.artifact_type) || 0) + 1);
  const seen = new Map();
  const versionNumbers = new Map();
  for (const artifact of sorted) {
    const index = seen.get(artifact.artifact_type) || 0;
    versionNumbers.set(artifact.id, totals.get(artifact.artifact_type) - index);
    seen.set(artifact.artifact_type, index + 1);
  }
  for (const artifact of sorted) if (!currentByType.has(artifact.artifact_type)) currentByType.set(artifact.artifact_type, artifact);
  const currentIds = new Set([...currentByType.values()].map((artifact) => artifact.id));
  return { current: [...currentByType.values()], history: sorted.filter((artifact) => !currentIds.has(artifact.id)), currentIds, versionNumbers };
}

function HistoricalArtifact({ artifact, versionNumber }) {
  const reviewLabel = ({ draft: "Draft", approved: "Approved", rejected: "Not approved" })[artifact.review_state] || "Needs review";
  return <li className="grid gap-2 rounded-md border p-3"><div className="flex flex-wrap items-center justify-between gap-2"><strong>{labels[artifact.artifact_type] || "Saved output"} · Version {versionNumber}</strong><div className="flex items-center gap-2"><span className="text-xs text-muted-foreground">{artifact.created_at ? new Date(artifact.created_at).toLocaleString() : "Saved date unavailable"}</span><Badge variant="outline">{reviewLabel}</Badge></div></div><details><summary className="cursor-pointer text-sm font-medium">View saved version</summary><div className="mt-2 grid gap-2"><ArtifactContent artifact={artifact} />{artifact.content?.audit ? <AuditSummary audit={artifact.content.audit} /> : null}{artifact.artifact_type === "branded_resume" && artifact.content?.pdf ? <Button type="button" variant="outline" className="justify-self-start" onClick={() => downloadWorkflowResumePdf(artifact.content.pdf)}>Download this resume PDF</Button> : null}</div></details></li>;
}

function actionSnapshotMatches(action, artifact) {
  if (!action.manifest?.artifactId || !artifact || artifact.id !== action.manifest.artifactId) return false;
  if (action.manifest.artifactVersion && artifact.created_at !== action.manifest.artifactVersion) return false;
  return JSON.stringify(action.manifest.contentSnapshot) === JSON.stringify(artifact.content);
}

function ArtifactCard({ artifact, versionNumber, blocked, busy, onSave, onReview }) {
  const [editing, setEditing] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const [value, setValue] = useState(() => artifact.content || {});
  const evidence = collectEvidence(artifact.content?.sections || artifact.content?.fields || artifact.content?.bullets || artifact.content);
  const editableTypes = ["candidate_submission", "presentation_email", "loxo_update", "outreach_draft", ...(artifact.artifact_type === "branded_resume" && artifact.content?.sections ? ["branded_resume"] : [])];
  const reviewLabel = ({ draft: "Draft", approved: "Approved", rejected: "Not approved" })[artifact.review_state] || "Needs review";
  useEffect(() => { setValue(artifact.content || {}); setEditing(false); }, [artifact.id, artifact.updated_at]);
  return <Card>
    <CardHeader className="pb-3"><div className="flex flex-wrap items-center justify-between gap-2"><CardTitle className="text-base">{labels[artifact.artifact_type] || "Review output"} · Current version {versionNumber}</CardTitle><Badge variant="outline">{reviewLabel}</Badge></div></CardHeader>
    <CardContent className="grid gap-3">
      {editing ? <ArtifactEditor artifact={artifact} content={value} onChange={setValue} /> : <ArtifactContent artifact={artifact} />}
      {artifact.content?.audit ? <AuditSummary audit={artifact.content.audit} /> : null}
      {artifact.content?.editReview?.reviewNeeded ? <p className="rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950" role="status">{artifact.content.editReview.humanEditedPaths?.length ? "Some wording was edited. Retained source quotes are reference material only; they do not verify the revised wording. Review these changes before approval." : artifact.content.editReview.note || "Review this saved draft before approval."}</p> : null}
      {evidence.length ? <details className="rounded-md border p-3 text-sm"><summary className="cursor-pointer font-medium">Source quotes ({evidence.length})</summary><ul className="mt-2 grid gap-2">{evidence.map((item, index) => <li key={`${item.source}:${index}`}><blockquote className="border-l-2 pl-3">“{item.quote}”</blockquote><p className="mt-1 text-xs text-muted-foreground">{item.source?.replaceAll("_", " ") || "Source not named"}</p></li>)}</ul></details> : null}
      {artifact.artifact_type === "branded_resume" && artifact.content?.exportStatus === "not_rendered" ? <p className="text-xs text-muted-foreground">{artifact.content.exportMessage || "This edited resume has no current PDF export."}</p> : null}
      {artifact.artifact_type === "branded_resume" && artifact.content?.pdf && !editing ? <div className="grid gap-1"><Button type="button" variant="outline" className="justify-self-start" onClick={() => { setDownloadError(""); try { downloadWorkflowResumePdf(artifact.content.pdf); } catch (error) { setDownloadError(error.message || "The resume PDF could not be downloaded."); } }}>Download resume PDF</Button><p className="text-xs text-muted-foreground">Draft for recruiter review.</p>{downloadError ? <p className="text-sm text-destructive" role="alert">{downloadError}</p> : null}</div> : null}
      <div className="flex flex-wrap gap-2">
        {editing ? <><Button variant="outline" disabled={busy} onClick={async () => { const saved = await onSave(artifact, value); if (saved) setEditing(false); }}>Save edits</Button><Button type="button" variant="ghost" disabled={busy} onClick={() => { setValue(artifact.content || {}); setEditing(false); }}>Cancel edits</Button></> : editableTypes.includes(artifact.artifact_type) ? <Button variant="outline" disabled={busy} onClick={() => setEditing(true)}>Edit output</Button> : null}
        <Button disabled={busy || blocked || artifact.review_state === "approved"} onClick={() => onReview(artifact.id, "approved")}><Check size={15} />Approve output</Button>
        <Button variant="outline" disabled={busy || artifact.review_state === "rejected"} onClick={() => onReview(artifact.id, "rejected")}><X size={15} />Reject</Button>
      </div>
      {blocked ? <p className="text-xs font-medium text-destructive">Resolve required missing, conflicting, or stale evidence before approval.</p> : null}
    </CardContent>
  </Card>;
}

function ActionCard({ action, artifact, artifactApproved, planStale, blocked, busy, onReview, onComplete }) {
  const cannotApprove = blocked || !artifactApproved || planStale;
  const isManualLoxo = action.action_type === "loxo_queue" && action.manifest?.operation === "manual_loxo_entry" && action.manifest?.execution === "user_reported";
  const statusText = isManualLoxo ? ({ proposed: "Needs review", approved: "Ready for manual entry", queued: "Waiting for Loxo", completed: "Reported by recruiter", rejected: "Not approved" }[action.approval_state] || "Needs review") : actionStatusLabels[action.approval_state] || "Needs review";
  const requiredSources = (action.manifest?.requiredSources || []).map((source) => ({ candidate: "candidate record", job: "job record", transcript: "call transcript", draft: "saved review item" })[source] || source);
  return <li className="grid gap-2 rounded-md border p-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><strong>{labels[action.action_type] || action.action_type}</strong><Badge variant="outline">{statusText}</Badge></div>
    <p className="text-sm">{operationLabels[action.manifest?.operation] || "Review the linked change"}. Approval records your decision; Workbench does not send or write it.</p>
    {artifact ? <div className="grid gap-2 rounded-md bg-muted/20 p-3"><h4 className="text-sm font-medium">Exact change to review</h4><ArtifactContent artifact={artifact} /></div> : null}
    {planStale ? <p className="rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950" role="status">This saved action refers to an older output or no longer matches. It is read-only and cannot be approved.</p> : null}
    {requiredSources.length ? <p className="text-xs text-muted-foreground">Uses: {requiredSources.join(", ")}.</p> : null}
    {!planStale ? <div className="flex flex-wrap gap-2">
      <Button disabled={busy || cannotApprove || action.approval_state === "approved"} onClick={() => onReview(action.id, "approved")}><ShieldCheck size={15} />Approve this plan</Button>
      <Button variant="outline" disabled={busy || planStale || action.approval_state === "rejected"} onClick={() => onReview(action.id, "rejected")}><X size={15} />Reject</Button>
    </div> : null}
    {action.action_type === "loxo_queue" && action.manifest?.operation === "manual_loxo_entry" && action.manifest?.execution === "user_reported" && ["approved", "queued"].includes(action.approval_state) && !planStale && artifactApproved && !blocked ? <div className="grid justify-items-start gap-1"><Button type="button" variant="outline" disabled={busy} onClick={() => onComplete(action.id)}>I applied these in Loxo</Button><p className="text-xs text-muted-foreground">This records your report only. Workbench does not contact Loxo.</p></div> : null}
    {action.action_type === "loxo_queue" && action.approval_state === "completed" && action.completed_at ? <p className="text-xs text-muted-foreground" role="status">You reported manually entering this in Loxo on {new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(action.completed_at))}. Workbench did not verify a Loxo sync.</p> : null}
    {cannotApprove ? <p className="text-xs font-medium text-destructive">Approve the linked output and resolve evidence blockers first.</p> : null}
  </li>;
}

export default function OperatorCaseWorkspace({ open, caseId, onOpenChange, onChanged }) {
  const [state, setState] = useState({ phase: "idle", data: null, error: "" });
  const [busy, setBusy] = useState(false);
  const refresh = async () => {
    if (!caseId) return;
    setState((current) => ({ ...current, phase: "loading", error: "" }));
    try { setState({ phase: "ready", data: await loadOperatorCase(caseId), error: "" }); }
    catch (error) { setState({ phase: "error", data: null, error: error.message || "The approval case could not be loaded." }); }
  };
  useEffect(() => { if (open && caseId) refresh(); }, [open, caseId]);

  const blockedSources = blockingEvidence(state.data?.sources || []);
  const finalizationBlocked = Boolean(state.data?.artifacts?.some((item) => item.content?.audit?.finalizationBlocked || item.content?.audit?.identityReviewRequired));
  const reviewBlocked = blockedSources.length > 0 || finalizationBlocked;
  const artifactVersions = useMemo(() => latestArtifactVersions(state.data?.artifacts || []), [state.data?.artifacts]);
  const approvedArtifacts = useMemo(() => new Set(artifactVersions.current.filter((item) => item.review_state === "approved").map((item) => item.id)), [artifactVersions]);
  const run = async (operation) => {
    setBusy(true); setState((current) => ({ ...current, error: "" }));
    try { await operation(); await refresh(); onChanged?.(); return true; }
    catch (error) { setState((current) => ({ ...current, error: error.message || "The change could not be saved." })); return false; }
    finally { setBusy(false); }
  };

  return <Sheet open={open} onOpenChange={onOpenChange}>
    <SheetContent className="w-full overflow-y-auto sm:max-w-3xl" aria-label="Operator case workspace">
      <SheetHeader className="border-b pr-14">
        <SheetTitle>{state.data?.record?.title || "Approval case"}</SheetTitle>
        <SheetDescription>{state.data?.record ? `${labels[state.data.record.case_type]} · ${state.data.record.status.replaceAll("_", " ")}` : "Sources, review outputs, and exact actions."}</SheetDescription>
      </SheetHeader>
      <div className="grid gap-5 px-4 pb-6">
        {state.phase === "loading" ? <p role="status">Loading approval case...</p> : null}
        {state.error ? <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{state.error}</p> : null}
        {state.data ? <>
          {reviewBlocked ? <div className="flex gap-2 rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950"><AlertTriangle className="mt-0.5 shrink-0" size={17} /><span><strong>Review blocked.</strong> {blockedSources.map((source) => source.label).concat(finalizationBlocked ? ["unresolved source differences"] : []).join(", ")}.</span></div> : null}
          <section className="grid gap-3" aria-labelledby="case-sources-heading"><h3 id="case-sources-heading" className="flex items-center gap-2 font-semibold"><FileCheck2 size={17} />Source evidence</h3><ul className="grid gap-2 sm:grid-cols-2">{state.data.sources.map((source) => <SourceStatus key={source.id} source={source} />)}</ul></section>
          <section className="grid gap-3" aria-labelledby="case-outputs-heading"><h3 id="case-outputs-heading" className="font-semibold">Current outputs</h3>{artifactVersions.current.length ? artifactVersions.current.map((artifact) => <ArtifactCard key={artifact.id} artifact={artifact} versionNumber={artifactVersions.versionNumbers.get(artifact.id)} blocked={reviewBlocked} busy={busy} onSave={(item, content) => run(() => {
            if (state.data.record.case_type === "mpc") return updateMpcArtifact(item.id, content, { expectedUpdatedAt: item.updated_at });
            if (item.artifact_type === "branded_resume") return renderBrandedResumeVersion(state.data.record.id, { artifactId: item.id, expectedUpdatedAt: item.updated_at, sections: content.sections });
            return updateCaseArtifact(item.id, content, { expectedUpdatedAt: item.updated_at });
          })} onReview={(id, decision) => run(() => reviewCaseArtifact(id, decision))} />) : <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">No outputs were created. Missing evidence is not filled in.</p>}{artifactVersions.history.length ? <details className="rounded-md border p-3"><summary className="cursor-pointer text-sm font-medium">Earlier saved versions ({artifactVersions.history.length})</summary><ul className="mt-3 grid gap-2">{artifactVersions.history.map((artifact) => <HistoricalArtifact key={artifact.id} artifact={artifact} versionNumber={artifactVersions.versionNumbers.get(artifact.id)} />)}</ul></details> : null}</section>
          <section className="grid gap-3" aria-labelledby="case-actions-heading"><h3 id="case-actions-heading" className="font-semibold">Actions for review</h3>{state.data.actions.length ? <ul className="grid gap-3">{state.data.actions.map((action) => { const artifact = state.data.artifacts.find((item) => item.id === action.manifest?.artifactId); const planStale = !artifactVersions.currentIds.has(action.manifest?.artifactId) || !actionSnapshotMatches(action, artifact); return <ActionCard key={action.id} action={action} artifact={artifact} planStale={planStale} artifactApproved={approvedArtifacts.has(action.manifest?.artifactId)} blocked={reviewBlocked} busy={busy} onReview={(id, decision) => run(() => reviewCaseAction(id, decision))} onComplete={(id) => run(() => state.data.record.case_type === "daily" ? markDailyReviewActionReported(id) : markLoxoEntryReported(id))} />; })}</ul> : <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">No action is waiting for approval.</p>}</section>
          <section className="grid gap-2" aria-labelledby="case-history-heading"><h3 id="case-history-heading" className="flex items-center gap-2 font-semibold"><Clock3 size={17} />Activity history</h3><ul className="space-y-1 text-sm text-muted-foreground"><li>Case created {new Date(state.data.record.created_at).toLocaleString()}</li>{state.data.artifacts.filter((item) => item.reviewed_at).map((item) => <li key={`artifact-${item.id}`}>{labels[item.artifact_type] || "Saved output"} {actionStatusLabels[item.review_state] || "Reviewed"} {new Date(item.reviewed_at).toLocaleString()}</li>)}{state.data.actions.filter((item) => item.approved_at).map((item) => <li key={`action-${item.id}`}>{labels[item.action_type] || "Action"} approved {new Date(item.approved_at).toLocaleString()}</li>)}</ul></section>
        </> : null}
      </div>
    </SheetContent>
  </Sheet>;
}
