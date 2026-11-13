import { useEffect, useState } from "react";
import { Bot, CheckCircle2, Cloud, Database, Mic2, RefreshCw, Workflow } from "lucide-react";
import { GoogleWorkspacePanel } from "../../components/GoogleWorkspacePanel.jsx";
import { ImportDataPanel } from "../imports/ImportDataPanel.jsx";
import { Button } from "../../components/ui/button.tsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card.tsx";
import { Checkbox } from "../../components/ui/checkbox.tsx";
import { Label } from "../../components/ui/label.tsx";
import { CANADA_FILTER_KEY, RECRUITING_TEMPLATES, loadSettingsStatus, readCanadaFilter, saveCanadaFilter } from "./settingsService.js";

function StatusCard({ icon: Icon, title, status, children }) {
  return <Card><CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Icon size={16} />{title}</CardTitle></CardHeader><CardContent><p className="text-sm font-medium">{status}</p><CardDescription>{children}</CardDescription></CardContent></Card>;
}

export default function SettingsPage({ meetingsStatusLoader }) {
  const [requestId, setRequestId] = useState(0);
  const [state, setState] = useState({ phase: "loading", status: null });
  const [canadaOnly, setCanadaOnly] = useState(() => readCanadaFilter());
  useEffect(() => {
    let active = true;
    setState({ phase: "loading", status: null });
    loadSettingsStatus({ meetingsStatusLoader })
      .then((status) => { if (active) setState({ phase: "ready", status }); })
      .catch(() => { if (active) setState({ phase: "error", status: null }); });
    return () => { active = false; };
  }, [requestId, meetingsStatusLoader]);

  return (
    <div className="flex flex-col gap-4" data-testid="settings-page">
      <div><span className="eyebrow">WORKBENCH</span><h2 className="text-lg font-semibold">Settings</h2></div>
      {state.phase === "loading" ? <div className="rounded-lg border p-5" role="status">Checking account and service status…</div> : null}
      {state.phase === "error" ? <div className="rounded-lg border p-5" role="alert"><span>Settings status could not be loaded. Check your connection and try again.</span><Button className="ml-3" variant="outline" size="sm" onClick={() => setRequestId((value) => value + 1)}><RefreshCw size={14} />Retry</Button></div> : null}
      {state.status ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatusCard icon={Database} title="Your saved work" status={state.status.supabase.error ? "Status unknown" : state.status.supabase.connected ? "Signed in" : "Not signed in"}>{state.status.supabase.error ? "We couldn't check your sign-in. Refresh this page to retry." : state.status.supabase.connected ? "Your account session is active." : "No account is signed in."}</StatusCard>
        <StatusCard icon={Cloud} title="Gmail" status={state.status.google.connected ? "Connected" : "Not confirmed"}>{state.status.google.connected ? `${state.status.google.canRead ? "Email reading is allowed. " : "Email reading isn't allowed. "}${state.status.google.canDraft ? "Draft creation is allowed." : "Draft creation isn't allowed."}` : "Gmail access hasn't been confirmed. Check the Google Workspace section below."}</StatusCard>
        <StatusCard icon={Bot} title="AI fit check" status={state.status.ai.available === null ? "Status unknown" : state.status.ai.available ? "Ready" : "Not set up"}>{state.status.ai.available === null ? "Fit-check status couldn't be confirmed." : state.status.ai.available ? "Candidate fit checks are ready." : "Candidate fit checks aren't set up."}</StatusCard>
        <StatusCard icon={Workflow} title="Loxo update notes" status="Notes only">Updates are prepared as notes for review. This page doesn't send changes to Loxo.</StatusCard>
        <StatusCard icon={Mic2} title="Meeting transcription" status={state.status.meetings.available ? "Ready" : "Not confirmed"}>{state.status.meetings.available ? "Meeting transcription is ready. Recording uses this device's microphone." : "Meeting transcription isn't ready or its status couldn't be checked."}</StatusCard>
      </div> : null}
      <Card><CardHeader><CardTitle className="text-base">Defaults</CardTitle><CardDescription>Applied to recruiter views. You can change the Canada filter at any time.</CardDescription></CardHeader><CardContent className="flex items-center gap-2"><Checkbox id={CANADA_FILTER_KEY} checked={canadaOnly} onCheckedChange={(value) => { const enabled = Boolean(value); setCanadaOnly(enabled); saveCanadaFilter(enabled); }} /><Label htmlFor={CANADA_FILTER_KEY}>Show Canadian candidates by default</Label></CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">Recruiting templates</CardTitle><CardDescription>Read-only output list.</CardDescription></CardHeader><CardContent><ul className="grid gap-2 sm:grid-cols-2">{RECRUITING_TEMPLATES.map((template) => <li key={template} className="flex items-center gap-2 rounded-md border p-2.5 text-sm"><CheckCircle2 size={15} className="text-primary" />{template}</li>)}</ul></CardContent></Card>
      <ImportDataPanel />
      <GoogleWorkspacePanel />
    </div>
  );
}
