import { useEffect, useState } from "react";
import { CalendarDays, FileText, Mail, RefreshCw, TimerReset, Users } from "lucide-react";
import { Button } from "../../components/ui/button.tsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card.tsx";
import { UpcomingCalendar } from "../../components/UpcomingCalendar.jsx";
import { loadHomeData } from "./homeService.js";

function WorkList({ title, description, icon: Icon, items, empty, onOpen, renderItem }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base"><Icon size={17} />{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          <span className="rounded-full border px-2 py-0.5 text-xs font-semibold" aria-label={`${items.length} items`}>{items.length}</span>
        </div>
      </CardHeader>
      <CardContent>
        {items.length ? (
          <ul className="space-y-2">
            {items.slice(0, 8).map((item, index) => (
              <li key={item.key || item.id || `${title}-${index}`}>
                <button type="button" onClick={() => onOpen(item)} className="w-full rounded-md border p-2.5 text-left text-sm outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring">
                  {renderItem(item)}
                </button>
              </li>
            ))}
          </ul>
        ) : <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">{empty}</p>}
      </CardContent>
    </Card>
  );
}

export default function HomePage({ onNavigate = () => {}, recentMeetingsLoader }) {
  const [requestId, setRequestId] = useState(0);
  const [state, setState] = useState({ phase: "loading", data: null, meetings: [] });

  useEffect(() => {
    let active = true;
    setState({ phase: "loading", data: null, meetings: [] });
    Promise.all([
      loadHomeData(),
      typeof recentMeetingsLoader === "function" ? recentMeetingsLoader() : Promise.resolve([]),
    ]).then(([data, meetings]) => {
      if (active) setState({ phase: "success", data, meetings: Array.isArray(meetings) ? meetings : [] });
    }).catch(() => {
      if (active) setState({ phase: "error", data: null, meetings: [] });
    });
    return () => { active = false; };
  }, [requestId, recentMeetingsLoader]);

  if (state.phase === "loading") return <section className="min-h-80 rounded-lg border p-6" role="status">Loading today&apos;s work...</section>;
  if (state.phase === "error") return <section className="rounded-lg border p-6" role="alert"><h2 className="font-semibold">Home could not be loaded</h2><p className="mt-1 text-sm text-muted-foreground">Live Workbench data is unavailable.</p><Button className="mt-4" variant="outline" onClick={() => setRequestId((value) => value + 1)}><RefreshCw size={15} />Retry</Button></section>;

  const { data, meetings } = state;
  return (
    <div className="flex flex-col gap-4" data-testid="home-page">
      <div><span className="eyebrow">TODAY</span><h2 className="text-lg font-semibold">Recruiting workbench</h2></div>
      <div className="grid gap-4 xl:grid-cols-3">
        <WorkList title="Waiting for Loxo" description="Queued changes grouped by candidate." icon={Users} items={data.waiting} empty="No Loxo changes are waiting." onOpen={(item) => onNavigate("Process", item)} renderItem={(item) => <><strong>{item.candidateName}</strong><span className="block text-xs text-muted-foreground">{item.count} queued action{item.count === 1 ? "" : "s"}</span></>} />
        <WorkList title="Drafts ready" description="Source-backed drafts ready for review." icon={FileText} items={data.drafts} empty="No drafts are ready." onOpen={(item) => onNavigate("Candidate Review", item)} renderItem={(item) => <><strong>{String(item.kind || "Draft").replaceAll("_", " ")}</strong><span className="block text-xs text-muted-foreground">Job {item.job_id || "not on file"}</span></>} />
        <WorkList title="Follow-ups due" description={data.replies.available ? "Three business days with no detected reply." : "Gmail read access is not available."} icon={TimerReset} items={data.followUps} empty={data.replies.available ? "No follow-ups are due." : "Reply status is unavailable."} onOpen={(item) => onNavigate("Mail", item)} renderItem={(item) => <><strong>{item.subject || "Outreach"}</strong><span className="block text-xs text-muted-foreground">{item.candidateEmail || "Email not on file"}</span></>} />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><CalendarDays size={17} />Today</CardTitle></CardHeader><CardContent><UpcomingCalendar /></CardContent></Card>
        <WorkList title="Recent meetings" description="Saved meeting drafts." icon={Mail} items={meetings} empty="No recent meetings are available." onOpen={(item) => onNavigate("Meetings", item)} renderItem={(item) => <><strong>{item.title || "Untitled meeting"}</strong><span className="block text-xs text-muted-foreground">{item.createdAt ? new Date(item.createdAt).toLocaleString() : "Date not on file"}</span></>} />
      </div>
    </div>
  );
}
