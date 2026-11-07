import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ClipboardList, ExternalLink, FileDown, Link2, Mic, Printer, RefreshCw, Square } from "lucide-react";
import { Badge } from "../../components/ui/badge.tsx";
import { Button } from "../../components/ui/button.tsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card.tsx";
import { Checkbox } from "../../components/ui/checkbox.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs.tsx";
import { Textarea } from "../../components/ui/textarea.tsx";
import { getUpcomingGoogleCalendar } from "../../google-workspace-client.js";
import { loadLiveCandidatesForJob, loadLiveReviewJobs } from "../candidate-review/candidateReviewService.js";
import { makeCandidateNotes } from "./afterCallClient.js";
import { meetingRecordingFilename, startBrowserRecording } from "./browserRecorder.js";
import { createMeetingAdapter } from "./meetingAdapter.js";
import { downloadMeetingMarkdown, printMeetingPdf } from "./meetingExport.js";
import { createMeetingDraft, groupCalendarEvents, safeJoinUrl } from "./meetingModel.js";
import { MEETING_TEMPLATES, renderMeetingTemplate } from "./meetingTemplates.js";

const defaultAdapter = createMeetingAdapter();

function eventLabel(event) {
  if (event.start.kind === "date") return `${event.start.value} (all day)`;
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  }).format(new Date(event.start.value));
}

function EventList({ events, onRecord }) {
  if (!events.length) return <p className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">No meetings in this view.</p>;
  return <div className="grid gap-3">{events.map((event, index) => {
    const joinUrl = safeJoinUrl(event.joinUrl);
    return <Card key={`${event.start.value}-${event.title || "meeting"}-${index}`}>
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="min-w-0"><p className="truncate font-semibold">{event.title || "Untitled meeting"}</p><p className="text-sm text-muted-foreground">{eventLabel(event)}</p></div>
        <div className="flex gap-2">
          {joinUrl ? <Button variant="outline" size="sm" render={<a href={joinUrl} target="_blank" rel="noreferrer" />}><ExternalLink size={14} /> Join</Button> : null}
          {!event.allDay ? <Button size="sm" onClick={() => onRecord(event)}><Mic size={14} /> Record</Button> : null}
        </div>
      </CardContent>
    </Card>;
  })}</div>;
}

