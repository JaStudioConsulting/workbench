import { useMemo } from "react";
import { Briefcase } from "lucide-react";
import { buildTimeline } from "./experienceTimeline.js";
import { scoreFit } from "./externals.js";

function safeRoleMatches(job, candidate) {
  try {
    return scoreFit(job, candidate)?.roleMatches || [];
  } catch {
    return [];
  }
}

export default function ExperienceTimeline({ candidate, job }) {
  const timeline = useMemo(
    () => buildTimeline(candidate.workHistory, safeRoleMatches(job, candidate)),
    [candidate, job]
  );

  return (
    <section className="rounded-lg border bg-card p-3" aria-label="Experience timeline" data-testid="experience-timeline">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          <Briefcase size={12} /> Experience
        </h3>
        {timeline.totalLabel ? (
          <span className="text-xs font-semibold">{timeline.totalLabel} total</span>
        ) : null}
      </div>
      {timeline.rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No work history on file.</p>
      ) : (
        <ol className="space-y-2">
          {timeline.rows.map((row) => (
            <li key={row.key} className="flex gap-2.5">
              <span
                aria-hidden="true"
                className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${row.why ? "bg-emerald-600" : "bg-border"}`}
              />
              <div className="min-w-0 text-xs">
                <p className="font-semibold leading-snug">
                  {row.title}
                  {row.company ? <span className="font-normal text-muted-foreground"> at {row.company}</span> : null}
                </p>
                <p className="text-muted-foreground">
                  {row.dates || "Dates not on file"}
                  {row.duration ? ` (${row.duration})` : ""}
                  {row.shortStint ? (
                    <span className="ml-2 rounded-full border border-rose-300 bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-800">
                      Short stint
                    </span>
                  ) : null}
                </p>
                {row.why ? <p className="text-emerald-800">{row.why}</p> : null}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
