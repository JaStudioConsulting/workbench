import { useState, useMemo, useEffect, useRef } from "react";
import { Briefcase, Check, MapPin, AlertCircle } from "lucide-react";
import { Button } from "../../components/ui/button.tsx";
import SwipeView from "./SwipeView.jsx";
import PeopleView from "./PeopleView.jsx";
import { rejectCandidate } from "./rejectReasons.js";
import { filterByCanada, loadCanadaPrefs, saveCanadaPrefs } from "./canadaFilter.js";
import { isInCanada } from "./externals.js";
import {
  getCandidatesForJob,
  getCachedLiveCandidatesForJob,
  getCachedLiveReviewJobs,
  getSubmissionHistory,
  getPresentationHistoryError,
  recordCandidateDecision,
  recordCandidateSubmission,
  logCandidateActivity,
  undoCandidateDecision,
  undoQueuedActivity,
  loadLiveReviewJobs,
  loadLiveCandidatesForJob,
} from "./candidateReviewService.js";

const UNDO_WINDOW_MS = 15000;

const isUnreviewed = (candidate) => !candidate.decision && !candidate.isSubmitted && candidate.presentationState !== "pending";

// Reads what an earlier visit already loaded, so switching views repaints at once.
function readLoadedState(selectedJob) {
  const jobs = getCachedLiveReviewJobs() || [];
  const targetId = selectedJob?.loxoJobId || selectedJob?.originalJobId || selectedJob?.id;
  const match = targetId ? jobs.find((job) => String(job.id) === String(targetId)) : null;
  const activeJobId = match ? String(match.id) : "";
  return {
    jobs,
    activeJobId,
    jobsLoaded: jobs.length > 0,
    loadedJobId: activeJobId && getCachedLiveCandidatesForJob(activeJobId) ? activeJobId : "",
  };
}

