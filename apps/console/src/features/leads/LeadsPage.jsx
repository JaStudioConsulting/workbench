import { useCallback, useEffect, useState } from "react";
import { Building2, ExternalLink, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "../../components/ui/button.tsx";
import { Badge } from "../../components/ui/badge.tsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card.tsx";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog.tsx";
import { Input } from "../../components/ui/input.tsx";
import { Label } from "../../components/ui/label.tsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table.tsx";
import { Textarea } from "../../components/ui/textarea.tsx";
import { deleteLead, findLeadDuplicates, loadClientCompanies, loadLeadsWithStatus, saveLead } from "./leadsService.js";

const EMPTY_LEAD = Object.freeze({ company: "", contact: "", email: "", linkedinUrl: "", externalId: "", externalIdSource: "", companyWebsite: "", role: "", status: "", nextAction: "", nextDate: "", notes: "" });
const INITIAL_LEADS_STATE = Object.freeze({ phase: "loading", companies: [], leads: [], leadsStorage: null, error: "" });

function formatDate(value) {
  if (!value) return "Not on file";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date)
    : "Not on file";
}

function LeadForm({ value, onChange }) {
  const update = (field) => (event) => onChange({ ...value, [field]: event.target.value });
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="grid gap-2"><Label htmlFor="lead-company">Company</Label><Input id="lead-company" required value={value.company} onChange={update("company")} /></div>
      <div className="grid gap-2"><Label htmlFor="lead-contact">Contact</Label><Input id="lead-contact" value={value.contact} onChange={update("contact")} /></div>
      <div className="grid gap-2"><Label htmlFor="lead-email">Email</Label><Input id="lead-email" type="email" autoComplete="email" value={value.email || ""} onChange={update("email")} /></div>
      <div className="grid gap-2"><Label htmlFor="lead-linkedin">LinkedIn</Label><Input id="lead-linkedin" type="url" autoComplete="url" value={value.linkedinUrl || ""} onChange={update("linkedinUrl")} placeholder="https://www.linkedin.com/in/example" /></div>
      <div className="grid gap-2"><Label htmlFor="lead-external-id">External ID</Label><Input id="lead-external-id" value={value.externalId || ""} onChange={update("externalId")} /></div>
      <div className="grid gap-2"><Label htmlFor="lead-external-id-source">ID source</Label><Input id="lead-external-id-source" value={value.externalIdSource || ""} onChange={update("externalIdSource")} placeholder="Example: Loxo" /></div>
      <div className="grid gap-2 sm:col-span-2"><Label htmlFor="lead-company-website">Company website</Label><Input id="lead-company-website" type="url" autoComplete="url" value={value.companyWebsite || ""} onChange={update("companyWebsite")} placeholder="https://example.com" /></div>
      <div className="grid gap-2"><Label htmlFor="lead-role">Role</Label><Input id="lead-role" value={value.role} onChange={update("role")} /></div>
      <div className="grid gap-2"><Label htmlFor="lead-status">Status</Label><Input id="lead-status" value={value.status} onChange={update("status")} /></div>
      <div className="grid gap-2"><Label htmlFor="lead-next-action">Next action</Label><Input id="lead-next-action" value={value.nextAction} onChange={update("nextAction")} /></div>
      <div className="grid gap-2"><Label htmlFor="lead-next-date">Next date</Label><Input id="lead-next-date" type="date" value={value.nextDate} onChange={update("nextDate")} /></div>
      <div className="grid gap-2 sm:col-span-2"><Label htmlFor="lead-notes">Notes</Label><Textarea id="lead-notes" rows={4} value={value.notes} onChange={update("notes")} /></div>
    </div>
  );
}

