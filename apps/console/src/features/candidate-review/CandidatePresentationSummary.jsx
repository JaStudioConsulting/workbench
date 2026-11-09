import { useMemo } from "react";
import { Badge } from "../../components/ui/badge.tsx";
import { buildCandidatePresentationSummary } from "./candidateReviewService.js";

export function CandidatePresentationBadges({
  candidate,
  presentations = null,
  jobId = null,
  prefix = "card",
}) {
  const summary = useMemo(
    () => buildCandidatePresentationSummary(candidate, presentations, { jobId }),
    [candidate, presentations, jobId]
  );

  if (!summary.isPresented && summary.unconfirmedPresentations.length === 0) {
    return null;
  }

  return (
    <>
      {summary.isPresented ? (
        <Badge
          className="bg-blue-700 text-white text-[11px] font-bold py-0"
          data-testid={`${prefix}-presented-badge`}
        >
          Presented
        </Badge>
      ) : null}

      {summary.pendingPresentations.length > 0 ? (
        <Badge
          variant="outline"
          className="border-amber-400 bg-amber-50 text-amber-900 text-[11px] font-semibold py-0"
          data-testid={`${prefix}-pending-presentation-badge`}
        >
          {summary.pendingBadgeLabel}
        </Badge>
      ) : null}

      {summary.failedPresentations.length > 0 ? (
        <Badge
          variant="outline"
          className="border-rose-400 bg-rose-50 text-rose-800 text-[11px] font-semibold py-0"
          data-testid={`${prefix}-failed-presentation-badge`}
        >
          {summary.failedBadgeLabel}
        </Badge>
      ) : null}
    </>
  );
}

export default function CandidatePresentationSummary({
  candidate,
  presentations = null,
  jobId = null,
  prefix = "card",
  compact = false,
}) {
  const summary = useMemo(
    () => buildCandidatePresentationSummary(candidate, presentations, { jobId }),
    [candidate, presentations, jobId]
  );

  if (!summary.isPresented && summary.unconfirmedPresentations.length === 0) {
    return null;
  }

  return (
    <div
      className={
        compact
          ? "mt-1.5 flex flex-col gap-1 text-[11px]"
          : "rounded-md border bg-muted/20 px-3 py-2 text-xs space-y-1.5"
      }
      data-testid={`${prefix}-presentation-section`}
    >
      {summary.isPresented ? (
        <div className="space-y-1" data-testid={`${prefix}-presented-summary`}>
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className="font-semibold text-foreground"
              data-testid={`${prefix}-presented-clients`}
            >
              Presented to: {summary.presentedClientLabels.join(", ")}
            </span>
            {summary.presentedClientSummaries.map((group) => (
              <Badge
                key={group.key}
                variant="outline"
                className="border-blue-300 bg-blue-50 text-blue-950 text-[10.5px] py-0"
                data-testid={`${prefix}-presented-client-badge`}
              >
                {group.clientLabel}
                {group.presentationCount > 1 ? ` (${group.presentationCount}x)` : ""}
              </Badge>
            ))}
          </div>

          <ul
            className="space-y-0.5 text-muted-foreground"
            data-testid={`${prefix}-confirmed-presentations`}
          >
            {summary.confirmedPresentations.map((record) => (
              <li
                key={record.id}
                data-testid={`${prefix}-confirmed-presentation-row`}
              >
                <span className="font-medium text-foreground">{record.clientLabel}</span>
                {" · "}
                <span>{record.jobLabel}</span>
                {" · "}
                <span>{record.statusLabel}</span>
                {" · "}
                <span>{record.dateLabel}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {summary.unconfirmedPresentations.length > 0 ? (
        <div
          className="space-y-0.5"
          data-testid={`${prefix}-unconfirmed-presentations`}
        >
          {summary.unconfirmedPresentations.map((record) => (
            <div
              key={record.id}
              className={
                record.presentationState === "failed"
                  ? "text-rose-800"
                  : "text-amber-900"
              }
              data-testid={`${prefix}-unconfirmed-presentation-row`}
            >
              <span className="font-semibold">
                {record.presentationState === "failed"
                  ? "Submission failed"
                  : "Pending confirmation"}
              </span>
              {": "}
              <span>{record.clientLabel}</span>
              {" · "}
              <span>{record.jobLabel}</span>
              {" · "}
              <span>{record.dateLabel}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
