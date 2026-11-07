import { useEffect, useMemo, useState } from "react";
import { DragDropProvider, useDraggable, useDroppable } from "@dnd-kit/react";
import { GripVertical, MapPin, RefreshCw } from "lucide-react";
import { Badge } from "../../components/ui/badge.tsx";
import { Button } from "../../components/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card.tsx";
import { Checkbox } from "../../components/ui/checkbox.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select.tsx";
import {
  loadLiveCandidatesForJob,
  loadLiveReviewJobs,
  logCandidateActivity,
} from "../candidate-review/candidateReviewService.js";
import { LOXO_PIPELINE_STAGES } from "../candidate-review/constants.js";
import FitBadge from "./FitBadge.jsx";
import { isInCanada } from "./location.js";

function CandidateCard({ job, candidate, waiting, onMove, onOpenCandidate }) {
  const { ref, handleRef, isDragging } = useDraggable({
    id: `candidate:${candidate.id}`,
    type: "candidate",
    data: { candidateId: candidate.id, stage: candidate.stage },
  });

  return <article ref={ref} className={`rounded-lg border bg-card p-3 shadow-sm ${isDragging ? "opacity-60" : ""}`}>
    <div className="flex items-start gap-2">
      <button
        ref={handleRef}
        type="button"
        className="mt-0.5 rounded p-1 text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Move ${candidate.name} by drag and drop`}
      ><GripVertical size={16} /></button>
      <div className="min-w-0 flex-1">
        <button
          type="button"
          className="w-full rounded-sm text-left font-semibold outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => onOpenCandidate?.(job.id, candidate.id)}
        >{candidate.name || "Unnamed candidate"}</button>
        <p className="truncate text-sm text-muted-foreground">{candidate.title || "Title not recorded"}</p>
      </div>
      <FitBadge job={job} candidate={candidate} />
    </div>
    {candidate.location ? <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground"><MapPin size={12} /> {candidate.location}</p> : null}
    <div className="mt-3 flex items-center gap-2">
      <label className="min-w-0 flex-1 text-xs text-muted-foreground">
        <span className="sr-only">Move {candidate.name} to stage</span>
        <select
          className="h-8 w-full rounded-md border bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={candidate.stage}
          onChange={(event) => onMove(candidate.id, candidate.stage, event.target.value)}
          aria-label={`Move ${candidate.name} to stage`}
        >{LOXO_PIPELINE_STAGES.map((stage) => <option key={stage} value={stage}>{stage}</option>)}</select>
      </label>
      {waiting ? <Badge variant="outline" className="border-amber-700/30 bg-amber-50 text-amber-900">Waiting for Loxo</Badge> : null}
    </div>
  </article>;
}

function StageColumn({ stage, job, candidates, waitingIds, onMove, onOpenCandidate }) {
  const { ref, isDropTarget } = useDroppable({ id: `stage:${stage}`, type: "candidate", data: { stage } });
  return <section
    ref={ref}
    className={`flex w-72 shrink-0 flex-col rounded-xl border bg-muted/30 ${isDropTarget ? "ring-2 ring-ring" : ""}`}
    aria-label={`${stage} pipeline stage`}
  >
    <div className="flex items-center justify-between border-b px-3 py-2">
      <h3 className="text-sm font-semibold">{stage}</h3>
      <Badge variant="outline">{candidates.length}</Badge>
    </div>
    <div className="grid min-h-28 gap-2 p-2">
      {candidates.map((candidate) => <CandidateCard
        key={candidate.id}
        job={job}
        candidate={candidate}
        waiting={waitingIds.has(candidate.id)}
        onMove={onMove}
        onOpenCandidate={onOpenCandidate}
      />)}
      {!candidates.length ? <p className="self-start rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">No candidates</p> : null}
    </div>
  </section>;
}

export default function PipelinePage({ onOpenCandidate }) {
  const [jobsState, setJobsState] = useState({ phase: "loading", jobs: [], error: "" });
  const [selectedJobId, setSelectedJobId] = useState("");
  const [candidatesState, setCandidatesState] = useState({ phase: "idle", candidates: [], error: "" });
  const [canadaOnly, setCanadaOnly] = useState(false);
  const [waitingIds, setWaitingIds] = useState(new Set());
  const [moveError, setMoveError] = useState("");

  const loadJobs = async () => {
    setJobsState({ phase: "loading", jobs: [], error: "" });
    try {
      const jobs = await loadLiveReviewJobs();
      setJobsState({ phase: "ready", jobs, error: "" });
      setSelectedJobId((current) => jobs.some((job) => String(job.id) === current) ? current : String(jobs[0]?.id || ""));
    } catch (error) {
      setJobsState({ phase: "error", jobs: [], error: error.message || "Pipeline jobs could not be loaded." });
    }
  };

  useEffect(() => { loadJobs(); }, []);
  useEffect(() => {
    if (!selectedJobId) {
      setCandidatesState({ phase: "idle", candidates: [], error: "" });
      return undefined;
    }
    let active = true;
    setCandidatesState({ phase: "loading", candidates: [], error: "" });
    loadLiveCandidatesForJob(selectedJobId)
      .then((candidates) => { if (active) setCandidatesState({ phase: "ready", candidates, error: "" }); })
      .catch((error) => { if (active) setCandidatesState({ phase: "error", candidates: [], error: error.message || "Candidates could not be loaded." }); });
    return () => { active = false; };
  }, [selectedJobId]);

  const selectedJob = jobsState.jobs.find((job) => String(job.id) === selectedJobId) || null;
  const visibleCandidates = useMemo(() => candidatesState.candidates
    .filter((candidate) => !canadaOnly || isInCanada(candidate.location)), [candidatesState.candidates, canadaOnly]);
  const unsupported = visibleCandidates.filter((candidate) => !LOXO_PIPELINE_STAGES.includes(candidate.stage));

  const moveCandidate = async (candidateId, from, to) => {
    if (!to || from === to) return;
    setMoveError("");
    try {
      await logCandidateActivity(selectedJobId, candidateId, {
        type: "*Note",
        note: `Stage move: ${from} to ${to}`,
        targetStage: to,
      });
      setCandidatesState((current) => ({
        ...current,
        candidates: current.candidates.map((candidate) => candidate.id === candidateId ? { ...candidate, stage: to } : candidate),
      }));
      setWaitingIds((current) => new Set(current).add(candidateId));
    } catch (error) {
      setMoveError(error.message || "Stage move could not be queued.");
    }
  };

  const handleDragEnd = (event) => {
    if (event.canceled) return;
    const source = event.operation.source;
    const target = event.operation.target;
    const candidateId = source?.data?.candidateId || String(source?.id || "").replace(/^candidate:/, "");
    const to = target?.data?.stage || String(target?.id || "").replace(/^stage:/, "");
    const candidate = candidatesState.candidates.find((item) => String(item.id) === String(candidateId));
    if (candidate && LOXO_PIPELINE_STAGES.includes(to)) moveCandidate(candidate.id, candidate.stage, to);
  };

  return <div className="flex min-w-0 flex-col gap-4" data-testid="pipeline-page">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h2 className="text-lg font-semibold">Pipeline</h2><p className="text-sm text-muted-foreground">Stage moves wait for Loxo review.</p></div>
      <label className="flex items-center gap-2 text-sm"><Checkbox checked={canadaOnly} onCheckedChange={(value) => setCanadaOnly(Boolean(value))} />Canada only</label>
    </div>

    <Card>
      <CardHeader className="pb-3"><CardTitle className="text-sm">Job</CardTitle></CardHeader>
      <CardContent>
        {jobsState.phase === "loading" ? <p className="text-sm text-muted-foreground">Loading active jobs...</p> : null}
        {jobsState.phase === "error" ? <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive"><span>{jobsState.error}</span><Button size="sm" variant="outline" onClick={loadJobs}><RefreshCw size={14} /> Retry</Button></div> : null}
        {jobsState.phase === "ready" && !jobsState.jobs.length ? <p className="text-sm text-muted-foreground">No active Tracker jobs with pipeline data.</p> : null}
        {jobsState.jobs.length ? <Select value={selectedJobId} onValueChange={(value) => setSelectedJobId(String(value))}>
          <SelectTrigger aria-label="Select pipeline job" className="w-full sm:max-w-md"><SelectValue /></SelectTrigger>
          <SelectContent>{jobsState.jobs.map((job) => <SelectItem key={job.id} value={String(job.id)}>{job.title} · {job.company}</SelectItem>)}</SelectContent>
        </Select> : null}
      </CardContent>
    </Card>

    {moveError ? <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{moveError}</div> : null}
    {candidatesState.phase === "loading" ? <p className="text-sm text-muted-foreground">Loading pipeline candidates...</p> : null}
    {candidatesState.phase === "error" ? <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{candidatesState.error}</div> : null}
    {candidatesState.phase === "ready" && !candidatesState.candidates.length ? <p className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">No candidates are linked to this job.</p> : null}
    {candidatesState.phase === "ready" && candidatesState.candidates.length && !visibleCandidates.length ? <p className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">No candidates match the Canada filter.</p> : null}
    {unsupported.length ? <p role="status" className="rounded-md border border-amber-700/30 bg-amber-50 p-3 text-sm text-amber-950">{unsupported.length} candidate{unsupported.length === 1 ? " has" : "s have"} a stage not supported by this board.</p> : null}

    {selectedJob && visibleCandidates.length ? <DragDropProvider onDragEnd={handleDragEnd}>
      <div className="flex min-w-0 gap-3 overflow-x-auto pb-4" aria-label={`${selectedJob.title} pipeline board`}>
        {LOXO_PIPELINE_STAGES.map((stage) => <StageColumn
          key={stage}
          stage={stage}
          job={selectedJob}
          candidates={visibleCandidates.filter((candidate) => candidate.stage === stage)}
          waitingIds={waitingIds}
          onMove={moveCandidate}
          onOpenCandidate={onOpenCandidate}
        />)}
      </div>
    </DragDropProvider> : null}
  </div>;
}

