import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { parseCandidateSourceKey } from "@ja/shared-types";
import { AlertCircle, AlertTriangle, ExternalLink, FileText, Filter, Loader2, Mail, NotebookText, Pencil, Phone, Plus, Search, Send, ShieldAlert, Users } from "lucide-react";
import { Badge } from "../../components/ui/badge.tsx";
import { Button } from "../../components/ui/button.tsx";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select.tsx";
import { LOXO_PIPELINE_STAGES, RESUME_INDICATOR_STATES } from "./constants.js";
import { getOwnershipStatus, openBrandedResume } from "./brandResume.js";
import {
  createCandidateDraft,
  enrichCandidatesWithPresentations,
} from "./candidateReviewService.js";
import CandidateWriteUpDialog from "./CandidateWriteUpDialog.jsx";
import CandidateEditorDialog from "./CandidateEditorDialog.jsx";
import CandidatePresentationSummary, {
  CandidatePresentationBadges,
} from "./CandidatePresentationSummary.jsx";
import {
  describeCandidateProvenance,
  getCachedCandidateRecords,
  loadCandidateDirectory,
  mergeCandidatesWithDirectory,
  subscribeCandidateRecords,
} from "./candidateEditorService.js";
import OutreachComposer from "./OutreachComposer.jsx";
import { getResumeSource } from "./externals.js";

const LOXO_PEOPLE_BASE_URL = "https://app.loxo.co/people/";
const NotesPanel = lazy(() => import("../notes/NotesPanel.jsx"));
const BoardPanel = lazy(() => import("../board/BoardPanel.jsx"));
const VIEW_TABS = [["all", "All"], ["unreviewed", "Unreviewed"], ["wanted", "Wanted"], ["passed", "Passed"], ["submitted", "Submitted"]];

function withinDateRange(value, start, end) {
  if (!value) return !start && !end;
  const day = String(value).slice(0, 10);
  return (!start || day >= start) && (!end || day <= end);
}

