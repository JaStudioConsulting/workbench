import { useState } from "react";
import { ChevronDown, ChevronRight, FileText } from "lucide-react";
import { Button } from "../../components/ui/button.tsx";
import { FIGURE_REGEX } from "./figureUtils.js";

// Bold figures, quantities, and metrics while preserving 100% verbatim text
export function formatVerbatimBoldFigures(text) {
  if (!text) return null;
  const parts = text.split(FIGURE_REGEX);
  return parts.map((part, index) => {
    if (FIGURE_REGEX.test(part)) {
      FIGURE_REGEX.lastIndex = 0; // reset stateful regex
      return (
        <strong key={index} className="font-semibold text-foreground">
          {part}
        </strong>
      );
    }
    return part;
  });
}

export default function ResumeSection({ candidate }) {
  const [showFullResume, setShowFullResume] = useState(false);
  const [expandedJobs, setExpandedJobs] = useState(() => {
    // Expand the most recent job by default if jobs exist
    const initial = {};
    if (candidate.workHistory && candidate.workHistory.length > 0) {
      initial[candidate.workHistory[0].id] = true;
    }
    return initial;
  });

  const toggleJob = (jobId) => {
    setExpandedJobs((prev) => ({
      ...prev,
      [jobId]: !prev[jobId],
    }));
  };

  const hasWorkHistory = candidate.workHistory && candidate.workHistory.length > 0;

  return (
    <div className="flex flex-col gap-2.5 rounded-lg border bg-card p-3" data-testid="candidate-resume-section">
      <div className="flex items-center justify-between gap-2 border-b pb-2">
        <div className="flex items-center gap-1.5">
          <FileText size={14} className="text-muted-foreground" />
          <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Resume and Work History
          </h4>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setShowFullResume((prev) => !prev)}
        >
          {showFullResume ? "Hide full resume" : "Full resume"}
          {showFullResume ? <ChevronDown size={13} className="ml-1" /> : <ChevronRight size={13} className="ml-1" />}
        </Button>
      </div>

      {showFullResume && (
        <div className="rounded-md border bg-muted/30 p-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
            Verbatim Source Resume
          </p>
          <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-foreground">
            {formatVerbatimBoldFigures(candidate.fullResumeText)}
          </pre>
        </div>
      )}

      {hasWorkHistory ? (
        <div className="flex flex-col gap-2">
          {candidate.workHistory.map((job) => {
            const isExpanded = Boolean(expandedJobs[job.id]);
            return (
              <div key={job.id} className="rounded-md border bg-background/50 p-2 text-xs">
                <button
                  type="button"
                  onClick={() => toggleJob(job.id)}
                  className="flex w-full items-start justify-between gap-2 text-left"
                  aria-expanded={isExpanded}
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-foreground leading-snug">
                      {job.title}
                    </p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {job.company} · {job.location}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 text-[11px] text-muted-foreground">
                    <span>
                      {job.startDate} to {job.endDate}
                    </span>
                    {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </div>
                </button>

                {isExpanded && job.bullets && job.bullets.length > 0 && (
                  <ul className="mt-2 space-y-1.5 border-t pt-2 text-[11.5px] leading-relaxed text-foreground/90 pl-3 list-disc marker:text-muted-foreground">
                    {job.bullets.map((bullet, bIndex) => (
                      <li key={bIndex}>
                        {formatVerbatimBoldFigures(bullet)}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
          No structured work history on file for this candidate profile.
        </div>
      )}

      {candidate.education && (
        <div className="pt-1 text-[11px] text-muted-foreground border-t">
          <span className="font-semibold text-foreground">Education:</span> {candidate.education}
        </div>
      )}
    </div>
  );
}