export default function LeadsPage({ focusLeadId = "", focusClient = null, initialState = INITIAL_LEADS_STATE } = {}) {
  const [state, setState] = useState(initialState);
  const [reloadKey, setReloadKey] = useState(0);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [duplicateMatches, setDuplicateMatches] = useState({ exact: [], possible: [] });
  const [keepSeparate, setKeepSeparate] = useState(false);
  const [deleteFailure, setDeleteFailure] = useState(null);

  const load = useCallback(() => setReloadKey((value) => value + 1), []);
  useEffect(() => {
    let active = true;
    setState((current) => ({ ...current, phase: "loading", error: "" }));
    Promise.all([loadClientCompanies(), loadLeadsWithStatus()])
      .then(([companies, leadsResult]) => { if (active) setState({ phase: "ready", companies, leads: leadsResult.leads, leadsStorage: leadsResult, error: "" }); })
      .catch((error) => { if (active) setState({ phase: "error", companies: [], leads: [], leadsStorage: null, error: error?.message || "Leads could not be loaded. Check your connection and try again." }); });
    return () => { active = false; };
  }, [reloadKey]);

  const openNew = () => { setFormError(""); setDuplicateMatches({ exact: [], possible: [] }); setKeepSeparate(false); setEditing({ ...EMPTY_LEAD }); };
  const openExisting = (lead) => { setFormError(""); setDuplicateMatches({ exact: [], possible: [] }); setKeepSeparate(false); setEditing({ ...lead }); };
  const openDuplicate = (lead) => {
    const hasUnsavedDetails = Object.entries(editing || {}).some(([field, value]) => value && value !== EMPTY_LEAD[field]);
    if (hasUnsavedDetails && !globalThis.confirm?.("Discard this unsaved lead and open the existing lead?")) return;
    openExisting(lead);
  };
  const updateEditing = (value) => { setEditing(value); setDuplicateMatches({ exact: [], possible: [] }); setKeepSeparate(false); };
  const submit = async (event) => {
    event.preventDefault();
    const matches = findLeadDuplicates(editing, state.leads);
    if (!keepSeparate && (matches.exact.length || matches.possible.length)) {
      setDuplicateMatches(matches);
      setFormError("");
      return;
    }
    setSaving(true);
    setFormError("");
    try {
      const saved = await saveLead(editing);
      setState((current) => ({ ...current, leadsStorage: saved.persistence === "local" && current.leadsStorage ? { ...current.leadsStorage, storage: "local", reason: "table_missing" } : current.leadsStorage, leads: [saved, ...current.leads.filter((lead) => lead.id !== saved.id)] }));
      setEditing(null);
      setDuplicateMatches({ exact: [], possible: [] });
      setKeepSeparate(false);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Lead could not be saved.");
    } finally {
      setSaving(false);
    }
  };
  const remove = async (lead, { confirmed = false } = {}) => {
    if (!confirmed && !globalThis.confirm?.(`Delete the lead for ${lead.company}?`)) return;
    setDeleteFailure(null);
    try {
      await deleteLead(lead.id);
      setState((current) => ({ ...current, leads: current.leads.filter((item) => item.id !== lead.id) }));
    } catch (error) {
      setDeleteFailure({ lead, message: error instanceof Error ? error.message : "Lead could not be deleted." });
    }
  };

  if (state.phase === "loading") return <section className="rounded-xl border p-6" role="status">Loading leads...</section>;
  if (state.phase === "error") return <section className="rounded-xl border p-6" role="alert"><p>{state.error}</p><Button className="mt-4" variant="outline" onClick={load}><RefreshCw /> Retry</Button></section>;

  const storageState = state.leadsStorage;
  const storageLabel = !storageState
    ? ""
    : storageState.storage === "supabase"
      ? "Saved to your account"
      : storageState.signedIn
        ? "Saved on this device only. Cloud saving is unavailable."
        : "Saved on this device only. Sign in to sync.";

  return (
    <div className="flex flex-col gap-6" data-testid="leads-page">
      {state.error ? <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm" role="alert">{state.error} <Button type="button" variant="outline" size="sm" className="ml-2" onClick={load}>Retry</Button></div> : null}
      <section aria-labelledby="client-companies-title">
        <div className="mb-3"><h2 id="client-companies-title" className="text-lg font-semibold">Client companies</h2><p className="text-sm text-muted-foreground">Active companies from Tracker jobs.</p></div>
        {focusClient?.entityId && !state.companies.some((item) => item.company.trim().toLowerCase() === String(focusClient.entityId).trim().toLowerCase()) ? (
          <Card className="mb-3 border-primary ring-2 ring-primary/30" data-testid="focused-client-card" data-focused="true">
            <CardHeader><div className="flex items-start justify-between gap-3"><div><CardTitle className="flex items-center gap-2"><Building2 size={17} aria-hidden="true" />{focusClient.company || focusClient.entityId}</CardTitle><CardDescription>{focusClient.status || "Status not on file"}</CardDescription></div></div></CardHeader>
            <CardContent className="grid gap-2 text-sm sm:grid-cols-2"><p><span className="text-muted-foreground">Roles:</span> {focusClient.jobTitles || "Not on file"}</p><p><span className="text-muted-foreground">Location:</span> {focusClient.location || "Not on file"}</p><p><span className="text-muted-foreground">Client contact:</span> {focusClient.clientContact || "Not on file"}</p></CardContent>
          </Card>
        ) : null}
        {state.companies.length === 0 ? <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">No client companies found in active Tracker jobs.</div> : (
          <div className="grid gap-3 lg:grid-cols-2">
            {state.companies.map((company) => {
              const isFocusedClient = Boolean(focusClient?.entityId && company.company.trim().toLowerCase() === String(focusClient.entityId).trim().toLowerCase());
              return (
                <Card key={company.company} data-focused={isFocusedClient ? "true" : undefined} className={isFocusedClient ? "border-primary ring-2 ring-primary/30" : undefined}>
                  <CardHeader><div className="flex items-start justify-between gap-3"><div><CardTitle className="flex items-center gap-2"><Building2 size={17} aria-hidden="true" />{company.company}</CardTitle><CardDescription>{company.openJobsCount} open job{company.openJobsCount === 1 ? "" : "s"}</CardDescription></div>{company.loxoLink ? <Button variant="outline" size="sm" render={<a href={company.loxoLink} target="_blank" rel="noreferrer" aria-label={`Open ${company.company} in Loxo`} />}><ExternalLink /> Loxo</Button> : null}</div></CardHeader>
                  <CardContent className="grid gap-2 text-sm sm:grid-cols-2"><p><span className="text-muted-foreground">Owners:</span> {company.owners.length ? company.owners.join(", ") : "Not on file"}</p><p><span className="text-muted-foreground">Newest job:</span> {formatDate(company.newestJobDate)}</p></CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <section aria-labelledby="my-leads-title" className="w-full min-w-0 max-w-full">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><h2 id="my-leads-title" className="text-lg font-semibold">My leads</h2>{storageLabel ? <Badge variant="outline" className={storageState.storage === "supabase" ? "" : "border-amber-700/30 bg-amber-50 text-amber-900"}>{storageLabel}</Badge> : null}</div><p className="text-sm text-muted-foreground">Business development leads you add and maintain.</p></div><Button onClick={openNew}><Plus /> Add lead</Button></div>
        {deleteFailure ? <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm" role="alert"><span>{deleteFailure.message}</span><Button type="button" variant="outline" size="sm" onClick={() => remove(deleteFailure.lead, { confirmed: true })}>Retry delete {deleteFailure.lead.company}</Button><Button type="button" variant="ghost" size="sm" onClick={() => setDeleteFailure(null)}>Dismiss</Button></div> : null}
        {state.leads.length === 0 ? <div className="rounded-xl border border-dashed p-8 text-center"><p className="font-medium">No leads added</p><p className="mt-1 text-sm text-muted-foreground">Add a lead when you have a real company or contact to track.</p></div> : (
          <div className="w-full min-w-0 max-w-full rounded-xl border [&_[data-slot=table-container]]:min-w-0"><Table><TableHeader><TableRow><TableHead>Company</TableHead><TableHead>Contact</TableHead><TableHead>Status</TableHead><TableHead>Next action</TableHead><TableHead>Next date</TableHead><TableHead><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader><TableBody>{state.leads.map((lead) => { const isFocusedLead = Boolean(focusLeadId && String(lead.id).toLowerCase() === String(focusLeadId).toLowerCase()); return <TableRow key={lead.id} data-focused={isFocusedLead ? "true" : undefined} className={isFocusedLead ? "bg-accent/60" : undefined}><TableCell><p className="font-medium">{lead.company}</p>{lead.persistence === "local" ? <Badge variant="outline" className="mt-1">Device only</Badge> : null}<p className="text-xs text-muted-foreground">{lead.role || "Role not on file"}</p></TableCell><TableCell>{lead.contact || lead.email || "Not on file"}</TableCell><TableCell>{lead.status || "Not on file"}</TableCell><TableCell>{lead.nextAction || "Not on file"}</TableCell><TableCell>{formatDate(lead.nextDate)}</TableCell><TableCell className="w-0"><div className="flex justify-end gap-1"><Button variant="ghost" size="icon-sm" aria-label={`Edit ${lead.company}`} onClick={() => openExisting(lead)}><Pencil /></Button><Button variant="ghost" size="icon-sm" aria-label={`Delete ${lead.company}`} onClick={() => remove(lead)}><Trash2 /></Button></div></TableCell></TableRow>; })}</TableBody></Table></div>
        )}
      </section>

      <Dialog open={Boolean(editing)} onOpenChange={(open) => { if (!open && !saving) setEditing(null); }}>
        <DialogContent className="sm:max-w-2xl">
          <form onSubmit={submit}>
            <DialogHeader><DialogTitle>{editing?.id ? "Edit lead" : "Add lead"}</DialogTitle><DialogDescription>Enter only details you know. Company is required.</DialogDescription></DialogHeader>
            <div className="py-4">{editing ? <LeadForm value={editing} onChange={updateEditing} /> : null}{duplicateMatches.exact.length || duplicateMatches.possible.length ? <div className="mt-4 grid gap-2 rounded-md border border-amber-700/30 bg-amber-50 p-3 text-sm text-amber-950" role="alert"><p className="font-medium">Review possible matches before saving.</p>{duplicateMatches.exact.map(({ lead, matchedBy }) => <div key={lead.id} className="flex flex-wrap items-center justify-between gap-2"><span>Same {matchedBy.join(", ")}: {lead.company}{lead.contact ? ` · ${lead.contact}` : ""}</span><Button type="button" size="sm" variant="outline" onClick={() => openDuplicate(lead)}>Open existing lead</Button></div>)}{duplicateMatches.possible.map((lead) => <div key={lead.id} className="flex flex-wrap items-center justify-between gap-2"><span>Same website domain as {lead.company}; this may be a different contact.</span><Button type="button" size="sm" variant="outline" onClick={() => openDuplicate(lead)}>Open existing lead</Button></div>)}{keepSeparate ? <p role="status">You chose to keep this lead separate. Select Save lead to continue.</p> : <Button type="button" variant="outline" className="justify-self-start" onClick={() => setKeepSeparate(true)}>Keep as a separate lead</Button>}</div> : null}{formError ? <p className="mt-3 text-sm text-destructive" role="alert">{formError}</p> : null}</div>
            <DialogFooter><Button type="button" variant="outline" onClick={() => setEditing(null)} disabled={saving}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? "Saving..." : "Save lead"}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export { LeadsPage };
