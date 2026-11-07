import { useEffect, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Badge } from "../../components/ui/badge.tsx";
import { Button } from "../../components/ui/button.tsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card.tsx";
import { LOXO_PIPELINE_STAGES } from "../candidate-review/constants.js";
import { loadProcessData } from "./processService.js";

function LoadingState() {
  return <div role="status" className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Loading live process data...</div>;
}

function ErrorState({ message, onRetry }) {
  return <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4"><p className="text-sm font-medium">{message}</p><Button className="mt-3" size="sm" variant="outline" onClick={onRetry}><RefreshCw size={14} /> Retry</Button></div>;
}

export default function ProcessPage() {
  const [state, setState] = useState({ status: "loading", data: null, error: "" });

  const load = async () => {
    setState((current) => ({ ...current, status: "loading", error: "" }));
    try {
      const data = await loadProcessData();
      setState({ status: "ready", data, error: "" });
    } catch (error) {
      setState({ status: "error", data: null, error: error.message || "Could not load process data" });
    }
  };

  useEffect(() => {
    load();
  }, []);

  if (state.status === "loading") return <LoadingState />;
  if (state.status === "error") return <ErrorState message={state.error} onRetry={load} />;

  const { jobs, blocked } = state.data;
  if (!jobs.length) {
    return <div className="rounded-lg border border-dashed p-8 text-center"><p className="text-sm font-medium">No active Tracker jobs</p><p className="mt-1 text-xs text-muted-foreground">Process counts will appear when active jobs are available.</p></div>;
  }

  return <div className="flex flex-col gap-4" data-testid="live-process-view">
    <Card>
      <CardHeader><CardTitle>Stage counts by job</CardTitle><CardDescription>Live candidate counts from the review feed.</CardDescription></CardHeader>
      <CardContent className="grid gap-3 xl:grid-cols-2">
        {jobs.map((job) => <article key={job.id} className="rounded-lg border bg-background p-4">
          <div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold">{job.title}</h3><p className="text-sm text-muted-foreground">{job.company}</p></div><Badge variant="outline">{job.candidateCount} candidates</Badge></div>
          <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {LOXO_PIPELINE_STAGES.map((stage) => <div key={stage} className="flex items-center justify-between gap-2 rounded-md bg-muted/40 px-2.5 py-2"><dt className="text-xs text-muted-foreground">{stage}</dt><dd className="text-sm font-semibold tabular-nums">{job.stageCounts[stage]}</dd></div>)}
          </dl>
        </article>)}
      </CardContent>
    </Card>

    <Card>
      <CardHeader><div className="flex items-center justify-between gap-3"><div><CardTitle>Blocked</CardTitle><CardDescription>Items needing review before the process can move.</CardDescription></div><Badge variant={blocked.length ? "outline" : "secondary"}>{blocked.length}</Badge></div></CardHeader>
      <CardContent>
        {blocked.length ? <ul className="space-y-2">{blocked.map((item) => <li key={item.id} className="flex items-start gap-3 rounded-md border p-3"><AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-700" aria-hidden="true" /><div><p className="text-sm font-medium">{item.label}</p><p className="text-xs text-muted-foreground">{item.detail}</p></div></li>)}</ul> : <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">No blocked items found.</p>}
      </CardContent>
    </Card>
  </div>;
}