export default function MeetingsWorkspace({ adapter = defaultAdapter }) {
  const [calendar, setCalendar] = useState({ phase: "loading", events: [] });
  const [recruiting, setRecruiting] = useState({ phase: "loading", jobs: [], candidates: [], error: "" });
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [selectedJobId, setSelectedJobId] = useState("");
  const [selectedCandidateId, setSelectedCandidateId] = useState("");
  const [templateId, setTemplateId] = useState("candidate_screen");
  const [includeSharedAudio, setIncludeSharedAudio] = useState(true);
  const [recording, setRecording] = useState(null);
  const [recordedAudio, setRecordedAudio] = useState(null);
  const [transcript, setTranscript] = useState("");
  const [transcribing, setTranscribing] = useState(false);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [makingNotes, setMakingNotes] = useState(false);
  const objectUrlRef = useRef(null);

  const loadCalendar = useCallback(() => {
    const controller = new AbortController();
    setCalendar({ phase: "loading", events: [] });
    getUpcomingGoogleCalendar({ signal: controller.signal })
      .then((result) => setCalendar({ phase: "ready", events: result.events }))
      .catch((loadError) => { if (loadError?.name !== "AbortError") setCalendar({ phase: "error", events: [] }); });
    return () => controller.abort();
  }, []);

  useEffect(() => loadCalendar(), [loadCalendar]);
  useEffect(() => {
    let active = true;
    loadLiveReviewJobs().then((jobs) => {
      if (!active) return;
      setRecruiting({ phase: "ready", jobs, candidates: [], error: "" });
      setSelectedJobId(String(jobs[0]?.id || ""));
    }).catch((loadError) => { if (active) setRecruiting({ phase: "error", jobs: [], candidates: [], error: loadError.message || "Recruiting records could not be loaded." }); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!selectedJobId) return undefined;
    let active = true;
    setRecruiting((current) => ({ ...current, phase: "loading_candidates", candidates: [], error: "" }));
    loadLiveCandidatesForJob(selectedJobId).then((candidates) => {
      if (!active) return;
      setRecruiting((current) => ({ ...current, phase: "ready", candidates, error: "" }));
      setSelectedCandidateId("");
    }).catch((loadError) => { if (active) setRecruiting((current) => ({ ...current, phase: "error", candidates: [], error: loadError.message || "Candidates could not be loaded." })); });
    return () => { active = false; };
  }, [selectedJobId]);
  useEffect(() => () => { if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current); }, []);

  const grouped = useMemo(() => groupCalendarEvents(calendar.events), [calendar.events]);
  const selectedJob = recruiting.jobs.find((job) => String(job.id) === selectedJobId) || null;
  const selectedCandidate = recruiting.candidates.find((candidate) => String(candidate.id) === selectedCandidateId) || null;
  const template = useMemo(() => renderMeetingTemplate(templateId, transcript), [templateId, transcript]);

  const beginRecording = async (event = null) => {
    setError(""); setStatus(""); setSelectedEvent(event);
    try { setRecording(await startBrowserRecording({ includeSharedAudio })); }
    catch (recordError) { setError(recordError.message || "Meeting recording could not start."); }
  };

  const finishRecording = async () => {
    try {
      const blob = await recording.stop();
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = URL.createObjectURL(blob);
      setRecordedAudio({ blob, url: objectUrlRef.current, filename: meetingRecordingFilename(blob) });
      setRecording(null); setTranscribing(true);
      try {
        const result = await adapter.transcribe(blob);
        setTranscript(result.transcript);
        if (result.warning) setStatus(result.warning);
      } catch (transcriptionError) { setError(transcriptionError.message || "Recording saved, but transcription failed."); }
      finally { setTranscribing(false); }
    } catch (recordError) { setRecording(null); setError(recordError.message || "Meeting recording could not stop."); }
  };

  const saveDraft = async () => {
    setError(""); setStatus("");
    if (!selectedJob || !selectedCandidate) { setError("Choose a real candidate and job before saving."); return; }
    const draft = createMeetingDraft({
      event: selectedEvent,
      candidate: { id: selectedCandidate.id, label: selectedCandidate.name },
      job: { id: selectedJob.id, label: selectedJob.title },
      transcript,
      notes,
    });
    try {
      const result = await adapter.saveDraft({ draft, job: selectedJob, candidate: selectedCandidate, templateId });
      if (result?.ok === false) throw new Error(result.error || "Meeting draft could not be saved.");
      setStatus(result.warning || (result.persistence === "durable" ? "Meeting draft saved." : "Meeting draft saved for this session."));
    } catch (saveError) { setError(saveError.message || "Meeting draft could not be saved."); }
  };

  const createNotes = async () => {
    if (!selectedJob || !selectedCandidate) { setError("Choose a real candidate and job first."); return; }
    setMakingNotes(true); setError(""); setStatus("");
    try {
      await makeCandidateNotes({ job: selectedJob, candidate: selectedCandidate, transcript, notes });
      setStatus("Candidate notes draft ready for review.");
    } catch (notesError) { setError(notesError.message || "Candidate notes could not be prepared."); }
    finally { setMakingNotes(false); }
  };

  const exportTitle = selectedEvent?.title || (selectedCandidate ? `${selectedCandidate.name} meeting` : template.label);

  return <div className="flex flex-col gap-4" data-testid="meetings-workspace">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Meetings</h2><p className="text-sm text-muted-foreground">Calendar, recording, transcript, and recruiting context in one place.</p></div><Badge variant="outline">Google Calendar read-only</Badge></div>
    {error ? <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}
    {status ? <div role="status" className="rounded-md border border-emerald-700/30 bg-emerald-50 p-3 text-sm text-emerald-950">{status}</div> : null}

    <Card><CardHeader><CardTitle>Calendar</CardTitle><CardDescription>Events come from the connected Google Calendar account.</CardDescription></CardHeader><CardContent>
      {calendar.phase === "loading" ? <p className="text-sm text-muted-foreground">Loading meetings...</p> : null}
      {calendar.phase === "error" ? <Button variant="outline" onClick={loadCalendar}><RefreshCw size={14} /> Retry Calendar</Button> : null}
      {calendar.phase === "ready" ? <Tabs defaultValue="today"><TabsList><TabsTrigger value="today">Today</TabsTrigger><TabsTrigger value="upcoming">Upcoming</TabsTrigger><TabsTrigger value="past">Past</TabsTrigger></TabsList><TabsContent value="today"><EventList events={grouped.today} onRecord={beginRecording} /></TabsContent><TabsContent value="upcoming"><EventList events={grouped.upcoming} onRecord={beginRecording} /></TabsContent><TabsContent value="past"><EventList events={grouped.past} onRecord={beginRecording} /></TabsContent></Tabs> : null}
    </CardContent></Card>

    <Card><CardHeader><CardTitle>Record and attach</CardTitle><CardDescription>Choose the live candidate and job before saving or making notes.</CardDescription></CardHeader><CardContent className="grid gap-4 lg:grid-cols-2">
      <div className="flex flex-col gap-3">
        {recruiting.phase === "loading" ? <p className="text-sm text-muted-foreground">Loading recruiting records...</p> : null}
        {recruiting.error ? <p role="alert" className="text-sm text-destructive">{recruiting.error}</p> : null}
        {recruiting.phase === "ready" && !recruiting.jobs.length ? <p className="text-sm text-muted-foreground">No active Tracker jobs are available.</p> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium">Job<Select value={selectedJobId} onValueChange={(value) => setSelectedJobId(String(value))}><SelectTrigger aria-label="Select meeting job"><SelectValue placeholder="Select job" /></SelectTrigger><SelectContent>{recruiting.jobs.map((job) => <SelectItem key={job.id} value={String(job.id)}>{job.title} · {job.company}</SelectItem>)}</SelectContent></Select></label>
          <label className="text-sm font-medium">Candidate<Select value={selectedCandidateId} onValueChange={(value) => setSelectedCandidateId(String(value))} disabled={!selectedJobId || recruiting.phase === "loading_candidates"}><SelectTrigger aria-label="Select meeting candidate"><SelectValue placeholder={recruiting.phase === "loading_candidates" ? "Loading candidates" : "Select candidate"} /></SelectTrigger><SelectContent>{recruiting.candidates.map((candidate) => <SelectItem key={candidate.id} value={String(candidate.id)}>{candidate.name} · {candidate.title}</SelectItem>)}</SelectContent></Select></label>
        </div>
        <label className="flex items-center gap-2 text-sm"><Checkbox checked={includeSharedAudio} onCheckedChange={(value) => setIncludeSharedAudio(Boolean(value))} disabled={Boolean(recording)} />Include shared call audio</label>
        <div className="flex flex-wrap gap-2">{!recording ? <Button onClick={() => beginRecording(selectedEvent)}><Mic size={14} /> Start recording</Button> : <Button variant="destructive" onClick={finishRecording}><Square size={14} /> Stop recording</Button>}{recordedAudio ? <Button variant="outline" render={<a href={recordedAudio.url} download={recordedAudio.filename} />}><Link2 size={14} /> Download recording</Button> : null}</div>
        {selectedEvent ? <p className="text-sm text-muted-foreground"><CalendarDays size={14} className="inline" /> Linked event: {selectedEvent.title || "Untitled meeting"}</p> : null}
      </div>
      <div className="flex flex-col gap-3">
        <label className="text-sm font-medium">Transcript<Textarea rows={7} value={transcript} onChange={(event) => setTranscript(event.target.value)} placeholder={transcribing ? "Transcribing locally..." : "Transcript appears here after local transcription."} disabled={transcribing} /></label>
        <label className="text-sm font-medium">Meeting notes<Textarea rows={4} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Decisions, follow-ups, and candidate facts." /></label>
        <div className="flex flex-wrap gap-2"><Button onClick={saveDraft} disabled={transcribing || (!transcript.trim() && !notes.trim())}>{transcribing ? "Transcribing..." : "Save meeting draft"}</Button><Button variant="outline" onClick={createNotes} disabled={makingNotes || !transcript.trim()}><ClipboardList size={14} /> {makingNotes ? "Preparing..." : "Make candidate notes"}</Button></div>
      </div>
    </CardContent></Card>

    <Card><CardHeader><CardTitle>Recruiter template</CardTitle><CardDescription>Sections use transcript text only. Missing topics stay marked Not discussed.</CardDescription></CardHeader><CardContent className="grid gap-4">
      <Select value={templateId} onValueChange={setTemplateId}><SelectTrigger aria-label="Select meeting template" className="w-full sm:max-w-xs"><SelectValue /></SelectTrigger><SelectContent>{MEETING_TEMPLATES.map((item) => <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>)}</SelectContent></Select>
      <div className="grid gap-3 rounded-lg border bg-background p-4">{template.sections.map((section) => <section key={section.heading}><h3 className="text-sm font-semibold">{section.heading}</h3><p className="whitespace-pre-wrap text-sm text-muted-foreground">{section.content}</p></section>)}</div>
      <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => downloadMeetingMarkdown({ title: exportTitle, markdown: template.markdown })}><FileDown size={14} /> Download Markdown</Button><Button variant="outline" onClick={() => printMeetingPdf({ title: exportTitle, template })}><Printer size={14} /> Print or save PDF</Button></div>
    </CardContent></Card>
  </div>;
}