export default function CandidateReview({ selectedJob, onSelectJob, onNavigateJobsMap, onStartCandidateCall, initialView = "swipe", view, onViewChange, focusCandidateId = "" }) {
  const [initial] = useState(() => readLoadedState(selectedJob));
  const [jobs, setJobs] = useState(initial.jobs);
  const [dataLoading, setDataLoading] = useState(!initial.jobsLoaded);
  const [dataError, setDataError] = useState("");
  // The job whose candidates have finished loading. Empty-state copy waits for this.
  const [loadedJobId, setLoadedJobId] = useState(initial.loadedJobId);

  // Match selected jobs ONLY by immutable job ID.
  // Zero title matching. Zero jobs[0] fallback.
  const [activeJobId, setActiveJobId] = useState(initial.activeJobId);
  // The parent can own the view (Work tabs) so switching People and Swipe keeps this panel mounted.
  const [ownView, setOwnView] = useState(initialView); // "swipe" | "people"
  const activeView = view ?? ownView;
  const setActiveView = (next) => {
    if (view === undefined) setOwnView(next);
    onViewChange?.(next);
  };
  const [currentIndex, setCurrentIndex] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [canadaPrefs, setCanadaPrefs] = useState(() => loadCanadaPrefs());
  const [actionStatus, setActionStatus] = useState(null); // { ok, text, undo }
  // A candidate who was just decided stays on the Swipe card until the next one is chosen.
  const [pinnedId, setPinnedId] = useState("");
  const [revealId, setRevealId] = useState("");
  const selectedJobRef = useRef(selectedJob);
  selectedJobRef.current = selectedJob;

  const updateCanadaPrefs = (patch) => {
    setCanadaPrefs((current) => {
      const next = { ...current, ...patch };
      saveCanadaPrefs(next);
      return next;
    });
    setCurrentIndex(0);
  };

  useEffect(() => {
    if (!actionStatus || actionStatus.pending) return undefined;
    const timer = window.setTimeout(() => setActionStatus(null), actionStatus.undo ? UNDO_WINDOW_MS : 4000);
    return () => window.clearTimeout(timer);
  }, [actionStatus]);

  useEffect(() => {
    let active = true;
    loadLiveReviewJobs()
      .then((loadedJobs) => {
        if (!active) return;
        setJobs(loadedJobs);
        const latestSelectedJob = selectedJobRef.current;
        const targetId = latestSelectedJob?.loxoJobId || latestSelectedJob?.originalJobId || latestSelectedJob?.id;
        const matched = targetId
          ? loadedJobs.find((job) => String(job.id) === String(targetId))
          : null;
        const nextJob = targetId ? (matched || null) : (loadedJobs[0] || null);
        setActiveJobId(nextJob ? String(nextJob.id) : "");
        if (nextJob && onSelectJob) onSelectJob(nextJob);
        setDataError("");
        setRefreshKey((key) => key + 1);
      })
      .catch((error) => {
        if (!active) return;
        setDataError(error.message || "Could not load Tracker jobs");
      })
      .finally(() => {
        if (active) setDataLoading(false);
      });
    return () => { active = false; };
  }, []);

  // Sync if selectedJob prop changes from outside (e.g. from Jobs Map)
  useEffect(() => {
    if (selectedJob && jobs.length > 0) {
      const targetId = selectedJob.loxoJobId || selectedJob.originalJobId || selectedJob.id;
      if (targetId) {
        const match = jobs.find((j) => String(j.id) === String(targetId));
        const resolvedId = match ? match.id : String(targetId);
        if (String(resolvedId) !== String(activeJobId)) {
          setActiveJobId(String(resolvedId));
          setCurrentIndex(0);
          setPinnedId("");
          setActionStatus(null);
        }
      }
    }
  }, [selectedJob, jobs]);

  useEffect(() => {
    if (!activeJobId) return;
    let active = true;
    loadLiveCandidatesForJob(activeJobId)
      .then(() => {
        if (!active) return;
        setDataError(getPresentationHistoryError());
        setRefreshKey((key) => key + 1);
      })
      .catch((error) => {
        if (!active) return;
        setDataError(error.message || "Could not load candidates for this job");
      })
      .finally(() => {
        if (active) setLoadedJobId(String(activeJobId));
      });
    return () => { active = false; };
  }, [activeJobId]);

  // Current job resolved strictly by immutable ID (no fallback to jobs[0])
  const currentJob = useMemo(() => {
    if (!activeJobId) return null;
    return jobs.find((j) => String(j.id) === String(activeJobId)) || null;
  }, [jobs, activeJobId]);

  // Retrieve candidates for currently active job (empty array if unmatched)
  const candidates = useMemo(() => {
    if (!currentJob) return [];
    return getCandidatesForJob(currentJob.id);
  }, [currentJob, refreshKey]);

  const shownCandidates = useMemo(
    () => filterByCanada(candidates, canadaPrefs, isInCanada),
    [candidates, canadaPrefs]
  );

  const swipeCandidates = useMemo(
    () => shownCandidates.filter((candidate) => isUnreviewed(candidate) || (pinnedId && String(candidate.id) === pinnedId)),
    [shownCandidates, pinnedId]
  );

  // Opened from another page (e.g. Pipeline): jump to that person once their job's candidates load.
  const startView = view ?? initialView;
  const focusedRef = useRef("");
  useEffect(() => {
    if (!focusCandidateId || dataLoading || focusedRef.current === String(focusCandidateId)) return;
    if (startView === "people") {
      focusedRef.current = String(focusCandidateId);
      setActiveView("people");
      return;
    }
    if (!candidates.some((item) => String(item.id) === String(focusCandidateId))) return;
    focusedRef.current = String(focusCandidateId);
    const swipeIndex = swipeCandidates.findIndex((item) => String(item.id) === String(focusCandidateId));
    if (swipeIndex >= 0) {
      setActiveView("swipe");
      setCurrentIndex(swipeIndex);
    } else {
      setActiveView("people");
    }
  }, [focusCandidateId, dataLoading, candidates, swipeCandidates, startView]);

  // After an Undo, bring that person's card back to the front.
  useEffect(() => {
    if (!revealId) return;
    const index = swipeCandidates.findIndex((item) => String(item.id) === revealId);
    if (index < 0) return;
    setCurrentIndex(index);
    setRevealId("");
  }, [revealId, swipeCandidates]);

  const submissionHistory = useMemo(() => getSubmissionHistory(), [refreshKey]);

  const candidatesLoading = Boolean(activeJobId) && loadedJobId !== String(activeJobId);
  const loading = dataLoading || candidatesLoading;
  const jobTitle = currentJob?.title || selectedJob?.title || "";
  const hiddenByCanada = canadaPrefs.canadaOnly ? candidates.length - shownCandidates.length : 0;

  // Why the job shows no candidates, in words that match what is on screen.
  const emptyState = loading
    ? { kind: "loading", title: jobTitle ? `Loading ${jobTitle} candidates…` : "Loading candidates…" }
    : candidates.length === 0
      ? { kind: "none", title: "No candidates for this job yet." }
      : shownCandidates.length === 0 && hiddenByCanada > 0
        ? {
            kind: "canada",
            title: "0 in Canada.",
            action: (
              <Button type="button" size="sm" variant="outline" className="min-h-11 text-xs font-semibold" onClick={() => updateCanadaPrefs({ canadaOnly: false })} data-testid="canada-show-all">
                Show all {candidates.length}
              </Button>
            ),
          }
        : null;

  const handleNavigateIndex = (index) => {
    const target = swipeCandidates[index];
    if (pinnedId && target && String(target.id) !== pinnedId) {
      // Leaving the pinned card: it drops out of the queue, so find the target in the shorter list.
      const next = shownCandidates.filter(isUnreviewed).findIndex((item) => String(item.id) === String(target.id));
      setPinnedId("");
      setCurrentIndex(Math.max(0, next));
      return;
    }
    setCurrentIndex(index);
  };

  const nameOf = (candidateId) => candidates.find((item) => item.id === candidateId)?.name || "Candidate";

  // Shows what was saved, with an Undo that takes back only the row this action wrote.
  const showSaved = (text, undo, { candidateId, reveal = false } = {}) => {
    const run = async () => {
      setActionStatus({ ok: true, text: "Undoing…", pending: true });
      try {
        await undo();
        if (reveal && candidateId && activeView === "swipe") {
          setPinnedId(String(candidateId));
          setRevealId(String(candidateId));
        }
        setRefreshKey((key) => key + 1);
        setActionStatus({ ok: true, text: `${nameOf(candidateId)}: undone.` });
      } catch (error) {
        setActionStatus({ ok: false, text: error.message || "Could not undo that" });
      }
    };
    setActionStatus({ ok: true, text, undo: run });
  };

  const handleReject = async (candidateId, reason) => {
    if (!currentJob) return { ok: false, error: "No active job selected" };
    const name = nameOf(candidateId);
    try {
      const result = await rejectCandidate({
        jobId: currentJob.id,
        personId: candidateId,
        reason,
        recordDecision: recordCandidateDecision,
        logActivity: logCandidateActivity,
      });
      setRefreshKey((k) => k + 1);
      if (result.ok) {
        const undo = async () => {
          const { undo: token } = result;
          // The queued Loxo note goes first: if Loxo already has it, nothing is touched.
          if (token?.idempotencyKey) await undoQueuedActivity(currentJob.id, candidateId, token.idempotencyKey);
          if (token?.decision) await undoCandidateDecision(currentJob.id, candidateId, token.decision);
        };
        showSaved(`${name} passed: ${reason}. Waiting for Loxo.`, undo, { candidateId, reveal: true });
      } else {
        setActionStatus({ ok: false, text: result.error });
      }
      return result;
    } catch (error) {
      return { ok: false, error: error.message || "Failed to save pass decision" };
    }
  };

  const handleWant = async (candidateId) => {
    if (!currentJob) return { ok: false, error: "No active job selected" };
    try {
      const result = await recordCandidateDecision(currentJob.id, candidateId, "want");
      setPinnedId(String(candidateId));
      setRefreshKey((k) => k + 1);
      showSaved(`${nameOf(candidateId)} wanted. Saved here.`, () => undoCandidateDecision(currentJob.id, candidateId, result.undo), { candidateId });
      return result;
    } catch (error) {
      return { ok: false, error: error.message || "Failed to save want decision" };
    }
  };

  const handleLogActivity = async (candidateId, payload) => {
    if (!currentJob) return { ok: false, error: "No active job selected" };
    const res = await logCandidateActivity(currentJob.id, candidateId, payload);
    setRefreshKey((k) => k + 1);
    return res;
  };

  const handleMarkSubmitted = async (candidateId, details = {}) => {
    if (!currentJob) return { ok: false, error: "No active job selected" };
    try {
      const result = await recordCandidateSubmission(currentJob.id, candidateId, details);
      setRefreshKey((k) => k + 1);
      showSaved(`${nameOf(candidateId)} marked submitted. Waiting for Loxo.`, () => undoQueuedActivity(currentJob.id, candidateId, result.idempotencyKey), { candidateId });
      return result;
    } catch (error) {
      return { ok: false, error: error.message || "Failed to save submission" };
    }
  };

  // Opens a person's card in Swipe. Returns false when they are not in this job's list,
  // so the caller never shows someone else's card.
  const handleOpenCandidate = (candidateId) => {
    if (!shownCandidates.some((item) => item.id === candidateId)) return false;
    setPinnedId(String(candidateId));
    setRevealId(String(candidateId));
    setActiveView("swipe");
    return true;
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-3" data-testid="candidate-review-feature">
      {dataError ? (
        <div className="flex shrink-0 items-center gap-2 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-800" role="alert">
          <AlertCircle size={14} />
          {dataError}
        </div>
      ) : null}
      {actionStatus ? (
        <div
          role={actionStatus.ok ? "status" : "alert"}
          className={`flex shrink-0 items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold ${actionStatus.ok ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-rose-300 bg-rose-50 text-rose-800"}`}
          data-testid="action-status"
        >
          <span className="min-w-0">{actionStatus.text}</span>
          {actionStatus.undo ? (
            <Button type="button" size="sm" variant="outline" className="h-8 shrink-0 border-emerald-400 bg-white text-xs font-semibold text-emerald-900" onClick={actionStatus.undo} data-testid="undo-action">
              Undo
            </Button>
          ) : null}
        </div>
      ) : null}
      {/* Selected job and Canada filter. The Jobs column chooses the job. */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-lg border bg-card px-3 py-2 shadow-sm">
        <div className="flex min-w-0 items-center gap-2">
          <Briefcase size={16} className="shrink-0 text-muted-foreground" aria-hidden="true" />
          <h2 className="min-w-0 truncate text-base font-semibold leading-tight" data-testid="active-job-heading">
            {currentJob ? currentJob.title : "Candidates"}
          </h2>
          {currentJob && !loading ? (
            <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground" data-testid="job-candidate-count">
              {canadaPrefs.canadaOnly && hiddenByCanada > 0 ? `${shownCandidates.length} in Canada of ${candidates.length}` : `${candidates.length} for this job`}
            </span>
          ) : null}
        </div>

        {currentJob ? (
          <div className="flex flex-wrap items-center gap-2" data-testid="canada-filter">
            <button
              type="button"
              aria-pressed={canadaPrefs.canadaOnly}
              onClick={() => updateCanadaPrefs({ canadaOnly: !canadaPrefs.canadaOnly })}
              className={`inline-flex min-h-11 items-center gap-1 rounded-full border px-3 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${canadaPrefs.canadaOnly ? "border-primary bg-primary/10 font-semibold text-blue-700" : "bg-background font-medium text-muted-foreground"}`}
            >
              {canadaPrefs.canadaOnly ? <Check size={12} aria-hidden="true" /> : null}
              Canada only
            </button>
            {canadaPrefs.canadaOnly ? (
              <button
                type="button"
                aria-pressed={canadaPrefs.showUnknown}
                onClick={() => updateCanadaPrefs({ showUnknown: !canadaPrefs.showUnknown })}
                className={`inline-flex min-h-11 items-center gap-1 rounded-full border px-3 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${canadaPrefs.showUnknown ? "border-amber-400 bg-amber-50 font-semibold text-amber-900" : "bg-background font-medium text-muted-foreground"}`}
              >
                {canadaPrefs.showUnknown ? <Check size={12} aria-hidden="true" /> : null}
                Show unknown location
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* 2. Main Content View Area or Explicit Unmatched Empty State */}
      {!currentJob && activeView !== "people" ? (
        <div
          className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed bg-card p-8 text-center text-muted-foreground"
          data-testid="unmatched-job-state"
          role={loading ? "status" : undefined}
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted/50 mb-3 text-muted-foreground">
            <Briefcase size={24} />
          </div>
          {loading ? (
            <h3 className="text-sm font-semibold text-foreground">{jobTitle ? `Loading ${jobTitle} candidates…` : "Loading candidates…"}</h3>
          ) : (
            <>
              <h3 className="text-sm font-semibold text-foreground">
                {!dataError && jobs.length === 0 ? "No live review jobs available" : "No matching job selected"}
              </h3>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                {!dataError && jobs.length === 0
                  ? "No active Tracker jobs are available to this session. Check the Tracker import and data access."
                  : activeJobId
                    ? `The selected job ID "${activeJobId}" does not match any active review pipeline.`
                    : "Choose an active job in the Jobs column to review candidates."}
              </p>
              {onNavigateJobsMap && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onNavigateJobsMap}
                  className="mt-4 min-h-11 text-xs font-semibold"
                >
                  <MapPin size={13} className="mr-1.5" />
                  View roles in Jobs Map
                </Button>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {activeView === "swipe" ? (
            <SwipeView
              candidates={swipeCandidates}
              currentJob={currentJob}
              jobs={jobs}
              currentIndex={currentIndex}
              onNavigateIndex={handleNavigateIndex}
              onReject={handleReject}
              onWant={handleWant}
              onMarkSubmitted={handleMarkSubmitted}
              onLogActivity={handleLogActivity}
              onStartCandidateCall={onStartCandidateCall}
              emptyState={emptyState}
            />
          ) : (
            <PeopleView
              candidates={shownCandidates}
              currentJob={currentJob}
              jobs={jobs}
              submissionHistory={submissionHistory}
              onSelectCandidateToSwipe={handleOpenCandidate}
              onMarkSubmitted={handleMarkSubmitted}
              onStartCandidateCall={onStartCandidateCall}
              focusCandidateId={focusCandidateId}
              emptyState={emptyState}
            />
          )}
        </div>
      )}
    </div>
  );
}
