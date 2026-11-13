import { useState, useMemo, useEffect, useRef } from "react";
import { Briefcase, Layers, Users, MapPin, AlertCircle } from "lucide-react";
import { Badge } from "../../components/ui/badge.tsx";
import { Button } from "../../components/ui/button.tsx";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger } from "../../components/ui/select.tsx";
import SwipeView from "./SwipeView.jsx";
import PeopleView from "./PeopleView.jsx";
import { rejectCandidate } from "./rejectReasons.js";
import { filterByCanada, loadCanadaPrefs, saveCanadaPrefs } from "./canadaFilter.js";
import { isInCanada } from "./externals.js";
import {
  getCandidatesForJob,
  getSubmissionHistory,
  recordCandidateDecision,
  recordCandidateSubmission,
  logCandidateActivity,
  loadLiveReviewJobs,
  loadLiveCandidatesForJob,
} from "./candidateReviewService.js";

export default function CandidateReview({ selectedJob, onSelectJob, onNavigateJobsMap, onStartCandidateCall, initialView = "swipe", focusCandidateId = "" }) {
  const [jobs, setJobs] = useState([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [dataError, setDataError] = useState("");

  // Match selected jobs ONLY by immutable job ID.
  // Zero title matching. Zero jobs[0] fallback.
  const [activeJobId, setActiveJobId] = useState("");
  const [activeView, setActiveView] = useState(initialView); // "swipe" | "people"
  const [currentIndex, setCurrentIndex] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [canadaPrefs, setCanadaPrefs] = useState(() => loadCanadaPrefs());
  const [rejectStatus, setRejectStatus] = useState(null); // { ok, text }

  const updateCanadaPrefs = (patch) => {
    setCanadaPrefs((current) => {
      const next = { ...current, ...patch };
      saveCanadaPrefs(next);
      return next;
    });
    setCurrentIndex(0);
  };

  useEffect(() => {
    if (!rejectStatus?.ok) return undefined;
    const timer = window.setTimeout(() => setRejectStatus(null), 4000);
    return () => window.clearTimeout(timer);
  }, [rejectStatus]);

  useEffect(() => {
    let active = true;
    loadLiveReviewJobs()
      .then((loadedJobs) => {
        if (!active) return;
        setJobs(loadedJobs);
        const targetId = selectedJob?.loxoJobId || selectedJob?.originalJobId || selectedJob?.id;
        const matched = targetId
          ? loadedJobs.find((job) => String(job.id) === String(targetId))
          : null;
        const nextJob = matched || loadedJobs[0] || null;
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
        if (resolvedId !== activeJobId) {
          setActiveJobId(resolvedId);
          setCurrentIndex(0);
        }
      }
    }
  }, [selectedJob, jobs]);

  useEffect(() => {
    if (!activeJobId) return;
    let active = true;
    setDataLoading(true);
    loadLiveCandidatesForJob(activeJobId)
      .then(() => {
        if (!active) return;
        setDataError("");
        setRefreshKey((key) => key + 1);
      })
      .catch((error) => {
        if (!active) return;
        setDataError(error.message || "Could not load candidates for this job");
      })
      .finally(() => {
        if (active) setDataLoading(false);
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
    () => shownCandidates.filter((candidate) => !candidate.decision && !candidate.isSubmitted && candidate.presentationState !== "pending"),
    [shownCandidates]
  );

  // Opened from another page (e.g. Pipeline): jump to that person once their job's candidates load.
  const focusedRef = useRef("");
  useEffect(() => {
    if (!focusCandidateId || dataLoading || focusedRef.current === String(focusCandidateId)) return;
    if (initialView === "people") {
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
  }, [focusCandidateId, dataLoading, candidates, swipeCandidates, initialView]);

  const submissionHistory = useMemo(() => getSubmissionHistory(), [refreshKey]);

  const supabaseStatus = dataLoading
    ? "Loading live data"
    : dataError
      ? "Live data unavailable"
      : jobs.length === 0
        ? "No live review jobs available"
        : "Connected to Supabase";

  const handleJobChange = (newJobId) => {
    setActiveJobId(newJobId);
    setCurrentIndex(0);
    const jobObj = jobs.find((j) => String(j.id) === String(newJobId));
    if (jobObj && onSelectJob) {
      onSelectJob(jobObj);
    }
  };

  const handleReject = async (candidateId, reason) => {
    if (!currentJob) return { ok: false, error: "No active job selected" };
    const name = candidates.find((item) => item.id === candidateId)?.name || "Candidate";
    try {
      const result = await rejectCandidate({
        jobId: currentJob.id,
        personId: candidateId,
        reason,
        recordDecision: recordCandidateDecision,
        logActivity: logCandidateActivity,
      });
      setRefreshKey((k) => k + 1);
      setRejectStatus(
        result.ok
          ? { ok: true, text: `${name} passed: ${reason}. Waiting for Loxo.` }
          : { ok: false, text: result.error }
      );
      return result;
    } catch (error) {
      return { ok: false, error: error.message || "Failed to save pass decision" };
    }
  };

  const handleWant = async (candidateId) => {
    if (!currentJob) return { ok: false, error: "No active job selected" };
    try {
      const result = await recordCandidateDecision(currentJob.id, candidateId, "want");
      setRefreshKey((k) => k + 1);
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
      return result;
    } catch (error) {
      return { ok: false, error: error.message || "Failed to save submission" };
    }
  };

  const handleSelectCandidateToSwipe = (candidateId) => {
    const idx = swipeCandidates.findIndex((c) => c.id === candidateId);
    if (idx !== -1) {
      setCurrentIndex(idx);
    }
    setActiveView("swipe");
  };

  return (
    <div
      className="flex flex-col gap-3 h-[calc(100vh-140px)] min-h-[580px] w-full"
      style={{ fontFamily: "Arial, Calibri, sans-serif" }}
      data-testid="candidate-review-feature"
    >
      {dataError ? (
        <div className="flex items-center gap-2 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-800" role="alert">
          <AlertCircle size={14} />
          {dataError}
        </div>
      ) : null}
      {rejectStatus ? (
        <div
          role={rejectStatus.ok ? "status" : "alert"}
          className={`rounded-lg border px-3 py-2 text-xs font-semibold ${rejectStatus.ok ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-rose-300 bg-rose-50 text-rose-800"}`}
        >
          {rejectStatus.text}
        </div>
      ) : null}
      {/* 1. Top Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-3 shadow-sm shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-foreground text-background">
            <Users size={18} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold leading-tight">Candidate Review</h2>
              <Badge variant="outline" className="text-[11px] py-0 px-2">
                {supabaseStatus}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Review candidates for one job at a time via Swipe or People view
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Clear Jobs Map Navigation */}
          {onNavigateJobsMap && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onNavigateJobsMap}
              className="h-8 text-xs font-semibold flex items-center gap-1.5"
              data-testid="navigate-jobs-map"
              title="Open Jobs Map view"
            >
              <MapPin size={13} className="text-muted-foreground" />
              <span>Jobs Map</span>
            </Button>
          )}

          {/* Active Job Selector: Shows job title, never raw ID */}
          <div className="flex items-center gap-1.5 min-w-[220px]">
            <Briefcase size={14} className="text-muted-foreground shrink-0" />
            <Select value={String(activeJobId)} onValueChange={handleJobChange}>
              <SelectTrigger className="w-full text-xs h-8" data-testid="job-picker-trigger">
                <span className="truncate font-semibold text-foreground">
                  {currentJob ? currentJob.title : "Select active job"}
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {jobs.map((j) => (
                    <SelectItem key={j.id} value={String(j.id)} className="text-xs">
                      {j.title}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          {/* Swipe / People Toggle Buttons */}
          <div className="flex rounded-lg border bg-muted p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setActiveView("swipe")}
              disabled={!currentJob}
              className={`flex min-h-11 items-center gap-1.5 px-3 py-1 rounded-md transition font-semibold disabled:opacity-50 ${
                activeView === "swipe"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Layers size={13} />
              <span>Swipe</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveView("people")}
              className={`flex min-h-11 items-center gap-1.5 px-3 py-1 rounded-md transition font-semibold disabled:opacity-50 ${
                activeView === "people"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Users size={13} />
              <span>People</span>
            </button>
          </div>
        </div>
      </div>

      {currentJob ? (
        <div className="flex flex-wrap items-center gap-2 shrink-0" data-testid="canada-filter">
          <button
            type="button"
            aria-pressed={canadaPrefs.canadaOnly}
            onClick={() => updateCanadaPrefs({ canadaOnly: !canadaPrefs.canadaOnly })}
            className={`min-h-11 rounded-full border px-3 py-1 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${canadaPrefs.canadaOnly ? "border-foreground bg-foreground text-background" : "bg-background text-muted-foreground"}`}
          >
            Canada only
          </button>
          {canadaPrefs.canadaOnly ? (
            <button
              type="button"
              aria-pressed={canadaPrefs.showUnknown}
              onClick={() => updateCanadaPrefs({ showUnknown: !canadaPrefs.showUnknown })}
              className={`min-h-11 rounded-full border px-3 py-1 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${canadaPrefs.showUnknown ? "border-amber-400 bg-amber-50 text-amber-900" : "bg-background text-muted-foreground"}`}
            >
              Show unknown location
            </button>
          ) : null}
          <span className="text-xs text-muted-foreground">{shownCandidates.length} shown</span>
        </div>
      ) : null}

      {/* 2. Main Content View Area or Explicit Unmatched Empty State */}
      {!currentJob && activeView !== "people" ? (
        <div
          className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed bg-card p-8 text-center text-muted-foreground"
          data-testid="unmatched-job-state"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted/50 mb-3 text-muted-foreground">
            <Briefcase size={24} />
          </div>
          <h3 className="text-sm font-bold text-foreground">
            {!dataLoading && !dataError && jobs.length === 0 ? "No live review jobs available" : "No matching job selected"}
          </h3>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm">
            {!dataLoading && !dataError && jobs.length === 0
              ? "No active Tracker jobs are available to this session. Check the Tracker import and data access."
              : activeJobId
                ? `The selected job ID "${activeJobId}" does not match any active review pipeline.`
                : "Choose an active job from the dropdown above to review candidates."}
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
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {activeView === "swipe" ? (
            <SwipeView
              candidates={swipeCandidates}
              currentJob={currentJob}
              jobs={jobs}
              currentIndex={currentIndex}
              onNavigateIndex={setCurrentIndex}
              onReject={handleReject}
              onWant={handleWant}
              onLogActivity={handleLogActivity}
              onSwitchToPeopleView={() => setActiveView("people")}
              onStartCandidateCall={onStartCandidateCall}
            />
          ) : (
            <PeopleView
              candidates={shownCandidates}
              currentJob={currentJob}
              jobs={jobs}
              submissionHistory={submissionHistory}
              onSelectCandidateToSwipe={handleSelectCandidateToSwipe}
              onMarkSubmitted={handleMarkSubmitted}
              onStartCandidateCall={onStartCandidateCall}
              focusCandidateId={focusCandidateId}
            />
          )}
        </div>
      )}
    </div>
  );
}
