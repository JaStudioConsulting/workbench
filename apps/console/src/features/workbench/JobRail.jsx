import { useEffect, useId, useState } from "react";
import { GitBranch, Map, RefreshCw, UsersRound } from "lucide-react";
import { Badge } from "../../components/ui/badge.tsx";
import { Button } from "../../components/ui/button.tsx";
import { loadJobRailData } from "../recruiting/processService.js";

function JobList({ jobs, selectedJob, onSelectJob, disabled, candidateDataAvailable }) {
  const selectedId = String(selectedJob?.loxoJobId || selectedJob?.id || "");
  const hintId = useId();
  const [focusId, setFocusId] = useState(null);
  // One Tab stop for the whole list: the focused job, else the selected job, else the first.
  const tabId = [focusId, selectedId].find((id) => id && jobs.some((job) => String(job.id) === id)) ?? String(jobs[0]?.id);
  const moveFocus = (event) => {
    const keys = { ArrowDown: 1, ArrowUp: -1, Home: "first", End: "last" };
    if (!(event.key in keys)) return;
    const buttons = [...event.currentTarget.querySelectorAll("button:not(:disabled)")];
    const at = buttons.indexOf(document.activeElement);
    if (at < 0) return;
    event.preventDefault();
    const step = keys[event.key];
    const next = step === "first" ? 0 : step === "last" ? buttons.length - 1 : Math.min(Math.max(at + step, 0), buttons.length - 1);
    buttons[next].focus();
  };
  return <>
  <p id={hintId} className="sr-only">Use the up and down arrow keys to move between jobs, and Enter to select one.</p>
  <ul className="grid gap-2" aria-label="Active jobs" aria-describedby={hintId} onKeyDown={moveFocus} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocusId(null); }}>
    {jobs.map((job) => {
      const selected = String(job.id) === selectedId;
      const stageCounts = Object.entries(job.stageCounts || {}).filter(([, count]) => Number(count) > 0);
      return <li key={job.id}>
        <button
          type="button"
          disabled={disabled}
          title={disabled ? "Stop the active recording before changing jobs" : undefined}
          aria-pressed={selected}
          tabIndex={String(job.id) === tabId ? 0 : -1}
          onFocus={() => setFocusId(String(job.id))}
          className={`w-full rounded-lg border p-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 ${selected ? "border-foreground bg-muted" : "bg-background hover:bg-muted/50"}`}
          onClick={() => onSelectJob?.({ id: job.id, loxoJobId: job.id, title: job.title, company: job.company })}
        >
          <span className="flex items-start justify-between gap-2">
            <span className="min-w-0">
              <span className="block whitespace-normal break-words text-sm font-semibold">{job.title}</span>
              <span className="block whitespace-normal break-words text-xs text-muted-foreground">{job.company}</span>
            </span>
            {candidateDataAvailable ? <Badge variant="outline" className="shrink-0">{job.candidateCount}</Badge> : null}
          </span>
          {!candidateDataAvailable ? null : stageCounts.length ? <span className="mt-2 flex flex-wrap gap-1" aria-label="Nonzero stage counts">
            {stageCounts.map(([stage, count]) => <span key={stage} className="rounded border bg-muted/40 px-1.5 py-0.5 text-xs text-muted-foreground">{stage} <strong className="text-foreground">{count}</strong></span>)}
          </span> : job.candidateCount === 0 ? <span className="mt-2 block text-xs text-muted-foreground">No candidates</span> : null}
        </button>
      </li>;
    })}
  </ul>
  </>;
}

export default function JobRail({ selectedJob, onSelectJob, onOpenMap, onOpenProcess, onOpenLeads, disabled = false }) {
  const [requestId, setRequestId] = useState(0);
  const [state, setState] = useState({ phase: "loading", jobs: [], error: "", candidateDataAvailable: true });

  useEffect(() => {
    let active = true;
    setState((current) => ({ ...current, phase: "loading", error: "" }));
    loadJobRailData()
      .then((data) => {
        if (active) setState({ phase: "ready", jobs: data.jobs || [], error: "", candidateDataAvailable: data.candidateDataAvailable !== false });
      })
      .catch((error) => {
        if (active) setState({ phase: "error", jobs: [], error: error.message || "Active jobs could not be loaded.", candidateDataAvailable: false });
      });
    return () => { active = false; };
  }, [requestId]);

  return <aside className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border bg-card" aria-label="Jobs and recruiting tools" data-testid="job-rail">
    <div className="border-b p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Jobs</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Button type="button" size="sm" variant="outline" className="shrink-0 px-2" disabled={disabled} title={disabled ? "Stop the active recording before opening the map" : undefined} onClick={onOpenMap}><Map size={14} className="shrink-0" /><span>Map</span></Button>
        <Button type="button" size="sm" variant="outline" className="shrink-0 px-2" disabled={disabled} title={disabled ? "Stop the active recording before opening Process" : undefined} onClick={onOpenProcess}><GitBranch size={14} className="shrink-0" /><span>Process</span></Button>
        <Button type="button" size="sm" variant="outline" className="shrink-0 px-2" disabled={disabled} title={disabled ? "Stop the active recording before opening Leads" : undefined} onClick={onOpenLeads}><UsersRound size={14} className="shrink-0" /><span>Leads</span></Button>
      </div>
    </div>
    <div className="min-h-0 flex-1 overflow-auto p-3">
      {state.phase === "loading" ? <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground" role="status">Loading active jobs…</p> : null}
      {state.phase === "error" ? <div className="rounded-lg border border-destructive/30 p-3" role="alert"><p className="text-sm text-destructive">{state.error}</p><Button type="button" size="sm" variant="outline" className="mt-3" onClick={() => setRequestId((value) => value + 1)}><RefreshCw size={14} />Retry</Button></div> : null}
      {state.phase === "ready" && !state.jobs.length ? <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No active Tracker jobs.</p> : null}
      {state.phase === "ready" && state.jobs.length && !state.candidateDataAvailable ? <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed p-2 text-xs text-muted-foreground" role="status" data-testid="job-rail-counts-note"><span>Stage counts are not shown here.</span><Button type="button" size="sm" variant="outline" disabled={disabled} onClick={onOpenProcess}>Open Process</Button></div> : null}
      {state.phase === "ready" && state.jobs.length ? <JobList jobs={state.jobs} selectedJob={selectedJob} onSelectJob={onSelectJob} disabled={disabled} candidateDataAvailable={state.candidateDataAvailable} /> : null}
    </div>
  </aside>;
}
