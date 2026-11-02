import { useMemo, useState } from "react";
import { AlertCircle, AlertTriangle, ExternalLink, FileText, Filter, Loader2, NotebookText, Phone, Search, Send, ShieldAlert, Users } from "lucide-react";
import { Badge } from "../../components/ui/badge.tsx";
import { Button } from "../../components/ui/button.tsx";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select.tsx";
import { LOXO_PIPELINE_STAGES, RESUME_INDICATOR_STATES } from "./constants.js";
import { getOwnershipStatus, openBrandedResume } from "./brandResume.js";
import CandidateWriteUpDialog from "./CandidateWriteUpDialog.jsx";

const LOXO_PEOPLE_BASE_URL = "https://app.loxo.co/people/";
const VIEW_TABS = [["all", "All"], ["unreviewed", "Unreviewed"], ["wanted", "Wanted"], ["passed", "Passed"], ["submitted", "Submitted"]];

function withinDateRange(value, start, end) {
  if (!value) return !start && !end;
  const day = String(value).slice(0, 10);
  return (!start || day >= start) && (!end || day <= end);
}

export default function PeopleView({ candidates, currentJob, jobs, submissionHistory, onSelectCandidateToSwipe, onMarkSubmitted }) {
  const [viewFilter, setViewFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [stageFilter, setStageFilter] = useState("ALL");
  const [onlyOthersReachedOut, setOnlyOthersReachedOut] = useState(false);
  const [submissionJobId, setSubmissionJobId] = useState("ALL");
  const [submissionLocation, setSubmissionLocation] = useState("");
  const [submissionClient, setSubmissionClient] = useState("");
  const [submissionFrom, setSubmissionFrom] = useState("");
  const [submissionTo, setSubmissionTo] = useState("");
  const [writeUpCandidate, setWriteUpCandidate] = useState(null);
  const [ownershipOverrides, setOwnershipOverrides] = useState(() => new Set());
  const [actionError, setActionError] = useState("");
  const [submittingId, setSubmittingId] = useState("");

  const counts = useMemo(() => ({
    all: candidates.length,
    unreviewed: candidates.filter((candidate) => !candidate.decision && !candidate.isSubmitted).length,
    wanted: candidates.filter((candidate) => candidate.decision === "want" && !candidate.isSubmitted).length,
    passed: candidates.filter((candidate) => candidate.decision === "pass").length,
    submitted: submissionHistory.length,
  }), [candidates, submissionHistory]);

  const filteredCandidates = useMemo(() => {
    const source = viewFilter === "submitted"
      ? submissionHistory.map((record) => ({ ...record.candidate, submission: record, isSubmitted: true, reviewJobId: record.jobId, reviewJobTitle: record.jobTitle }))
      : candidates;
    const query = searchTerm.trim().toLowerCase();
    const locationQuery = submissionLocation.trim().toLowerCase();
    const clientQuery = submissionClient.trim().toLowerCase();

    return source.filter((candidate) => {
      if (viewFilter === "unreviewed" && (candidate.decision || candidate.isSubmitted)) return false;
      if (viewFilter === "wanted" && (candidate.decision !== "want" || candidate.isSubmitted)) return false;
      if (viewFilter === "passed" && candidate.decision !== "pass") return false;
      if (stageFilter !== "ALL" && candidate.stage !== stageFilter) return false;
      if (onlyOthersReachedOut && (!candidate.otherContactsCount || candidate.otherContactsCount === 0)) return false;
      const submission = candidate.submission;
      if (viewFilter === "submitted") {
        if (submissionJobId !== "ALL" && String(candidate.reviewJobId) !== String(submissionJobId)) return false;
        if (locationQuery && !String(submission?.location || candidate.location || "").toLowerCase().includes(locationQuery)) return false;
        if (clientQuery && !String(submission?.client || "").toLowerCase().includes(clientQuery)) return false;
        if (!withinDateRange(submission?.submittedAt, submissionFrom, submissionTo)) return false;
      }
      if (!query) return true;
      return [candidate.name, candidate.title, candidate.employer, candidate.location, candidate.reviewJobTitle, submission?.client].filter(Boolean).join(" ").toLowerCase().includes(query);
    });
  }, [candidates, onlyOthersReachedOut, searchTerm, stageFilter, submissionClient, submissionFrom, submissionHistory, submissionJobId, submissionLocation, submissionTo, viewFilter]);

  const markSubmitted = async (candidate) => {
    setActionError("");
    setSubmittingId(candidate.id);
    try {
      const result = await onMarkSubmitted(candidate.id, { client: currentJob?.company, location: currentJob?.location });
      if (result?.ok === false) throw new Error(result.error || "Submission was not saved");
      setViewFilter("submitted");
    } catch (error) {
      setActionError(error.message || "Submission was not saved");
    } finally {
      setSubmittingId("");
    }
  };

  const overrideOwnership = (candidateId) => setOwnershipOverrides((current) => new Set([...current, candidateId]));

  return (
    <div className="flex flex-1 min-h-0 flex-col gap-3 overflow-hidden" data-testid="people-view">
      <div className="rounded-lg border bg-card p-3 shadow-sm shrink-0 space-y-3">
        <div className="flex flex-wrap items-center gap-1.5" data-testid="people-status-tabs">
          {VIEW_TABS.map(([key, label]) => (
            <button key={key} type="button" onClick={() => setViewFilter(key)} className={`rounded-md border px-2.5 py-1.5 text-xs font-semibold transition ${viewFilter === key ? "border-foreground bg-foreground text-background" : "bg-background text-muted-foreground hover:text-foreground"}`} data-testid={`people-tab-${key}`}>
              {label} <span className="ml-1 opacity-75">{counts[key]}</span>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search size={14} className="absolute left-2.5 top-2.5 text-muted-foreground" />
            <input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search name, title, company, location" className="h-9 w-full rounded-md border bg-background pl-8 pr-3 text-xs outline-none focus:ring-2 focus:ring-ring" data-testid="people-search" />
          </div>
          <div className="w-44">
            <Select value={stageFilter} onValueChange={setStageFilter}>
              <SelectTrigger className="w-full text-xs h-9"><SelectValue placeholder="All Stages" /></SelectTrigger>
              <SelectContent><SelectGroup>
                <SelectItem value="ALL" className="text-xs">All Stages</SelectItem>
                {LOXO_PIPELINE_STAGES.map((stage) => <SelectItem key={stage} value={stage} className="text-xs">{stage}</SelectItem>)}
              </SelectGroup></SelectContent>
            </Select>
          </div>
          <button type="button" onClick={() => setOnlyOthersReachedOut((value) => !value)} className={`inline-flex h-9 items-center gap-1.5 rounded-md border px-2.5 text-xs font-semibold ${onlyOthersReachedOut ? "border-amber-400 bg-amber-50 text-amber-900" : "bg-background text-muted-foreground"}`}>
            <AlertTriangle size={12} /> Other recruiter contact
          </button>
        </div>

        {viewFilter === "submitted" ? (
          <div className="grid gap-2 md:grid-cols-5" data-testid="submission-filters">
            <Select value={submissionJobId} onValueChange={setSubmissionJobId}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="All jobs" /></SelectTrigger>
              <SelectContent><SelectGroup>
                <SelectItem value="ALL" className="text-xs">All jobs</SelectItem>
                {jobs.map((job) => <SelectItem key={job.id} value={String(job.id)} className="text-xs">{job.title}</SelectItem>)}
              </SelectGroup></SelectContent>
            </Select>
            <input value={submissionLocation} onChange={(event) => setSubmissionLocation(event.target.value)} placeholder="Location" className="h-8 rounded-md border bg-background px-2 text-xs" />
            <input value={submissionClient} onChange={(event) => setSubmissionClient(event.target.value)} placeholder="Client" className="h-8 rounded-md border bg-background px-2 text-xs" />
            <input type="date" value={submissionFrom} onChange={(event) => setSubmissionFrom(event.target.value)} aria-label="Submitted from" className="h-8 rounded-md border bg-background px-2 text-xs" />
            <input type="date" value={submissionTo} onChange={(event) => setSubmissionTo(event.target.value)} aria-label="Submitted to" className="h-8 rounded-md border bg-background px-2 text-xs" />
          </div>
        ) : null}

        <div className="flex items-center gap-2 text-xs text-muted-foreground"><Filter size={13} /> {filteredCandidates.length} shown {viewFilter === "submitted" ? <span>· filter by job, location, client, or date</span> : null}</div>
      </div>

      {actionError ? <div role="alert" className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive"><AlertCircle size={14} />{actionError}</div> : null}

      <div className="flex-1 min-h-0 overflow-y-auto rounded-lg border bg-card">
        {filteredCandidates.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-8 text-center text-muted-foreground"><Users size={28} className="mb-2 opacity-50" /><p className="text-xs font-semibold text-foreground">Nothing in this view</p><p className="text-[11px] mt-0.5">Change the tab, search, or filters.</p></div>
        ) : (
          <div className="divide-y divide-border">
            {filteredCandidates.map((candidate) => {
              const resumeInfo = RESUME_INDICATOR_STATES[candidate.resumeStatus] || RESUME_INDICATOR_STATES.resume_on_file;
              const lastActivity = candidate.activityTrail?.[0] || null;
              const ownership = getOwnershipStatus(candidate.activityTrail);
              const ownershipOverridden = ownershipOverrides.has(candidate.id);
              const isUnreviewed = !candidate.decision && !candidate.isSubmitted;
              const recordKey = `${candidate.reviewJobId || currentJob?.id || candidate.jobId}:${candidate.id}:${candidate.submission?.id || "candidate"}`;

              return (
                <div key={recordKey} onClick={() => isUnreviewed && onSelectCandidateToSwipe(candidate.id)} className={`p-3.5 transition-colors ${isUnreviewed ? "cursor-pointer hover:bg-muted/30" : ""}`}>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-foreground text-background text-sm font-bold">{candidate.initials}</div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <a href={`${LOXO_PEOPLE_BASE_URL}${candidate.id}`} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()} className="flex items-center gap-1 text-sm font-bold hover:underline">{candidate.name}<ExternalLink size={12} className="text-muted-foreground" /></a>
                          <Badge variant="outline" className="text-[11px] py-0">{candidate.stage}</Badge>
                          <span className="text-[10.5px] text-muted-foreground">{resumeInfo.symbol} {resumeInfo.label}</span>
                        </div>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">{candidate.title} at {candidate.employer} · {candidate.location}</p>
                        {candidate.submission ? (
                          <p className="mt-1 text-[11px] text-foreground" data-testid="submission-history-row">
                            {candidate.reviewJobTitle || currentJob?.title} · {candidate.submission.client} · {String(candidate.submission.submittedAt).slice(0, 10)}
                            <Badge variant="outline" className="ml-2 text-[10px]">{candidate.submission.source === "session" || candidate.submission.status === "Session only" ? "Session only" : "Imported"}</Badge>
                          </p>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      {lastActivity ? <span className="max-w-[180px] truncate text-[10.5px] text-muted-foreground">{lastActivity.type} · {lastActivity.date}</span> : null}
                      {candidate.otherContactsCount > 0 ? <Badge variant="outline" className="border-amber-400 bg-amber-50 text-[10.5px] text-amber-900"><AlertTriangle size={11} className="mr-1" />{candidate.otherContactsCount} other</Badge> : null}
                      {candidate.isSubmitted ? <Badge className="bg-blue-700 text-white">Submitted</Badge> : candidate.decision === "want" ? <Badge className="bg-emerald-700 text-white">Wanted</Badge> : candidate.decision === "pass" ? <Badge variant="outline" className="border-rose-400 bg-rose-50 text-rose-800">Passed</Badge> : <Badge variant="outline">Unreviewed</Badge>}
                    </div>
                  </div>

                  {viewFilter === "wanted" ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border bg-muted/20 p-2" onClick={(event) => event.stopPropagation()} data-testid="wanted-actions">
                      {ownership.active && !ownershipOverridden ? (
                        <><span className="mr-auto flex items-center gap-1.5 text-xs text-amber-900"><ShieldAlert size={13} />{ownership.latest.actor} contacted them within six months.</span><Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={() => overrideOwnership(candidate.id)}>Reach out anyway</Button></>
                      ) : (
                        <>
                          <a href={candidate.phone ? `tel:${candidate.phone.replace(/\s/g, "")}` : undefined} aria-disabled={!candidate.phone} className={`inline-flex h-8 items-center rounded-md border bg-background px-3 text-xs font-semibold ${!candidate.phone ? "pointer-events-none opacity-50" : "hover:bg-muted"}`}><Phone size={13} className="mr-1.5" />Call</a>
                          <Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={() => { const result = openBrandedResume(candidate); if (!result.ok) setActionError(result.error); }}><FileText size={13} className="mr-1.5" />Brand resume</Button>
                          <Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={() => setWriteUpCandidate(candidate)}><NotebookText size={13} className="mr-1.5" />Write-up</Button>
                          <Button type="button" size="sm" className="h-8 bg-blue-700 text-xs text-white hover:bg-blue-800" disabled={submittingId === candidate.id} onClick={() => markSubmitted(candidate)}>{submittingId === candidate.id ? <Loader2 size={13} className="mr-1.5 animate-spin" /> : <Send size={13} className="mr-1.5" />}Mark submitted</Button>
                        </>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {writeUpCandidate ? <CandidateWriteUpDialog candidate={writeUpCandidate} open onOpenChange={(open) => !open && setWriteUpCandidate(null)} /> : null}
    </div>
  );
}