export default function PeopleView({ candidates = [], currentJob, jobs = [], submissionHistory = [], onSelectCandidateToSwipe, onMarkSubmitted, onStartCandidateCall, focusCandidateId = "" }) {
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
  const [notesCandidateId, setNotesCandidateId] = useState(null);
  const [boardCandidateId, setBoardCandidateId] = useState(null);
  const [outreachCandidate, setOutreachCandidate] = useState(null);
  const [editorState, setEditorState] = useState(null); // { mode: "create" | "edit", candidate }
  const [directoryRecords, setDirectoryRecords] = useState(() => getCachedCandidateRecords());
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [directoryError, setDirectoryError] = useState("");
  const [saveNotice, setSaveNotice] = useState("");
  const [ownershipOverrides, setOwnershipOverrides] = useState(() => new Set());
  const [actionError, setActionError] = useState("");
  const [submittingId, setSubmittingId] = useState("");
  const focusedRowRef = useRef(null);
  const focusKey = parseCandidateSourceKey(focusCandidateId)?.id ?? null;

  useEffect(() => {
    let active = true;
    const unsubscribe = subscribeCandidateRecords((records) => {
      if (active) setDirectoryRecords(records);
    });
    setDirectoryLoading(true);
    loadCandidateDirectory()
      .then((records) => {
        if (!active) return;
        setDirectoryRecords(records);
        setDirectoryError("");
      })
      .catch((error) => {
        if (!active) return;
        if (error?.status && error.status !== 401) {
          setDirectoryError(error.message || "Candidates could not be loaded.");
        }
      })
      .finally(() => {
        if (active) setDirectoryLoading(false);
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const mergedCandidates = useMemo(
    () =>
      enrichCandidatesWithPresentations(
        mergeCandidatesWithDirectory(candidates, directoryRecords),
        submissionHistory,
        { jobId: currentJob?.id ?? null }
      ),
    [candidates, directoryRecords, submissionHistory, currentJob?.id],
  );

  const counts = useMemo(() => ({
    all: mergedCandidates.length,
    unreviewed: mergedCandidates.filter((candidate) => !candidate.decision && !candidate.isSubmitted && candidate.presentationState !== "pending").length,
    wanted: mergedCandidates.filter((candidate) => candidate.decision === "want" && !candidate.isSubmitted && candidate.presentationState !== "pending").length,
    passed: mergedCandidates.filter((candidate) => candidate.decision === "pass").length,
    submitted: submissionHistory.length,
  }), [mergedCandidates, submissionHistory]);

  const filteredCandidates = useMemo(() => {
    const source = viewFilter === "submitted"
      ? submissionHistory.map((record) => {
          const isConfirmed = record.presentationState === "confirmed";
          const enrichedCandidate =
            enrichCandidatesWithPresentations(
              [record.candidate],
              submissionHistory,
              { jobId: record.jobId ?? currentJob?.id ?? null }
            )[0] || record.candidate;
          return {
            ...enrichedCandidate,
            submission: record,
            presentationState: record.presentationState || (isConfirmed ? "confirmed" : "pending"),
            isSubmitted: isConfirmed,
            reviewJobId: record.jobId ?? null,
            reviewJobTitle: record.jobTitle ?? null,
          };
        })
      : mergedCandidates;
    const query = searchTerm.trim().toLowerCase();
    const locationQuery = submissionLocation.trim().toLowerCase();
    const clientQuery = submissionClient.trim().toLowerCase();

    return source.filter((candidate) => {
      if (viewFilter === "unreviewed" && (candidate.decision || candidate.isSubmitted || candidate.presentationState === "pending")) return false;
      if (viewFilter === "wanted" && (candidate.decision !== "want" || candidate.isSubmitted || candidate.presentationState === "pending")) return false;
      if (viewFilter === "passed" && candidate.decision !== "pass") return false;
      if (stageFilter !== "ALL" && candidate.stage !== stageFilter) return false;
      if (onlyOthersReachedOut && (!candidate.otherContactsCount || candidate.otherContactsCount === 0)) return false;
      const submission = candidate.submission;
      if (viewFilter === "submitted") {
        if (submissionJobId !== "ALL" && String(candidate.reviewJobId ?? "") !== String(submissionJobId)) return false;
        if (locationQuery && !String(submission?.location || candidate.location || "").toLowerCase().includes(locationQuery)) return false;
        if (clientQuery && !String(submission?.clientName ?? submission?.client ?? "").toLowerCase().includes(clientQuery)) return false;
        if (!withinDateRange(submission?.presentedOn || submission?.queuedAt || submission?.submittedAt, submissionFrom, submissionTo)) return false;
      }
      if (!query) return true;
      return [
        candidate.name,
        candidate.title,
        candidate.employer,
        candidate.location,
        candidate.industry,
        candidate.shift,
        candidate.email,
        candidate.phone,
        candidate.notes,
        candidate.role_context,
        candidate.client_context,
        candidate.reviewJobTitle,
        submission?.clientName ?? submission?.client,
        ...(candidate.presentedClientLabels || []),
      ].filter(Boolean).join(" ").toLowerCase().includes(query);
    });
  }, [currentJob?.id, mergedCandidates, onlyOthersReachedOut, searchTerm, stageFilter, submissionClient, submissionFrom, submissionHistory, submissionJobId, submissionLocation, submissionTo, viewFilter]);

  useEffect(() => {
    if (!focusKey) return;
    setViewFilter("all");
    setSearchTerm("");
    setStageFilter("ALL");
    setOnlyOthersReachedOut(false);
  }, [focusKey]);

  useEffect(() => {
    if (!focusKey || !filteredCandidates.some((candidate) => candidate.id === focusKey)) return;
    focusedRowRef.current?.scrollIntoView?.({ block: "center" });
    focusedRowRef.current?.focus?.({ preventScroll: true });
  }, [focusKey, filteredCandidates]);

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

  const brandResume = async (candidate) => {
    setActionError("");
    try {
      const source = getResumeSource(candidate);
      if (source.kind === "none") throw new Error("Not enough data to build a resume");
      await createCandidateDraft({ job: currentJob, candidate, kind: "resume_pdf", body: source.text });
      const result = openBrandedResume(candidate);
      if (!result.ok) throw new Error(result.error);
    } catch (error) {
      setActionError(error.message || "The branded resume could not be opened.");
    }
  };

  return (
    <div className="flex flex-1 min-h-0 flex-col gap-3 overflow-hidden" data-testid="people-view">
      <div className="rounded-lg border bg-card p-3 shadow-sm shrink-0 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5" data-testid="people-status-tabs">
            {VIEW_TABS.map(([key, label]) => (
              <button key={key} type="button" onClick={() => setViewFilter(key)} className={`rounded-md border px-2.5 py-1.5 text-xs font-semibold transition ${viewFilter === key ? "border-foreground bg-foreground text-background" : "bg-background text-muted-foreground hover:text-foreground"}`} data-testid={`people-tab-${key}`}>
                {label} <span className="ml-1 opacity-75">{counts[key]}</span>
              </button>
            ))}
          </div>

          <Button
            type="button"
            size="sm"
            onClick={() => {
              setSaveNotice("");
              setEditorState({ mode: "create", candidate: null });
            }}
            className="h-8 text-xs font-semibold"
            data-testid="people-add-candidate-button"
          >
            <Plus size={14} className="mr-1" /> Add candidate
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search size={14} className="absolute left-2.5 top-2.5 text-muted-foreground" />
            <input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search name, title, company, location" className="h-9 w-full rounded-md border bg-background pl-8 pr-3 text-xs outline-none focus:ring-2 focus:ring-ring" aria-label="Search candidates" data-testid="people-search" />
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
            <input value={submissionLocation} onChange={(event) => setSubmissionLocation(event.target.value)} placeholder="Location" aria-label="Filter submissions by location" className="h-8 rounded-md border bg-background px-2 text-xs" />
            <input value={submissionClient} onChange={(event) => setSubmissionClient(event.target.value)} placeholder="Client" aria-label="Filter submissions by client" className="h-8 rounded-md border bg-background px-2 text-xs" />
            <input type="date" value={submissionFrom} onChange={(event) => setSubmissionFrom(event.target.value)} aria-label="Submitted from" className="h-8 rounded-md border bg-background px-2 text-xs" />
            <input type="date" value={submissionTo} onChange={(event) => setSubmissionTo(event.target.value)} aria-label="Submitted to" className="h-8 rounded-md border bg-background px-2 text-xs" />
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Filter size={13} /> {filteredCandidates.length} shown {viewFilter === "submitted" ? <span>· filter by job, location, client, or date</span> : null}
          {directoryLoading ? <span role="status" className="inline-flex items-center gap-1" data-testid="candidates-directory-loading"><Loader2 size={12} className="animate-spin" /> Loading candidates...</span> : null}
        </div>
      </div>

      {focusKey && !directoryLoading && !mergedCandidates.some((candidate) => candidate.id === focusKey) ? (
        <div role="status" data-testid="focused-candidate-missing" className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
          Candidate record with this exact source ID is not in the accessible directory.
        </div>
      ) : null}
      {directoryError ? <div role="alert" className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive" data-testid="candidates-directory-error"><AlertCircle size={14} />{directoryError}</div> : null}
      {saveNotice ? <div role="status" className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-900" data-testid="people-candidate-save-status">{saveNotice}</div> : null}
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
              const isUnreviewed = !candidate.decision && !candidate.isSubmitted && candidate.presentationState !== "pending";
              const provenance = describeCandidateProvenance(candidate, { mode: "edit" });
              const recordKey = `${candidate.reviewJobId || currentJob?.id || candidate.jobId || "directory"}:${candidate.id}:${candidate.submission?.id || "candidate"}`;
              const submissionDateText = candidate.submission?.presentedOn
                ? String(candidate.submission.presentedOn).slice(0, 10)
                : candidate.submission?.queuedAt
                  ? `Queued ${String(candidate.submission.queuedAt).slice(0, 10)}`
                  : candidate.submission?.submittedAt
                    ? String(candidate.submission.submittedAt).slice(0, 10)
                    : "Date not recorded";
              const submissionBadgeText =
                candidate.submission?.presentationState === "pending"
                  ? "Waiting for Loxo"
                  : candidate.submission?.presentationState === "failed"
                    ? "Failed"
                    : candidate.submission?.source === "imported"
                      ? "Imported"
                      : candidate.submission?.sourceStatus || "Confirmed";

              return (
                <div
                  key={recordKey}
                  ref={candidate.id === focusKey ? focusedRowRef : undefined}
                  tabIndex={candidate.id === focusKey ? -1 : undefined}
                  data-candidate-id={candidate.id}
                  data-testid={candidate.id === focusKey ? "focused-candidate-row" : undefined}
                  className={candidate.id === focusKey ? "bg-amber-50 p-3.5 outline-none ring-2 ring-inset ring-amber-400" : "p-3.5"}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-foreground text-background text-sm font-bold">{candidate.initials}</div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          {isUnreviewed && onSelectCandidateToSwipe ? (
                            <button type="button" onClick={() => onSelectCandidateToSwipe(candidate.id)} className="min-h-10 rounded text-left text-sm font-bold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="people-candidate-open">{candidate.name}</button>
                          ) : candidate.profileUrl || candidate.loxoPersonId ? (
                            <a href={candidate.profileUrl || `${LOXO_PEOPLE_BASE_URL}${candidate.loxoPersonId}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-sm font-bold hover:underline">{candidate.name}<ExternalLink size={12} className="text-muted-foreground" /></a>
                          ) : <span className="text-sm font-bold">{candidate.name}</span>}
                          {isUnreviewed && (candidate.profileUrl || candidate.loxoPersonId) ? (
                            <a href={candidate.profileUrl || `${LOXO_PEOPLE_BASE_URL}${candidate.loxoPersonId}`} target="_blank" rel="noopener noreferrer" aria-label={`Open ${candidate.name} profile`} className="inline-flex min-h-10 min-w-10 items-center justify-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><ExternalLink size={12} className="text-muted-foreground" /></a>
                          ) : null}
                          <Badge variant="outline" className="text-[11px] py-0">{candidate.stage}</Badge>
                          {!provenance.invalidKey ? (
                            <Badge
                              variant="outline"
                              className={
                                provenance.isManual
                                  ? "border-emerald-400 bg-emerald-50 text-emerald-900 text-[10.5px] py-0"
                                  : provenance.hasOverlay
                                    ? "border-amber-400 bg-amber-50 text-amber-900 text-[10.5px] py-0"
                                    : "text-[10.5px] py-0"
                              }
                              data-testid="people-provenance-badge"
                            >
                              {provenance.badgeLabel}
                            </Badge>
                          ) : null}
                          <CandidatePresentationBadges
                            candidate={candidate}
                            presentations={submissionHistory}
                            jobId={candidate.reviewJobId || currentJob?.id || candidate.jobId}
                            prefix="people"
                          />
                          <span className="text-[10.5px] text-muted-foreground">{resumeInfo.symbol} {resumeInfo.label}</span>
                        </div>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">{candidate.title} at {candidate.employer} · {candidate.location}</p>
                        <CandidatePresentationSummary
                          candidate={candidate}
                          presentations={submissionHistory}
                          jobId={candidate.reviewJobId || currentJob?.id || candidate.jobId}
                          prefix="people"
                          compact
                        />
                        {candidate.submission ? (
                          <p className="mt-1 text-[11px] text-foreground" data-testid="submission-history-row">
                            {candidate.submission.jobTitle || candidate.reviewJobTitle || "Job not recorded"} · {candidate.submission.clientName || candidate.submission.client || "Client not recorded"} · {submissionDateText}
                            <Badge variant="outline" className={`ml-2 text-[10px] ${candidate.submission.presentationState === "pending" ? "border-amber-400 bg-amber-50 text-amber-900" : candidate.submission.presentationState === "failed" ? "border-rose-400 bg-rose-50 text-rose-800" : ""}`}>{submissionBadgeText}</Badge>
                          </p>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <Button type="button" size="sm" variant="outline" aria-expanded={notesCandidateId === candidate.id} onClick={(event) => { event.stopPropagation(); setNotesCandidateId((current) => current === candidate.id ? null : candidate.id); }} className="h-8 px-2.5 text-xs font-semibold">
                        <NotebookText size={12} className="mr-1" /> Notes
                      </Button>
                      <Button type="button" size="sm" variant="outline" aria-expanded={boardCandidateId === candidate.id} onClick={(event) => { event.stopPropagation(); setBoardCandidateId((current) => current === candidate.id ? null : candidate.id); }} className="h-8 px-2.5 text-xs font-semibold">
                        Board
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setSaveNotice("");
                          setEditorState({ mode: "edit", candidate });
                        }}
                        className="h-8 px-2.5 text-xs font-semibold"
                        aria-label={`Edit ${candidate.name}`}
                        data-testid={`people-edit-candidate-${candidate.id}`}
                      >
                        <Pencil size={12} className="mr-1" /> Edit
                      </Button>
                      {lastActivity ? <span className="max-w-[180px] truncate text-[10.5px] text-muted-foreground">{lastActivity.type} · {lastActivity.date}</span> : null}
                      {candidate.otherContactsCount > 0 ? <Badge variant="outline" className="border-amber-400 bg-amber-50 text-[10.5px] text-amber-900"><AlertTriangle size={11} className="mr-1" />{candidate.otherContactsCount} other</Badge> : null}
                      {candidate.isSubmitted ? <Badge className="bg-blue-700 text-white">Presented</Badge> : candidate.presentationState === "pending" ? <Badge variant="outline" className="border-amber-400 bg-amber-50 text-amber-900">Waiting for Loxo</Badge> : candidate.presentationState === "failed" ? <Badge variant="outline" className="border-rose-400 bg-rose-50 text-rose-800">Submission failed</Badge> : candidate.decision === "want" ? <Badge className="bg-emerald-700 text-white">Wanted</Badge> : candidate.decision === "pass" ? <Badge variant="outline" className="border-rose-400 bg-rose-50 text-rose-800">Passed</Badge> : <Badge variant="outline">Unreviewed</Badge>}
                    </div>
                  </div>

                  {viewFilter === "wanted" ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border bg-muted/20 p-2" onClick={(event) => event.stopPropagation()} data-testid="wanted-actions">
                      {ownership.active && !ownershipOverridden ? (
                        <><span className="mr-auto flex items-center gap-1.5 text-xs text-amber-900"><ShieldAlert size={13} />{ownership.latest.actor} contacted them within six months.</span><Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={() => overrideOwnership(candidate.id)}>Reach out anyway</Button></>
                      ) : (
                        <>
                          <button type="button" disabled={!candidate.phone} onClick={() => onStartCandidateCall?.({ job: currentJob, candidate })} className="inline-flex h-8 items-center rounded-md border bg-background px-3 text-xs font-semibold hover:bg-muted disabled:pointer-events-none disabled:opacity-50"><Phone size={13} className="mr-1.5" />Call</button>
                          <Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={() => brandResume(candidate)}><FileText size={13} className="mr-1.5" />Brand resume</Button>
                          <Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={() => setWriteUpCandidate(candidate)}><NotebookText size={13} className="mr-1.5" />Write-up</Button>
                          <Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={() => setOutreachCandidate(candidate)}><Mail size={13} className="mr-1.5" />Outreach</Button>
                          <Button type="button" size="sm" className="h-8 bg-blue-700 text-xs text-white hover:bg-blue-800" disabled={submittingId === candidate.id} onClick={() => markSubmitted(candidate)}>{submittingId === candidate.id ? <Loader2 size={13} className="mr-1.5 animate-spin" /> : <Send size={13} className="mr-1.5" />}Mark submitted</Button>
                        </>
                      )}
                    </div>
                  ) : null}
                  {notesCandidateId === candidate.id ? (
                    <div className="mt-3" onClick={(event) => event.stopPropagation()}>
                      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading notes editor…</p>}>
                        <NotesPanel subjectType="candidate" subjectId={candidate.id} defaultTitle={candidate.name} />
                      </Suspense>
                    </div>
                  ) : null}
                  {boardCandidateId === candidate.id ? (
                    <div className="mt-3" onClick={(event) => event.stopPropagation()}>
                      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading board editor…</p>}>
                        <BoardPanel subjectType="candidate" subjectId={candidate.id} defaultTitle={candidate.name} />
                      </Suspense>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {outreachCandidate ? <OutreachComposer open onOpenChange={(open) => !open && setOutreachCandidate(null)} candidate={outreachCandidate} currentJob={currentJob} jobs={jobs} /> : null}
      {writeUpCandidate ? <CandidateWriteUpDialog candidate={writeUpCandidate} currentJob={currentJob} open onOpenChange={(open) => !open && setWriteUpCandidate(null)} /> : null}
      <CandidateEditorDialog
        open={Boolean(editorState)}
        onOpenChange={(open) => !open && setEditorState(null)}
        mode={editorState?.mode || "create"}
        candidate={editorState?.candidate || null}
        onSaved={(savedRecord) => {
          if (savedRecord) {
            setSaveNotice(
              editorState?.mode === "create"
                ? `Added manual candidate: ${savedRecord.candidate_name}`
                : savedRecord.is_manual
                  ? `Saved manual candidate: ${savedRecord.candidate_name}`
                  : `Saved overlay edits for ${savedRecord.candidate_name}`
            );
          }
        }}
      />
    </div>
  );
}
