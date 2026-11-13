import { useMemo, useState } from "react";
import { AlertTriangle, Plus, Save, X } from "lucide-react";
import { Button } from "../../components/ui/button.tsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card.tsx";
import { Input } from "../../components/ui/input.tsx";
import { Label } from "../../components/ui/label.tsx";
import { Textarea } from "../../components/ui/textarea.tsx";
import { assessMpcEvidence, buildMpcBlindExport, buildMpcReview } from "./mpcDomain.js";

const newTarget = () => ({ companyName: "", website: "", location: "", externalId: "", sourceUrl: "", observedAt: "", reason: "" });
const newContact = () => ({ name: "", title: "", email: "", emailVerified: false, linkedinUrl: "", linkedinVerified: false, externalId: "", companyName: "", sourceUrl: "", observedAt: "", notes: "" });
const newStrength = () => ({ text: "", sourceUrl: "", observedAt: "" });
const newSignal = () => ({ companyName: "", signal: "", sourceUrl: "", observedAt: "", status: "unknown" });

function sourceComplete(row) {
  return Boolean(String(row.sourceUrl || "").trim() && String(row.observedAt || "").trim());
}

function EvidenceFields({ prefix, row, onChange, kind = "source" }) {
  const evidence = assessMpcEvidence(row, { kind });
  return <div className="grid gap-3 sm:grid-cols-2">
    <div className="grid gap-1.5"><Label htmlFor={`${prefix}-source`}>Source link</Label><Input id={`${prefix}-source`} type="url" value={row.sourceUrl} onChange={(event) => onChange("sourceUrl", event.target.value)} placeholder="https://" /></div>
    <div className="grid gap-1.5"><Label htmlFor={`${prefix}-date`}>Date checked</Label><Input id={`${prefix}-date`} type="date" value={row.observedAt} onChange={(event) => onChange("observedAt", event.target.value)} /></div>
    <p className={`sm:col-span-2 text-xs ${evidence.evidenceStatus === "confirmed" ? "text-muted-foreground" : "font-medium text-destructive"}`} role={evidence.evidenceStatus === "confirmed" ? undefined : "status"}>{evidence.evidenceStatus === "confirmed" ? "Source and date supplied for recruiter review." : evidence.reason}</p>
  </div>;
}

