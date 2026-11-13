import { lazy, Suspense } from "react";
import ProcessPage from "./ProcessPage.jsx";

const JobsMapView = lazy(() => import("../jobs-map/JobsMapView.jsx"));

export default function RecruitingWorkspace({ page, value, onChange, onOpenJobReview }) {
  if (page === "Process") return <ProcessPage />;

  const job = value?.job || null;
  return <div className="flex min-w-0 flex-col gap-4" data-testid="jobs-workspace">
    <div><span className="eyebrow">TRACKER WORKSPACE</span><h2 className="text-lg font-semibold">Jobs</h2></div>
    <Suspense fallback={<div className="min-h-[400px] flex items-center justify-center text-sm text-muted-foreground" role="status">Loading Jobs Map…</div>}>
      <JobsMapView
        focusJobId={job?.loxoJobId || job?.id || ""}
        onSelectJobForWorkflow={(selected) => onChange?.({ ...(value || {}), job: {
          company: selected.company,
          title: selected.title,
          loxoJobId: selected.originalJobId || selected.id,
          loxoJobStatus: selected.status || "Active",
          location: selected.displayLocation || selected.rawLocation,
          demoOnly: false,
        } })}
        onOpenJobReview={(selected) => onOpenJobReview?.({
          id: selected.originalJobId || selected.id,
          title: selected.title,
          company: selected.company,
          location: selected.displayLocation || selected.rawLocation,
        })}
      />
    </Suspense>
  </div>;
}
