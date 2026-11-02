import { useState, useMemo, useEffect } from "react";
import { Briefcase, Layers, Users, MapPin, AlertCircle } from "lucide-react";
import { Badge } from "../../components/ui/badge.tsx";
import { Button } from "../../components/ui/button.tsx";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger } from "../../components/ui/select.tsx";
import SwipeView from "./SwipeView.jsx";
import PeopleView from "./PeopleView.jsx";
import {
  getReviewJobs,
  getCandidatesForJob,
  getSubmissionHistory,
  recordCandidateDecision,
  recordCandidateSubmission,
  logCandidateActivity,
  isSampleData,
} from "./candidateReviewService.js";

export default function CandidateReview({ selectedJob, onSelectJob, onNavigateJobsMap }) {
  const jobs = useMemo(() => getReviewJobs(), []);

  // Match selected jobs ONLY by immutable job ID.
  // Zero title matching. Zero jobs[0] fallback.
  const initialJobId = useMemo(() => {
    if (selectedJob) {
      const targetId = selectedJob.loxoJobId || selectedJob.originalJobId || selectedJob.id;
      if (targetId) {
        const match = jobs.find((j) => String(j.id) === String(targetId));
        return match ? match.id : String(targetId);
      }
    }
    return "";
  }, [jobs, selectedJob]);

  const [activeJobId, setActiveJobId] = useState(initialJobId);
  const [activeView, setActiveView] = useState("swipe"); // "swipe" | "people"
  const [currentIndex, setCurrentIndex] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);

  // Sync if selectedJob prop changes from outside (e.g. from Jobs Map)
  useEffect(() => {
    if (selectedJob) {
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

  const swipeCandidates = useMemo(
    () => candidates.filter((candidate) => !candidate.decision && !candidate.isSubmitted),
    [candidates]
  );

  const submissionHistory = useMemo(() => getSubmissionHistory(), [refreshKey]);

  const handleJobChange = (newJobId) => {
    setActiveJobId(newJobId);
    setCurrentIndex(0);
    const jobObj = jobs.find((j) => String(j.id) === String(newJobId));
    if (jobObj && onSelectJob) {
      onSelectJob(jobObj);
    }
  };

  const handlePass = async (candidateId) => {
    if (!currentJob) return { ok: false, error: "No active job selected" };
    try {
      const result = await recordCandidateDecision(currentJob.id, candidateId, "pass");
      setRefreshKey((k) => k + 1);
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
      {/* 1. Top Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-3 shadow-sm shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-foreground text-background">
            <Users size={18} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold leading-tight">Candidate Review</h2>
              {isSampleData() && (
                <Badge
                  variant="outline"
                  className="border-amber-400 bg-amber-50 text-amber-900 text-[11px] font-semibold py-0 px-2"
                >
                  Sample data
                </Badge>
              )}
              <Badge variant="outline" className="text-[11px] py-0 px-2">
                Session-only decisions
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
                  {jobs.map((j) => {
                    const count = getCandidatesForJob(j.id).length;
                    return (
                      <SelectItem key={j.id} value={String(j.id)} className="text-xs">
                        {j.title} ({count} {count === 1 ? "candidate" : "candidates"})
                      </SelectItem>
                    );
                  })}
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
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md transition font-semibold disabled:opacity-50 ${
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
              disabled={!currentJob}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md transition font-semibold disabled:opacity-50 ${
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

      {/* 2. Main Content View Area or Explicit Unmatched Empty State */}
      {!currentJob ? (
        <div
          className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed bg-card p-8 text-center text-muted-foreground"
          data-testid="unmatched-job-state"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted/50 mb-3 text-muted-foreground">
            <Briefcase size={24} />
          </div>
          <h3 className="text-sm font-bold text-foreground">No matching job selected</h3>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm">
            {activeJobId
              ? `The selected job ID "${activeJobId}" does not match any active review pipeline.`
              : "Choose an active job from the dropdown above to review candidates."}
          </p>
          {onNavigateJobsMap && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onNavigateJobsMap}
              className="mt-4 text-xs font-semibold"
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
              currentIndex={currentIndex}
              onNavigateIndex={setCurrentIndex}
              onPass={handlePass}
              onWant={handleWant}
              onLogActivity={handleLogActivity}
              onSwitchToPeopleView={() => setActiveView("people")}
            />
          ) : (
            <PeopleView
              candidates={candidates}
              currentJob={currentJob}
              jobs={jobs}
              submissionHistory={submissionHistory}
              onSelectCandidateToSwipe={handleSelectCandidateToSwipe}
              onMarkSubmitted={handleMarkSubmitted}
            />
          )}
        </div>
      )}
    </div>
  );
}
