import { useEffect, useState } from "react";
import { AlertTriangle, FileCheck2, RefreshCw } from "lucide-react";
import { Badge } from "../../components/ui/badge.tsx";
import { Button } from "../../components/ui/button.tsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card.tsx";
import { LOXO_PIPELINE_STAGES } from "../candidate-review/constants.js";
import OperatorCaseWorkspace from "../operator-cases/OperatorCaseWorkspace.jsx";
import { listOperatorCases, operatorCasesEnabled } from "../operator-cases/operatorCaseService.js";
import { loadProcessData } from "./processService.js";

function LoadingState() {
  return <div role="status" className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Loading live process data...</div>;
}

function ErrorState({ message, onRetry }) {
  return <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4"><p className="text-sm font-medium">{message}</p><Button className="mt-3" size="sm" variant="outline" onClick={onRetry}><RefreshCw size={14} /> Retry</Button></div>;
}

export default function ProcessPage() {
  const [state, setState] = useState({ status: "loading", data: null, error: "" });
  const [caseState, setCaseState] = useState({ status: operatorCasesEnabled ? "loading" : "disabled", items: [], error: "", requestId: 0 });
  const [selectedCaseId, setSelectedCaseId] = useState("");

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

  useEffect(() => {
    if (!operatorCasesEnabled) return undefined;
    let active = true;
    setCaseState((current) => ({ ...current, status: "loading", error: "" }));
    listOperatorCases()
      .then((items) => { if (active) setCaseState((current) => ({ ...current, status: "ready", items, error: "" })); })
      .catch((error) => { if (active) setCaseState((current) => ({ ...current, status: "error", error: error.message || "Approval history could not be loaded." })); });
    return () => { active = false; };
  }, [caseState.requestId]);

  if (state.status === "loading") return <LoadingState />;
  if (state.status === "error") return <ErrorState message={state.error} onRetry={load} />;

  const { jobs, blocked } = state.data;
  return <div className="flex flex-col gap-4" data-testid="live-process-view">
    {jobs.length ? <>
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
    </> : <div className="rounded-lg border border-dashed p-8 text-center"><p className="text-sm font-medium">No active Tracker jobs</p><p className="mt-1 text-xs text-muted-foreground">Process counts will appear when active jobs are available.</p></div>}

    {operatorCasesEnabled ? <Card data-testid="process-case-history">
      <CardHeader><div className="flex items-center justify-between gap-3"><div><CardTitle className="flex items-center gap-2 text-base"><FileCheck2 size={17} />Approval history</CardTitle><CardDescription>Saved after-call and MPC review cases.</CardDescription></div><Button type="button" size="sm" variant="outline" disabled={caseState.status === "loading"} onClick={() => setCaseState((current) => ({ ...current, requestId: current.requestId + 1 }))}><RefreshCw size={14} />Refresh</Button></div></CardHeader>
      <CardContent>
        {caseState.status === "loading" ? <p className="text-sm text-muted-foreground" role="status">Loading approval history…</p> : null}
        {caseState.status === "error" ? <div className="flex flex-wrap items-center justify-between gap-2" role="alert"><p className="text-sm text-destructive">{caseState.error}</p><Button type="button" size="sm" variant="outline" onClick={() => setCaseState((current) => ({ ...current, requestId: current.requestId + 1 }))}>Retry</Button></div> : null}
        {caseState.status === "ready" && !caseState.items.length ? <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">No approval cases are saved.</p> : null}
        {caseState.items.length ? <ul className="grid gap-2 sm:grid-cols-2">{caseState.items.map((item) => <li key={item.id}><button type="button" className="w-full rounded-md border p-3 text-left hover:bg-muted/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" onClick={() => setSelectedCaseId(item.id)}><span className="block font-medium">{item.title || "Untitled case"}</span><span className="mt-1 block text-xs text-muted-foreground">{item.case_type === "mpc" ? "MPC" : "After call"} · {String(item.status || "unknown").replaceAll("_", " ")}</span></button></li>)}</ul> : null}
      </CardContent>
      <OperatorCaseWorkspace open={Boolean(selectedCaseId)} caseId={selectedCaseId} onOpenChange={(open) => { if (!open) setSelectedCaseId(""); }} onChanged={() => setCaseState((current) => ({ ...current, requestId: current.requestId + 1 }))} />
    </Card> : null}
  </div>;
}
