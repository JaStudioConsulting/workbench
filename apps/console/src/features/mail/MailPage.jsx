import { useEffect, useState } from "react";
import { Button } from "../../components/ui/button.tsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table.tsx";
import { listOutreach } from "./mailClient.js";
import { channelLabel } from "./mailPageService.js";

function formatDate(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(date)
    : "Date not on file";
}

export default function MailPage() {
  const [requestId, setRequestId] = useState(0);
  const [state, setState] = useState({ phase: "loading", outreach: [], error: "" });

  useEffect(() => {
    let active = true;
    setState({ phase: "loading", outreach: [], error: "" });
    listOutreach()
      .then((outreach) => { if (active) setState({ phase: "ready", outreach, error: "" }); })
      .catch(() => { if (active) setState({ phase: "error", outreach: [], error: "Outreach history could not be loaded." }); });
    return () => { active = false; };
  }, [requestId]);

  if (state.phase === "loading") return <section className="rounded-xl border p-6" role="status">Loading outreach history...</section>;
  if (state.phase === "error") return <section className="rounded-xl border p-6" role="alert"><p>{state.error}</p><Button className="mt-4" variant="outline" onClick={() => setRequestId((value) => value + 1)}>Retry</Button></section>;

  return (
    <div className="flex flex-col gap-5" data-testid="outreach-log-page">
      <section aria-labelledby="outreach-log-title">
        <div className="mb-3"><h2 id="outreach-log-title" className="text-lg font-semibold">Outreach log</h2><p className="text-sm text-muted-foreground">Messages copied or opened in your mail app.</p></div>
        {state.outreach.length === 0 ? <div className="rounded-xl border border-dashed p-8 text-center"><p className="font-medium">No outreach logged</p><p className="mt-1 text-sm text-muted-foreground">Outreach appears here after you copy a draft or open it in your mail app.</p></div> : (
          <div className="max-w-full overflow-x-auto rounded-xl border"><Table><TableHeader><TableRow><TableHead>Recipient</TableHead><TableHead>Subject</TableHead><TableHead>Channel</TableHead><TableHead>Date</TableHead></TableRow></TableHeader><TableBody>{state.outreach.map((entry) => <TableRow key={entry.id}><TableCell>{entry.candidateEmail || "Not on file"}</TableCell><TableCell>{entry.subject || "Not on file"}</TableCell><TableCell>{channelLabel(entry.channel)}</TableCell><TableCell>{formatDate(entry.createdAt)}</TableCell></TableRow>)}</TableBody></Table></div>
        )}
      </section>
    </div>
  );
}

export { MailPage };
