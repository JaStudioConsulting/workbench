import { ChevronLeft, ChevronRight, Users } from "lucide-react";
import { Button } from "../../components/ui/button.tsx";
import CandidateCard from "./CandidateCard.jsx";
import { CandidatePresentationBadges } from "./CandidatePresentationSummary.jsx";
import { getWindowedIndices, MAX_VISIBLE_DOTS } from "./figureUtils.js";

export default function SwipeView({
  candidates,
  currentJob,
  jobs,
  currentIndex,
  onNavigateIndex,
  onReject,
  onWant,
  onLogActivity,
  onSwitchToPeopleView,
  onStartCandidateCall,
}) {
  if (!candidates || candidates.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed bg-card p-8 text-center text-muted-foreground">
        <Users size={32} className="mb-2 opacity-50" />
        <p className="text-sm font-semibold text-foreground">
          Unreviewed queue is clear
        </p>
        <p className="text-xs text-muted-foreground mt-1 max-w-sm">
          Reviewed and previously submitted candidates remain available in People view.
        </p>
      </div>
    );
  }

  const safeIndex = Math.max(0, Math.min(currentIndex, candidates.length - 1));
  const currentCandidate = candidates[safeIndex];

  return (
    <div className="flex flex-1 min-h-0 flex-col gap-2.5 overflow-hidden" data-testid="swipe-view">
      {/* Position Navigation Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 shrink-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-muted-foreground">
            Candidate {safeIndex + 1} of {candidates.length}
          </span>
          {currentCandidate.decision && (
            <span
              className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${currentCandidate.decision === "want"
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-rose-100 text-rose-800"
                }`}
            >
              {currentCandidate.decision === "want" ? "Marked Want" : "Marked Pass"}
            </span>
          )}
          <CandidatePresentationBadges
            candidate={currentCandidate}
            jobId={currentJob?.id}
            prefix="swipe"
          />
        </div>

        <div className="flex w-full min-w-0 items-center justify-between gap-1.5 sm:w-auto sm:justify-end">
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            aria-label="Previous candidate"
            disabled={safeIndex === 0}
            onClick={() => onNavigateIndex(safeIndex - 1)}
            title="Previous candidate"
          >
            <ChevronLeft size={14} className="mr-0.5" /><span className="sm:hidden">Prev</span><span className="hidden sm:inline">Previous</span>
          </Button>

          {/* Windowed Dots Indicator */}
          <div className="hidden sm:flex items-center gap-1 px-1" data-testid="windowed-dots-container">
            {getWindowedIndices(candidates.length, safeIndex, MAX_VISIBLE_DOTS).map((i) => {
              const c = candidates[i];
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onNavigateIndex(i)}
                  className={`h-2 rounded-full transition-all ${
                    i === safeIndex
                      ? "w-5 bg-foreground"
                      : c.decision === "want"
                      ? "w-2 bg-emerald-600"
                      : c.decision === "pass"
                      ? "w-2 bg-rose-500"
                      : "w-2 bg-border"
                  }`}
                  title={`Go to ${c.name} (${i + 1} of ${candidates.length})`}
                  data-testid={`candidate-dot-${i}`}
                />
              );
            })}
          </div>

          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            aria-label="Next candidate"
            disabled={safeIndex === candidates.length - 1}
            onClick={() => onNavigateIndex(safeIndex + 1)}
            title="Next candidate"
          >
            <span className="sm:hidden">Next</span><span className="hidden sm:inline">Next</span><ChevronRight size={14} className="ml-0.5" />
          </Button>
        </div>
      </div>

      {/* Mount Current Candidate Card */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <CandidateCard
          key={currentCandidate.id}
          candidate={currentCandidate}
          currentJob={currentJob}
          jobs={jobs}
          onStartCandidateCall={onStartCandidateCall}
          onReject={async (id, reason) => {
            const result = await onReject(id, reason);
            if (result?.ok === false) return result;
            return result || { ok: true };
          }}
          onWant={async (id) => {
            const result = await onWant(id);
            if (result?.ok === false) return result;
            return result || { ok: true };
          }}
          onLogActivity={onLogActivity}
        />
      </div>
    </div>
  );
}

