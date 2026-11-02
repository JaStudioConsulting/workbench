import { useState, useMemo } from "react";
import { ExternalLink, AlertTriangle, Users, Filter } from "lucide-react";
import { Badge } from "../../components/ui/badge.tsx";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select.tsx";
import { LOXO_PIPELINE_STAGES, RESUME_INDICATOR_STATES } from "./constants.js";

const LOXO_PEOPLE_BASE_URL = "https://app.loxo.co/people/";

export default function PeopleView({
  candidates,
  onSelectCandidateToSwipe,
}) {
  const [stageFilter, setStageFilter] = useState("ALL");
  const [onlyOthersReachedOut, setOnlyOthersReachedOut] = useState(false);

  const filteredCandidates = useMemo(() => {
    return candidates.filter((c) => {
      if (stageFilter !== "ALL" && c.stage !== stageFilter) {
        return false;
      }
      if (onlyOthersReachedOut && (!c.otherContactsCount || c.otherContactsCount === 0)) {
        return false;
      }
      return true;
    });
  }, [candidates, stageFilter, onlyOthersReachedOut]);

  return (
    <div className="flex flex-1 min-h-0 flex-col gap-3 overflow-hidden" data-testid="people-view">
      {/* Filters Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-lg border bg-card p-3 shadow-sm shrink-0">
        <div className="flex items-center gap-2">
          <Filter size={14} className="text-muted-foreground" />
          <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Filters
          </span>
          <span className="text-xs text-muted-foreground">
            ({filteredCandidates.length} of {candidates.length} candidates)
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Stage Filter */}
          <div className="w-48">
            <Select value={stageFilter} onValueChange={setStageFilter}>
              <SelectTrigger className="w-full text-xs h-8">
                <SelectValue placeholder="All Stages" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="ALL" className="text-xs">
                    All Stages
                  </SelectItem>
                  {LOXO_PIPELINE_STAGES.map((stg) => (
                    <SelectItem key={stg} value={stg} className="text-xs">
                      {stg}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          {/* Others Reached Out Filter */}
          <button
            type="button"
            onClick={() => setOnlyOthersReachedOut((prev) => !prev)}
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors h-8 ${
              onlyOthersReachedOut
                ? "border-amber-400 bg-amber-50 text-amber-900"
                : "border-border bg-background text-muted-foreground hover:text-foreground"
            }`}
          >
            <AlertTriangle size={12} className={onlyOthersReachedOut ? "text-amber-700" : "text-muted-foreground"} />
            <span>Others reached out filter</span>
          </button>
        </div>
      </div>

      {/* Candidate Table List */}
      <div className="flex-1 min-h-0 overflow-y-auto rounded-lg border bg-card">
        {filteredCandidates.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-8 text-center text-muted-foreground">
            <Users size={28} className="mb-2 opacity-50" />
            <p className="text-xs font-semibold text-foreground">
              No candidates match selected filters
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Adjust stage or others reached out filters to view candidates.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filteredCandidates.map((c) => {
              const resumeInfo =
                RESUME_INDICATOR_STATES[c.resumeStatus] ||
                RESUME_INDICATOR_STATES.resume_on_file;

              const lastActivity =
                c.activityTrail && c.activityTrail.length > 0
                  ? c.activityTrail[0]
                  : null;

              return (
                <div
                  key={c.id}
                  onClick={() => onSelectCandidateToSwipe(c.id)}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 hover:bg-muted/30 cursor-pointer transition-colors"
                >
                  {/* Left: Avatar, Name (Loxo link), Title & Employer */}
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-foreground text-background font-bold text-sm">
                      {c.initials}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <a
                          href={`${LOXO_PEOPLE_BASE_URL}${c.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="font-bold text-sm hover:underline hover:text-amber-800 flex items-center gap-1 leading-snug"
                          title="Open Loxo profile in new tab"
                        >
                          <span>{c.name}</span>
                          <ExternalLink size={12} className="text-muted-foreground" />
                        </a>

                        <Badge variant="outline" className="text-[11px] font-semibold py-0 px-1.5">
                          {c.stage}
                        </Badge>

                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.2 text-[10.5px] font-medium border ${
                            resumeInfo.key === "no_resume_data"
                              ? "border-amber-400 bg-amber-50 text-amber-900"
                              : resumeInfo.key === "profile_only"
                              ? "border-border bg-muted/30 text-muted-foreground"
                              : "border-emerald-300 bg-emerald-50 text-emerald-800"
                          }`}
                        >
                          <span>{resumeInfo.symbol}</span>
                          <span>{resumeInfo.label}</span>
                        </span>
                      </div>

                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {c.title} at {c.employer} · {c.location}
                      </p>
                    </div>
                  </div>

                  {/* Right: Last Activity, Other Contacts Flag, Decision Status */}
                  <div className="flex flex-wrap items-center gap-3 shrink-0 sm:text-right">
                    {/* Last Activity */}
                    {lastActivity && (
                      <div className="text-left sm:text-right text-[11px] text-muted-foreground max-w-xs">
                        <span className="font-medium text-foreground block truncate">
                          {lastActivity.type}
                        </span>
                        <span className="text-[10px] block truncate">
                          {lastActivity.date} {lastActivity.actor ? `by ${lastActivity.actor}` : ""}
                        </span>
                      </div>
                    )}

                    {/* Other contacts flag */}
                    {c.otherContactsCount > 0 ? (
                      <Badge
                        variant="outline"
                        className="border-amber-400 bg-amber-50 text-amber-900 text-[10.5px] font-semibold flex items-center gap-1 py-0.5 px-1.5"
                      >
                        <AlertTriangle size={11} className="text-amber-700" />
                        {c.otherContactsCount} other contact{c.otherContactsCount > 1 ? "s" : ""}
                      </Badge>
                    ) : (
                      <span className="text-[11px] text-muted-foreground hidden md:inline">
                        No other outreach
                      </span>
                    )}

                    {/* Wanted or Passed mark */}
                    <div className="w-24 text-right">
                      {c.decision === "want" ? (
                        <Badge className="bg-emerald-700 hover:bg-emerald-800 text-white text-[11px] font-bold">
                          Want
                        </Badge>
                      ) : c.decision === "pass" ? (
                        <Badge variant="outline" className="border-rose-400 bg-rose-50 text-rose-800 text-[11px] font-bold">
                          Passed
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground text-[10.5px]">
                          Unreviewed
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

