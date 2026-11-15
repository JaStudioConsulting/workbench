import { useEffect, useRef, useState } from "react";
import { CalendarDays, FileCheck2, FileText, Mail, RefreshCw, Users, Megaphone } from "lucide-react";
import { Button } from "../../components/ui/button.tsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card.tsx";
import { Label } from "../../components/ui/label.tsx";
import OperatorCaseWorkspace from "../operator-cases/OperatorCaseWorkspace.jsx";
import { openDailyCaseFromReviewAction, operatorCasesEnabled } from "../operator-cases/operatorCaseService.js";
import { listMpcCandidates, loadHomeData, waitingAgeLabel } from "./homeService.js";
import { loadMpcCaseForCandidate, openMpcCase } from "../operator-cases/mpcService.js";
import MpcIntakeForm from "../operator-cases/MpcIntakeForm.jsx";
import { calendarEnabled } from "../../featureFlags.js";

function WorkList({ title, description, icon: Icon, items, empty, onOpen, renderItem, error, onRetry }) {
  return (
    <Card className="min-w-0">
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
        {error ? <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/30 p-3" role="alert"><p className="text-sm">{error}</p><Button type="button" size="sm" variant="outline" onClick={onRetry}><RefreshCw size={14} />Retry</Button></div> : null}
        {items.length ? (
          <ul className="space-y-2">
            {items.slice(0, 8).map((item, index) => (
              <li key={item.key || item.id || `${title}-${index}`}>
                <button type="button" onClick={() => onOpen(item)} className="w-full break-words rounded-md border p-2.5 text-left text-sm outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring">
                  {renderItem(item)}
                </button>
              </li>
            ))}
          </ul>
        ) : error ? null : <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">{empty}</p>}
      </CardContent>
    </Card>
  );
}

export default function HomePage({ onNavigate = () => {}, recentMeetingsLoader }) {
  const [requestId, setRequestId] = useState(0);
  const [state, setState] = useState({ phase: "loading", data: { cases: [], waiting: [], drafts: [], errors: {} }, meetings: [], meetingsError: "" });
  const [selectedCaseId, setSelectedCaseId] = useState("");
  const [selectedWaiting, setSelectedWaiting] = useState(null);
  const [dailyLaunch, setDailyLaunch] = useState({ actionId: "", phase: "idle", error: "" });
  const [mpcState, setMpcState] = useState({ phase: "idle", candidates: [], candidate: null, error: "" });
  const [mpcSaving, setMpcSaving] = useState(false);
  const mpcLoadRequest = useRef(0);

  useEffect(() => {
    const timer = setInterval(() => setRequestId((value) => value + 1), 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    setState((current) => ({ ...current, phase: "loading" }));
    Promise.allSettled([
      loadHomeData({ includeCases: operatorCasesEnabled, force: requestId > 0 }),
      typeof recentMeetingsLoader === "function" ? recentMeetingsLoader() : Promise.resolve([]),
    ]).then(([homeResult, meetingsResult]) => {
      if (!active) return;
      const failure = homeResult.reason?.message || "Today’s recruiting work could not be loaded.";
      const data = homeResult.status === "fulfilled" ? homeResult.value : { cases: [], waiting: [], drafts: [], errors: { cases: failure, waiting: failure, drafts: failure } };
      setState({ phase: "success", data, meetings: meetingsResult.status === "fulfilled" && Array.isArray(meetingsResult.value) ? meetingsResult.value : [], meetingsError: meetingsResult.status === "rejected" ? meetingsResult.reason?.message || "Recent meetings could not be loaded." : "" });
    });
    return () => { active = false; };
  }, [requestId, recentMeetingsLoader]);

  if (state.phase === "loading") return <section className="min-h-80 rounded-lg border p-6" role="status">Loading today&apos;s work...</section>;

  const { data, meetings, meetingsError } = state;
  const retry = () => setRequestId((value) => value + 1);
  const openDailyAction = async (action) => {
    setDailyLaunch({ actionId: String(action.id), phase: "loading", error: "" });
    try {
      const savedCase = await openDailyCaseFromReviewAction(action.id);
      setSelectedWaiting(null);
      setSelectedCaseId(savedCase.record.id);
      setDailyLaunch({ actionId: "", phase: "idle", error: "" });
    } catch (error) {
      setDailyLaunch({ actionId: String(action.id), phase: "error", error: error.message || "This review item could not be opened. Try again." });
    }
  };
  const openWaitingGroup = (item) => {
    if (!operatorCasesEnabled) { onNavigate("Process", item); return; }
    setSelectedWaiting(item);
    setDailyLaunch({ actionId: "", phase: "idle", error: "" });
  };
  const beginMpc = async (force = false) => {
    setMpcState((current) => ({ ...current, phase: "loading", error: "" }));
    try {
      const candidates = await listMpcCandidates({ force });
      setMpcState({ phase: "choose", candidates, candidate: null, error: "" });
    } catch (error) {
      setMpcState((current) => ({ ...current, phase: "error", error: error.message || "Candidates could not be loaded." }));
    }
  };
  const selectMpcCandidate = async (candidate) => {
    const request = ++mpcLoadRequest.current;
    setMpcState((current) => ({ ...current, candidate, casePhase: candidate ? "loading" : "idle", savedCase: null, caseError: "" }));
    if (!candidate) return;
    try {
      const savedCase = await loadMpcCaseForCandidate(candidate.id);
      if (request === mpcLoadRequest.current) setMpcState((current) => ({ ...current, casePhase: "ready", savedCase, caseError: "" }));
    } catch (error) {
      if (request === mpcLoadRequest.current) setMpcState((current) => ({ ...current, casePhase: "error", savedCase: null, caseError: error.message || "Saved candidate marketing work could not be loaded." }));
    }
  };
  const saveMpc = async (payload) => {
    setMpcSaving(true);
    try {
      const saved = await openMpcCase(payload);
      setMpcState({ phase: "idle", candidates: [], candidate: null, error: "" });
      setSelectedCaseId(saved.record.id);
      setRequestId((value) => value + 1);
    } finally {
      setMpcSaving(false);
    }
  };
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="home-page">
      <div><span className="eyebrow">TODAY</span><h2 className="text-lg font-semibold">Recruiting workbench</h2></div>
      <div className={`grid gap-4 ${operatorCasesEnabled ? "xl:grid-cols-4" : "xl:grid-cols-3"}`}>
        {operatorCasesEnabled ? <WorkList title="Approval desk" description="Cases with source evidence and exact approvals." icon={FileCheck2} items={data.cases} empty="No approval cases are open." onOpen={(item) => setSelectedCaseId(item.id)} renderItem={(item) => <><strong>{item.title || "Untitled case"}</strong><span className="block text-xs text-muted-foreground">{({ mpc: "MPC", after_call: "After call", daily: "Recorded activity", automation: "Templates" })[item.case_type] || "Saved case"} · {item.status.replaceAll("_", " ")}</span></>} /> : null}
        <WorkList title="Waiting for Loxo" description={operatorCasesEnabled ? "Review and record exact queued changes." : "Queued changes grouped by candidate."} icon={Users} items={data.waiting} empty="No Loxo changes are waiting." onOpen={openWaitingGroup} renderItem={(item) => <><strong>{item.candidateName}</strong><span className="block text-xs text-muted-foreground">{item.count} queued action{item.count === 1 ? "" : "s"} · {waitingAgeLabel(item.oldestAt)}</span></>} />
        <WorkList title="Drafts ready" description="Saved templates and drafts ready for review." icon={FileText} items={data.drafts} empty="No drafts are ready." onOpen={(item) => setSelectedCaseId(item.case_id)} renderItem={(item) => <><strong>{String(item.kind || "Draft").replaceAll("_", " ")}</strong><span className="block text-xs text-muted-foreground">{item.title || "Saved case"}</span></>} />
        <WorkList title="Follow-ups due" description="Recorded outreach at least three business days old. Check status before following up." icon={TimerReset} items={data.followUps || []} error={data.errors?.followUps} onRetry={retry} empty="No outreach follow-ups are due." onOpen={(item) => onNavigate("Candidate Review", item)} renderItem={(item) => <><strong>{item.subject || "Outreach"}</strong><span className="block text-xs text-muted-foreground">{item.candidateEmail || "Email not on file"} · {item.replyStatus === "unknown" ? "Reply status unknown" : "No reply detected"}</span></>} />
      </div>
      {operatorCasesEnabled ? <Card><CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="flex items-center gap-2 text-base"><Megaphone size={17} />Candidate marketing</CardTitle><CardDescription>Use candidate and source details you provide. Workbench has no target-search connection and will not send outreach.</CardDescription></div>{mpcState.phase === "idle" ? <Button type="button" onClick={() => void beginMpc()}><Megaphone data-icon="inline-start" />Start a review</Button> : null}</div></CardHeader><CardContent className="grid gap-3">{mpcState.phase === "loading" ? <p role="status">Loading live candidates…</p> : null}{mpcState.phase === "error" ? <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3" role="alert"><p className="text-sm">{mpcState.error}</p><Button type="button" variant="outline" size="sm" onClick={() => void beginMpc(true)}>Retry</Button></div> : null}{mpcState.phase === "choose" ? <div className="grid gap-2 sm:max-w-lg"><Label htmlFor="mpc-candidate-choice">Candidate</Label><select id="mpc-candidate-choice" className="h-11 rounded-md border bg-background px-3 text-sm" value={mpcState.candidate?.id || ""} onChange={(event) => { const candidate = mpcState.candidates.find((item) => item.id === event.target.value); void selectMpcCandidate(candidate || null); }}><option value="">Choose a saved candidate</option>{mpcState.candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.candidate_name || "Candidate name not on file"} · {candidate.current_title || "Title not on file"}</option>)}</select>{!mpcState.candidates.length ? <p className="text-sm text-muted-foreground">No source-linked candidates are available in current Tracker data.</p> : null}<div className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={() => { mpcLoadRequest.current += 1; setMpcState({ phase: "idle", candidates: [], candidate: null, error: "" }); }}>Cancel</Button></div></div> : null}{mpcState.candidate && mpcState.casePhase === "loading" ? <p role="status">Checking saved candidate marketing work…</p> : null}{mpcState.candidate && mpcState.casePhase === "error" ? <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3" role="alert"><p className="text-sm">{mpcState.caseError}</p><Button type="button" variant="outline" size="sm" onClick={() => void selectMpcCandidate(mpcState.candidate)}>Retry</Button></div> : null}{mpcState.candidate && mpcState.casePhase === "ready" ? <MpcIntakeForm key={mpcState.candidate.id} candidate={mpcState.savedCase?.candidate || mpcState.candidate} initialData={mpcState.savedCase?.formData || null} busy={mpcSaving} onCancel={() => { mpcLoadRequest.current += 1; setMpcState({ phase: "choose", candidates: mpcState.candidates, candidate: null, error: "" }); }} onSave={saveMpc} /> : null}</CardContent></Card> : null}
      {operatorCasesEnabled && selectedWaiting ? <Card data-testid="daily-review-picker"><CardHeader><div className="flex flex-wrap items-center justify-between gap-2"><div><CardTitle className="text-base">Choose a queued change</CardTitle><CardDescription>{selectedWaiting.candidateName} · {selectedWaiting.actions.length} item{selectedWaiting.actions.length === 1 ? "" : "s"}. Each opens the saved record and its exact change.</CardDescription></div><Button type="button" size="sm" variant="outline" onClick={() => setSelectedWaiting(null)}>Close</Button></div></CardHeader><CardContent className="grid gap-2">{selectedWaiting.actions.map((action) => <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3" key={action.id}><div className="min-w-0"><p className="font-medium">{action.note || action.activity_type || action.action_type || "Queued change"}</p><p className="text-xs text-muted-foreground">{action.created_at ? new Date(action.created_at).toLocaleString() : "Date unavailable"} · {action.action_type || "Review action"}</p></div><Button type="button" size="sm" disabled={dailyLaunch.phase === "loading"} onClick={() => openDailyAction(action)}>{dailyLaunch.actionId === String(action.id) && dailyLaunch.phase === "loading" ? "Opening…" : "Review this change"}</Button></div>)}{dailyLaunch.phase === "error" ? <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/30 p-3 text-sm" role="alert"><span>{dailyLaunch.error}</span><Button type="button" variant="outline" size="sm" onClick={() => { const action = selectedWaiting.actions.find((item) => String(item.id) === dailyLaunch.actionId); if (action) void openDailyAction(action); }}>Retry</Button></div> : null}</CardContent></Card> : null}
      <div className="grid gap-4">
        {calendarEnabled ? <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><CalendarDays size={17} />Today</CardTitle></CardHeader><CardContent><UpcomingCalendar /></CardContent></Card> : null}
        <WorkList title="Recent meetings" description="Saved meeting drafts." icon={Mail} items={meetings} error={meetingsError} onRetry={retry} empty="No recent meetings are available." onOpen={(item) => onNavigate("Meetings", item)} renderItem={(item) => <><strong>{item.title || "Untitled meeting"}</strong><span className="block text-xs text-muted-foreground">{item.createdAt ? new Date(item.createdAt).toLocaleString() : "Date not on file"}</span>{item.persistence === "session_only" ? <span className="mt-1 inline-flex rounded-full border border-amber-400 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-900">Session only - not synced</span> : null}</>} />
      </div>
      <OperatorCaseWorkspace open={Boolean(selectedCaseId)} caseId={selectedCaseId} onOpenChange={(open) => { if (!open) setSelectedCaseId(""); }} onChanged={() => setRequestId((value) => value + 1)} />
    </div>
  );
}
