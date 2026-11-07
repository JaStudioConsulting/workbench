import { useEffect, useState } from "react";
import { Bot, CheckCircle2, Cloud, Database, Mic2, RefreshCw, Workflow } from "lucide-react";
import { GoogleWorkspacePanel } from "../../components/GoogleWorkspacePanel.jsx";
import { Button } from "../../components/ui/button.tsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card.tsx";
import { Checkbox } from "../../components/ui/checkbox.tsx";
import { Label } from "../../components/ui/label.tsx";
import { CANADA_FILTER_KEY, RECRUITING_TEMPLATES, loadSettingsStatus, readCanadaFilter, saveCanadaFilter } from "./settingsService.js";

function StatusCard({ icon: Icon, title, connected, children }) {
  return <Card><CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Icon size={16} />{title}</CardTitle></CardHeader><CardContent><p className="text-sm font-medium">{connected ? "Available" : "Not available"}</p><CardDescription>{children}</CardDescription></CardContent></Card>;
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
      {state.phase === "loading" ? <div className="rounded-lg border p-5" role="status">Checking connections...</div> : null}
      {state.phase === "error" ? <div className="rounded-lg border p-5" role="alert">Connection status could not be loaded.<Button className="ml-3" variant="outline" size="sm" onClick={() => setRequestId((value) => value + 1)}><RefreshCw size={14} />Retry</Button></div> : null}
      {state.status ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatusCard icon={Database} title="Supabase" connected={state.status.supabase.connected}>{state.status.supabase.connected ? "Signed-in data session." : "No Supabase session."}</StatusCard>
        <StatusCard icon={Cloud} title="Google" connected={state.status.google.connected}>{state.status.google.connected ? `${state.status.google.canRead ? "Gmail read available. " : "Gmail read not granted. "}${state.status.google.canDraft ? "Draft creation available." : "Draft creation not granted."}` : "Google is not connected."}</StatusCard>
        <StatusCard icon={Bot} title="AI fit check" connected={state.status.ai.available}>{state.status.ai.label}</StatusCard>
        <StatusCard icon={Workflow} title="Loxo" connected={state.status.loxo.queued}>{state.status.loxo.label}</StatusCard>
        <StatusCard icon={Mic2} title="Meetings" connected={state.status.meetings.available}>{state.status.meetings.label}</StatusCard>
      </div> : null}
      <Card><CardHeader><CardTitle className="text-base">Defaults</CardTitle><CardDescription>Applied to recruiter views. You can change the Canada filter at any time.</CardDescription></CardHeader><CardContent className="flex items-center gap-2"><Checkbox id={CANADA_FILTER_KEY} checked={canadaOnly} onCheckedChange={(value) => { const enabled = Boolean(value); setCanadaOnly(enabled); saveCanadaFilter(enabled); }} /><Label htmlFor={CANADA_FILTER_KEY}>Show Canadian candidates by default</Label></CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">Recruiting templates</CardTitle><CardDescription>Read-only output list.</CardDescription></CardHeader><CardContent><ul className="grid gap-2 sm:grid-cols-2">{RECRUITING_TEMPLATES.map((template) => <li key={template} className="flex items-center gap-2 rounded-md border p-2.5 text-sm"><CheckCircle2 size={15} className="text-primary" />{template}</li>)}</ul></CardContent></Card>
      <GoogleWorkspacePanel />
    </div>
  );
}