export default function MpcIntakeForm({ candidate, initialData = null, onSave, onCancel, busy = false }) {
  const [targets, setTargets] = useState(() => initialData?.targets || []);
  const [contacts, setContacts] = useState(() => initialData?.contacts || []);
  const [headline, setHeadline] = useState(() => initialData?.positioning?.headline || "");
  const [summary, setSummary] = useState(() => initialData?.positioning?.summary || "");
  const [summarySourceUrl, setSummarySourceUrl] = useState(() => initialData?.positioning?.sourceUrl || "");
  const [summaryObservedAt, setSummaryObservedAt] = useState(() => initialData?.positioning?.observedAt || "");
  const [strengths, setStrengths] = useState(() => initialData?.positioning?.strengths || []);
  const [caveats, setCaveats] = useState(() => (initialData?.positioning?.caveats || []).join("\n"));
  const [signals, setSignals] = useState(() => initialData?.signals || []);
  const [outreachSubject, setOutreachSubject] = useState(() => initialData?.outreachDraft?.subject || "");
  const [outreachBody, setOutreachBody] = useState(() => initialData?.outreachDraft?.body || "");
  const [showBlindPreview, setShowBlindPreview] = useState(false);
  const [duplicatesReviewed, setDuplicatesReviewed] = useState(false);
  const [error, setError] = useState("");
  const mpcReview = useMemo(() => buildMpcReview({ positioning: { headline, summary, strengths, caveats: caveats.split("\n").map((line) => line.trim()).filter(Boolean) }, targets, contacts, signals, outreachDraft: { subject: outreachSubject, body: outreachBody } }), [headline, summary, strengths, caveats, targets, contacts, signals, outreachSubject, outreachBody]);
  const targetDuplicates = mpcReview.dedupe.targets.duplicates;
  const targetPossibleMatches = mpcReview.dedupe.targets.possibleMatches;
  const contactDuplicates = mpcReview.dedupe.contacts.duplicates;
  const contactPossibleMatches = mpcReview.dedupe.contacts.possibleMatches;
  const targetWarnings = [
    ...targetDuplicates.map((item) => `Rows ${item.keepIndex + 1} and ${item.duplicateIndex + 1} share ${item.reason}; the repeated row will be excluded.`),
    ...targetPossibleMatches.map((item) => `Rows ${item.leftIndex + 1} and ${item.rightIndex + 1} may match (${item.reason}); both remain separate.`),
  ];
  const contactWarnings = [
    ...contactDuplicates.map((item) => `Rows ${item.keepIndex + 1} and ${item.duplicateIndex + 1} share ${item.reason}; the repeated row will be excluded.`),
    ...contactPossibleMatches.map((item) => `Rows ${item.leftIndex + 1} and ${item.rightIndex + 1} may match (${item.reason}); both remain separate.`),
  ];
  const hasMatches = targetDuplicates.length || targetPossibleMatches.length || contactDuplicates.length || contactPossibleMatches.length;
  const updateRow = (setRows, index, key, value) => { setDuplicatesReviewed(false); setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row)); };
  const eligibleTargets = targets.filter((row) => row.companyName.trim());
  const eligibleContacts = contacts.filter((row) => row.name.trim() || row.email.trim() || row.linkedinUrl.trim());
  const verifiedTargetCount = eligibleTargets.filter(sourceComplete).length;
  const verifiedContactCount = eligibleContacts.filter(sourceComplete).length;
  const candidateForExport = { id: candidate?.id, name: candidate?.candidate_name, candidate_name: candidate?.candidate_name, current_title: candidate?.current_title || "", employers: [candidate?.current_company].filter(Boolean) };
  const blindExport = buildMpcBlindExport({ candidate: candidateForExport, positioning: mpcReview.positioning, approvedFields: {}, targets: mpcReview.targets, contacts: mpcReview.contacts, signals: mpcReview.signals, evidence: mpcReview.evidence });
  const blindPreviewLines = [blindExport.preview.title ? `Title: ${blindExport.preview.title}` : "", blindExport.preview.positioning, blindExport.preview.sellingBullets.length ? `Selling points:\n${blindExport.preview.sellingBullets.map((item) => `• ${item}`).join("\n")}` : ""].filter(Boolean);
  const blindPreview = blindPreviewLines.join("\n\n");

  const submit = async () => {
    setError("");
    const weakTargets = eligibleTargets.filter((row) => !sourceComplete(row));
    const weakContacts = eligibleContacts.filter((row) => !sourceComplete(row));
    if (weakTargets.length || weakContacts.length) {
      setError("Add a source link and date for every company or contact you want to include, or remove that row.");
      return;
    }
    if (!eligibleTargets.length && !eligibleContacts.length && !initialData) {
      setError("Add at least one sourced company or contact before saving this review.");
      return;
    }
    if (hasMatches && !duplicatesReviewed) {
      setError("Review the possible duplicates and confirm whether these are separate records before saving.");
      return;
    }
    try {
      await onSave?.({
        candidateId: candidate?.id,
        candidate: candidateForExport,
        positioning: {
          headline,
          summary,
          sourceUrl: summarySourceUrl,
          observedAt: summaryObservedAt,
          strengths: strengths.filter((row) => row.text.trim()),
          caveats: caveats.split("\n").map((line) => line.trim()).filter(Boolean),
        },
        targets: eligibleTargets,
        contacts: eligibleContacts,
        signals: signals.filter((row) => row.signal.trim()),
        outreachDraft: { subject: outreachSubject, body: outreachBody },
      });
    } catch (cause) {
      setError(cause.message || "The review could not be saved. Your entries are still here; try again.");
    }
  };

  const downloadBlind = () => {
    if (!blindExport.complete) return;
    const file = new Blob([blindPreview], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = "candidate-marketing-blind-review.txt";
    link.click();
    URL.revokeObjectURL(url);
  };

  return <Card data-testid="mpc-intake-form">
    <CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="text-base">Candidate marketing review</CardTitle><CardDescription>Use information you provide. Workbench does not search the web or send outreach.</CardDescription></div><Button type="button" variant="outline" size="sm" onClick={onCancel}><X data-icon="inline-start" />Close</Button></div></CardHeader>
    <CardContent className="grid gap-5">
      <section className="rounded-md border bg-muted/20 p-3"><p className="text-xs text-muted-foreground">Candidate from the saved Tracker record</p><p className="font-semibold">{candidate?.candidate_name || candidate?.name || "Candidate name not on file"}</p><p className="text-sm text-muted-foreground">{candidate?.current_title || candidate?.title || "Title not on file"}{candidate?.current_company ? ` · ${candidate.current_company}` : ""}</p></section>
      <section className="grid gap-3" aria-labelledby="mpc-targets-title"><div className="flex flex-wrap items-center justify-between gap-2"><div><h3 id="mpc-targets-title" className="font-semibold">Target companies</h3><p className="text-sm text-muted-foreground">Add only companies with a source link and a date you checked it.</p></div><p className="text-xs text-muted-foreground">{verifiedTargetCount} of {eligibleTargets.length} sourced</p></div>{!targets.length ? <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">No target companies added.</p> : null}
        {targets.map((row, index) => <div className="grid gap-3 rounded-md border p-3" key={`target-${index}`}><div className="flex items-center justify-between gap-2"><h4 className="text-sm font-medium">Company {index + 1}</h4><Button type="button" variant="ghost" size="sm" onClick={() => setTargets((current) => current.filter((_, rowIndex) => rowIndex !== index))}>Remove</Button></div><div className="grid gap-3 sm:grid-cols-2"><div className="grid gap-1.5"><Label htmlFor={`mpc-company-${index}`}>Company name</Label><Input id={`mpc-company-${index}`} value={row.companyName} onChange={(event) => updateRow(setTargets, index, "companyName", event.target.value)} /></div><div className="grid gap-1.5"><Label htmlFor={`mpc-website-${index}`}>Website (optional)</Label><Input id={`mpc-website-${index}`} type="url" value={row.website} onChange={(event) => updateRow(setTargets, index, "website", event.target.value)} placeholder="https://" /></div><div className="grid gap-1.5"><Label htmlFor={`mpc-location-${index}`}>Location (optional)</Label><Input id={`mpc-location-${index}`} value={row.location} onChange={(event) => updateRow(setTargets, index, "location", event.target.value)} /></div><div className="grid gap-1.5"><Label htmlFor={`mpc-target-external-${index}`}>External ID (optional)</Label><Input id={`mpc-target-external-${index}`} value={row.externalId} onChange={(event) => updateRow(setTargets, index, "externalId", event.target.value)} /></div><div className="grid gap-1.5 sm:col-span-2"><Label htmlFor={`mpc-reason-${index}`}>Why this company may fit (optional)</Label><Textarea id={`mpc-reason-${index}`} rows={2} value={row.reason} onChange={(event) => updateRow(setTargets, index, "reason", event.target.value)} /></div></div><EvidenceFields prefix={`mpc-target-${index}`} row={row} onChange={(key, value) => updateRow(setTargets, index, key, value)} /></div>)}
        <Button type="button" variant="outline" className="justify-self-start" onClick={() => setTargets((rows) => [...rows, newTarget()])}><Plus data-icon="inline-start" />Add company</Button>
      </section>
      {targetWarnings.length ? <div className="rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950" role="status"><p className="flex items-center gap-2 font-medium"><AlertTriangle size={16} />Company rows to review</p><ul className="mt-1 list-disc pl-5">{targetWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div> : null}
      <section className="grid gap-3" aria-labelledby="mpc-contacts-title"><div className="flex flex-wrap items-center justify-between gap-2"><div><h3 id="mpc-contacts-title" className="font-semibold">Contacts</h3><p className="text-sm text-muted-foreground">Contacts stay separate unless you verify a matching ID or profile link.</p></div><p className="text-xs text-muted-foreground">{verifiedContactCount} of {eligibleContacts.length} sourced</p></div>{!contacts.length ? <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">No contacts added.</p> : null}
        {contacts.map((row, index) => <div className="grid gap-3 rounded-md border p-3" key={`contact-${index}`}><div className="flex items-center justify-between gap-2"><h4 className="text-sm font-medium">Contact {index + 1}</h4><Button type="button" variant="ghost" size="sm" onClick={() => setContacts((current) => current.filter((_, rowIndex) => rowIndex !== index))}>Remove</Button></div><div className="grid gap-3 sm:grid-cols-2"><div className="grid gap-1.5"><Label htmlFor={`mpc-contact-name-${index}`}>Name</Label><Input id={`mpc-contact-name-${index}`} value={row.name} onChange={(event) => updateRow(setContacts, index, "name", event.target.value)} /></div><div className="grid gap-1.5"><Label htmlFor={`mpc-contact-title-${index}`}>Title</Label><Input id={`mpc-contact-title-${index}`} value={row.title} onChange={(event) => updateRow(setContacts, index, "title", event.target.value)} /></div><div className="grid gap-1.5"><Label htmlFor={`mpc-contact-company-${index}`}>Company</Label><Input id={`mpc-contact-company-${index}`} value={row.companyName} onChange={(event) => updateRow(setContacts, index, "companyName", event.target.value)} /></div><div className="grid gap-1.5"><Label htmlFor={`mpc-contact-email-${index}`}>Email (optional)</Label><Input id={`mpc-contact-email-${index}`} type="email" value={row.email} onChange={(event) => updateRow(setContacts, index, "email", event.target.value)} /></div><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={row.emailVerified} onChange={(event) => updateRow(setContacts, index, "emailVerified", event.target.checked)} />I verified this email</label><div className="grid gap-1.5 sm:col-span-2"><Label htmlFor={`mpc-contact-linkedin-${index}`}>LinkedIn profile (optional)</Label><Input id={`mpc-contact-linkedin-${index}`} type="url" value={row.linkedinUrl} onChange={(event) => updateRow(setContacts, index, "linkedinUrl", event.target.value)} placeholder="https://" /></div><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={row.linkedinVerified} onChange={(event) => updateRow(setContacts, index, "linkedinVerified", event.target.checked)} />I verified this profile link</label><div className="grid gap-1.5"><Label htmlFor={`mpc-contact-external-${index}`}>External ID (optional)</Label><Input id={`mpc-contact-external-${index}`} value={row.externalId} onChange={(event) => updateRow(setContacts, index, "externalId", event.target.value)} /></div><div className="grid gap-1.5 sm:col-span-2"><Label htmlFor={`mpc-contact-notes-${index}`}>Notes (optional)</Label><Textarea id={`mpc-contact-notes-${index}`} rows={2} value={row.notes} onChange={(event) => updateRow(setContacts, index, "notes", event.target.value)} /></div></div><EvidenceFields prefix={`mpc-contact-${index}`} row={row} onChange={(key, value) => updateRow(setContacts, index, key, value)} /></div>)}
        <Button type="button" variant="outline" className="justify-self-start" onClick={() => setContacts((rows) => [...rows, newContact()])}><Plus data-icon="inline-start" />Add contact</Button>
      </section>
      {contactWarnings.length ? <div className="rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950" role="status"><p className="flex items-center gap-2 font-medium"><AlertTriangle size={16} />Contact rows to review</p><ul className="mt-1 list-disc pl-5">{contactWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div> : null}
      {hasMatches ? <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={duplicatesReviewed} onChange={(event) => setDuplicatesReviewed(event.target.checked)} /><span>I reviewed the matching rows. Exact duplicates will be excluded, and possible matches will stay separate.</span></label> : null}
      <section className="grid gap-3" aria-labelledby="mpc-signals-title"><div><h3 id="mpc-signals-title" className="font-semibold">Hiring signals</h3><p className="text-sm text-muted-foreground">Signals older than 30 days will be treated as stale.</p></div>{!signals.length ? <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">No hiring signals added.</p> : null}{signals.map((row, index) => <div className="grid gap-3 rounded-md border p-3" key={`signal-${index}`}><div className="grid gap-3 sm:grid-cols-2"><div className="grid gap-1.5"><Label htmlFor={`mpc-signal-company-${index}`}>Company</Label><Input id={`mpc-signal-company-${index}`} value={row.companyName} onChange={(event) => updateRow(setSignals, index, "companyName", event.target.value)} /></div><div className="grid gap-1.5"><Label htmlFor={`mpc-signal-status-${index}`}>Signal status</Label><select id={`mpc-signal-status-${index}`} className="h-10 rounded-md border bg-background px-3 text-sm" value={row.status} onChange={(event) => updateRow(setSignals, index, "status", event.target.value)}><option value="active">Active</option><option value="unknown">Unknown</option><option value="expired">Expired</option></select></div><div className="grid gap-1.5 sm:col-span-2"><Label htmlFor={`mpc-signal-text-${index}`}>What was reported?</Label><Textarea id={`mpc-signal-text-${index}`} rows={2} value={row.signal} onChange={(event) => updateRow(setSignals, index, "signal", event.target.value)} /></div></div><EvidenceFields prefix={`mpc-signal-${index}`} row={row} kind="signal" onChange={(key, value) => updateRow(setSignals, index, key, value)} /><Button type="button" variant="ghost" size="sm" className="justify-self-start" onClick={() => setSignals((current) => current.filter((_, rowIndex) => rowIndex !== index))}>Remove signal</Button></div>)}<Button type="button" variant="outline" className="justify-self-start" onClick={() => setSignals((rows) => [...rows, newSignal()])}><Plus data-icon="inline-start" />Add signal</Button></section>
      <section className="grid gap-3" aria-labelledby="mpc-positioning-title"><div><h3 id="mpc-positioning-title" className="font-semibold">Candidate positioning</h3><p className="text-sm text-muted-foreground">Enter source-backed facts. Do not add unsupported claims.</p></div><div className="grid gap-1.5"><Label htmlFor="mpc-headline">Anonymous target title</Label><Input id="mpc-headline" value={headline} onChange={(event) => setHeadline(event.target.value)} /></div><div className="grid gap-1.5"><Label htmlFor="mpc-summary">Positioning summary</Label><Textarea id="mpc-summary" rows={3} value={summary} onChange={(event) => setSummary(event.target.value)} /></div><EvidenceFields prefix="mpc-positioning" row={{ sourceUrl: summarySourceUrl, observedAt: summaryObservedAt }} onChange={(key, value) => key === "sourceUrl" ? setSummarySourceUrl(value) : setSummaryObservedAt(value)} /><div className="grid gap-3"><h4 className="text-sm font-medium">Selling points with sources</h4>{!strengths.length ? <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">No selling points added yet. A blind export needs at least four supported points.</p> : null}{strengths.map((row, index) => <div className="grid gap-3 rounded-md border p-3" key={`strength-${index}`}><div className="grid gap-1.5"><Label htmlFor={`mpc-strength-${index}`}>Selling point</Label><Textarea id={`mpc-strength-${index}`} rows={2} value={row.text} onChange={(event) => updateRow(setStrengths, index, "text", event.target.value)} /></div><EvidenceFields prefix={`mpc-strength-${index}`} row={row} onChange={(key, value) => updateRow(setStrengths, index, key, value)} /><Button type="button" variant="ghost" size="sm" className="justify-self-start" onClick={() => setStrengths((current) => current.filter((_, rowIndex) => rowIndex !== index))}>Remove selling point</Button></div>)}<Button type="button" variant="outline" className="justify-self-start" onClick={() => setStrengths((rows) => [...rows, newStrength()])}><Plus data-icon="inline-start" />Add selling point</Button></div><div className="grid gap-1.5"><Label htmlFor="mpc-caveats">Caveats (one per line)</Label><Textarea id="mpc-caveats" rows={3} value={caveats} onChange={(event) => setCaveats(event.target.value)} /></div></section>
      <section className="grid gap-3" aria-labelledby="mpc-outreach-title"><div><h3 id="mpc-outreach-title" className="font-semibold">Unsent outreach draft</h3><p className="text-sm text-muted-foreground">Review and copy the draft yourself. Workbench will not send it.</p></div><div className="grid gap-1.5"><Label htmlFor="mpc-outreach-subject">Subject</Label><Input id="mpc-outreach-subject" value={outreachSubject} onChange={(event) => setOutreachSubject(event.target.value)} /></div><div className="grid gap-1.5"><Label htmlFor="mpc-outreach-body">Message</Label><Textarea id="mpc-outreach-body" rows={6} value={outreachBody} onChange={(event) => setOutreachBody(event.target.value)} /></div></section>
      <section className="grid gap-2 rounded-md border p-3" aria-labelledby="mpc-blind-title"><div><h3 id="mpc-blind-title" className="font-semibold">Blind export</h3><p className="text-sm text-muted-foreground">The export contains only anonymous, source-backed positioning. Candidate, employer, company, contact names, and source links are withheld.</p></div><p className="text-sm font-medium" role="status">{blindExport.complete ? "Ready for recruiter review" : "Incomplete — add four supported, identity-safe selling points and a target title."}</p>{blindExport.warnings.length ? <ul className="list-disc pl-5 text-sm text-muted-foreground">{blindExport.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}<Button type="button" variant="outline" className="justify-self-start" onClick={() => setShowBlindPreview((value) => !value)}>{showBlindPreview ? "Hide preview" : "Show exact preview"}</Button>{showBlindPreview ? <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-muted/30 p-3 text-sm">{blindPreview || "No safe content is ready yet."}</pre> : null}<Button type="button" variant="outline" className="justify-self-start" disabled={!blindExport.complete || !showBlindPreview} onClick={downloadBlind}>Download blind review</Button></section>
      {error ? <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive" role="alert">{error}</p> : null}
      <div className="flex flex-wrap gap-2"><Button type="button" disabled={busy} onClick={() => void submit()}><Save data-icon="inline-start" />{busy ? "Saving review…" : "Save candidate marketing review"}</Button><p className="self-center text-xs text-muted-foreground">Saving creates a draft review. It does not send outreach.</p></div>
    </CardContent>
  </Card>;
}
