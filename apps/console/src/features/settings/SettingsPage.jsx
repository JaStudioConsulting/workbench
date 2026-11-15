import { useEffect, useState } from "react";
import { CheckCircle2, Database, Mic2, RefreshCw, Workflow } from "lucide-react";
import { GoogleWorkspacePanel } from "../../components/GoogleWorkspacePanel.jsx";
import { googleWorkspaceEnabled } from "../../featureFlags.js";
import { ImportDataPanel } from "../imports/ImportDataPanel.jsx";
import { Button } from "../../components/ui/button.tsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card.tsx";
import { Checkbox } from "../../components/ui/checkbox.tsx";
import { Label } from "../../components/ui/label.tsx";
import { CANADA_FILTER_KEY, RECRUITING_TEMPLATES, loadSettingsStatus, readCanadaFilter, saveCanadaFilter } from "./settingsService.js";

function StatusCard({ icon: Icon, title, status, children }) {
  return <Card><CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Icon size={16} />{title}</CardTitle></CardHeader><CardContent><p className="text-sm font-medium">{status}</p><CardDescription>{children}</CardDescription></CardContent></Card>;
}

export default function SettingsPage() {
  const [requestId, setRequestId] = useState(0);
  const [state, setState] = useState({ phase: "loading", status: null });
  const [canadaOnly, setCanadaOnly] = useState(() => readCanadaFilter());
  useEffect(() => {
    let active = true;
    setState({ phase: "loading", status: null });
    loadSettingsStatus()
      .then((status) => { if (active) setState({ phase: "ready", status }); })
      .catch(() => { if (active) setState({ phase: "error", status: null }); });
    return () => { active = false; };
  }, [requestId]);
  return (
    <div className="flex flex-col gap-4" data-testid="settings-page">
      <div><span className="eyebrow">WORKBENCH</span><h2 className="text-lg font-semibold">Settings</h2></div>
      {state.phase === "loading" ? <div className="rounded-lg border p-5" role="status">Checking account and service status…</div> : null}
      {state.phase === "error" ? <div className="rounded-lg border p-5" role="alert"><span>Settings status could not be loaded. Check your connection and try again.</span><Button className="ml-3" variant="outline" size="sm" onClick={() => setRequestId((value) => value + 1)}><RefreshCw size={14} />Retry</Button></div> : null}
      {state.status ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatusCard icon={Database} title="Your saved work" status={state.status.supabase.error ? "Status unknown" : state.status.supabase.connected ? "Connected" : "Not connected"}>{state.status.supabase.error ? "Workbench could not reach your workspace. Reload the page, then check again." : state.status.supabase.connected ? "Your workspace session is active." : "Workbench could not reach your workspace. Reload the page, then try again."}</StatusCard>
        <StatusCard icon={Workflow} title="Loxo update notes" status="Notes only">Updates are prepared as notes for review. This page doesn't send changes to Loxo.</StatusCard>
        <StatusCard icon={Mic2} title="Recordings" status="Audio only">Save and download recordings. Import or paste transcript text when available.</StatusCard>
      </div> : null}
      <Card><CardHeader><CardTitle className="text-base">Defaults</CardTitle><CardDescription>Applied to recruiter views. You can change the Canada filter at any time.</CardDescription></CardHeader><CardContent className="flex items-center gap-2"><Checkbox id={CANADA_FILTER_KEY} checked={canadaOnly} onCheckedChange={(value) => { const enabled = Boolean(value); setCanadaOnly(enabled); saveCanadaFilter(enabled); }} /><Label htmlFor={CANADA_FILTER_KEY}>Show Canadian candidates by default</Label></CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">Recruiting templates</CardTitle><CardDescription>Read-only output list.</CardDescription></CardHeader><CardContent><ul className="grid gap-2 sm:grid-cols-2">{RECRUITING_TEMPLATES.map((template) => <li key={template} className="flex items-center gap-2 rounded-md border p-2.5 text-sm"><CheckCircle2 size={15} className="text-primary" />{template}</li>)}</ul></CardContent></Card>
      <ImportDataPanel />
      {googleWorkspaceEnabled ? <GoogleWorkspacePanel /> : null}
    </div>
  );
}
