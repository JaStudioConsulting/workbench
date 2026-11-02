import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ExternalLink, Link2, Mic, RefreshCw, Square } from "lucide-react";
import { Badge } from "../../components/ui/badge.tsx";
import { Button } from "../../components/ui/button.tsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card.tsx";
import { Checkbox } from "../../components/ui/checkbox.tsx";
import { Input } from "../../components/ui/input.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs.tsx";
import { Textarea } from "../../components/ui/textarea.tsx";
import { getUpcomingGoogleCalendar } from "../../google-workspace-client.js";
import { startBrowserRecording } from "./browserRecorder.js";
import { createMeetingAdapter } from "./meetingAdapter.js";
import { createMeetingDraft, groupCalendarEvents, safeJoinUrl } from "./meetingModel.js";

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
        <div className="min-w-0">
          <p className="truncate font-semibold">{event.title || "Untitled meeting"}</p>
          <p className="text-sm text-muted-foreground">{eventLabel(event)}</p>
        </div>
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
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [candidateLabel, setCandidateLabel] = useState("");
  const [jobLabel, setJobLabel] = useState("");
  const [includeSharedAudio, setIncludeSharedAudio] = useState(true);
  const [recording, setRecording] = useState(null);
  const [recordedAudio, setRecordedAudio] = useState(null);
  const [transcript, setTranscript] = useState("");
  const [transcribing, setTranscribing] = useState(false);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [savedDrafts, setSavedDrafts] = useState([]);
  const objectUrlRef = useRef(null);

  const loadCalendar = useCallback(() => {
    const controller = new AbortController();
    setCalendar({ phase: "loading", events: [] });
    getUpcomingGoogleCalendar({ signal: controller.signal })
      .then((result) => setCalendar({ phase: "ready", events: result.events }))
      .catch((loadError) => {
        if (loadError?.name !== "AbortError") setCalendar({ phase: "error", events: [] });
      });
    return () => controller.abort();
  }, []);

  useEffect(() => loadCalendar(), [loadCalendar]);
  useEffect(() => () => { if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current); }, []);

  const grouped = useMemo(() => groupCalendarEvents(calendar.events), [calendar.events]);
  const beginRecording = async (event = null) => {
    setError("");
    setSelectedEvent(event);
    try {
      setRecording(await startBrowserRecording({ includeSharedAudio }));
    } catch (recordError) {
      setError(recordError.message || "Meeting recording could not start.");
    }
  };
  const finishRecording = async () => {
    try {
      const blob = await recording.stop();
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = URL.createObjectURL(blob);
      setRecordedAudio({ blob, url: objectUrlRef.current });
      setRecording(null);
      setTranscribing(true);
      try {
        const result = await adapter.transcribe(blob);
        setTranscript(result.transcript);
      } catch (transcriptionError) {
        setError(transcriptionError.message || "Recording saved, but transcription failed.");
      } finally {
        setTranscribing(false);
      }
    } catch (recordError) {
      setError(recordError.message || "Meeting recording could not stop.");
    }
  };
  const saveDraft = async () => {
    const draft = createMeetingDraft({
      event: selectedEvent,
      candidate: { label: candidateLabel },
      job: { label: jobLabel },
      transcript,
      notes,
    });
    const result = await adapter.saveDraft({ ...draft, audioBlob: recordedAudio?.blob || null });
    if (result?.ok === false) {
      setError(result.error || "Meeting draft could not be saved.");
      return;
    }
    setSavedDrafts((current) => [draft, ...current]);
    setError("");
  };

  return <div className="flex flex-col gap-4" data-testid="meetings-workspace">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-lg font-semibold">Meetings</h2><p className="text-sm text-muted-foreground">Calendar, recording, transcript, and recruiting context in one place.</p></div>
      <Badge variant="outline">Google Calendar read-only</Badge>
    </div>

    {error ? <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}

    <Card>
      <CardHeader><CardTitle>Calendar</CardTitle><CardDescription>Events come from the connected Google Calendar account.</CardDescription></CardHeader>
      <CardContent>
        {calendar.phase === "loading" ? <p className="text-sm text-muted-foreground">Loading meetings...</p> : null}
        {calendar.phase === "error" ? <Button variant="outline" onClick={loadCalendar}><RefreshCw size={14} /> Retry Calendar</Button> : null}
        {calendar.phase === "ready" ? <Tabs defaultValue="today">
          <TabsList><TabsTrigger value="today">Today</TabsTrigger><TabsTrigger value="upcoming">Upcoming</TabsTrigger><TabsTrigger value="past">Past</TabsTrigger></TabsList>
          <TabsContent value="today"><EventList events={grouped.today} onRecord={beginRecording} /></TabsContent>
          <TabsContent value="upcoming"><EventList events={grouped.upcoming} onRecord={beginRecording} /></TabsContent>
          <TabsContent value="past"><EventList events={[...grouped.past]} onRecord={beginRecording} />{savedDrafts.length ? <p className="mt-3 text-sm text-muted-foreground">{savedDrafts.length} meeting draft{savedDrafts.length === 1 ? "" : "s"} saved this session.</p> : null}</TabsContent>
        </Tabs> : null}
      </CardContent>
    </Card>

    <Card>
      <CardHeader><CardTitle>Record and attach</CardTitle><CardDescription>Link the real candidate and job before saving. Transcript and notes remain blank until supplied.</CardDescription></CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-medium">Candidate<Input value={candidateLabel} onChange={(event) => setCandidateLabel(event.target.value)} placeholder="Search or enter candidate" /></label>
            <label className="text-sm font-medium">Job<Input value={jobLabel} onChange={(event) => setJobLabel(event.target.value)} placeholder="Select or enter job" /></label>
          </div>
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={includeSharedAudio} onCheckedChange={(value) => setIncludeSharedAudio(Boolean(value))} disabled={Boolean(recording)} />Include shared call audio</label>
          <div className="flex flex-wrap gap-2">
            {!recording ? <Button onClick={() => beginRecording(selectedEvent)}><Mic size={14} /> Start recording</Button> : <Button variant="destructive" onClick={finishRecording}><Square size={14} /> Stop recording</Button>}
            {recordedAudio ? <Button variant="outline" render={<a href={recordedAudio.url} download="meeting-recording.webm" />}><Link2 size={14} /> Download recording</Button> : null}
          </div>
          {selectedEvent ? <p className="text-sm text-muted-foreground"><CalendarDays size={14} className="inline" /> Linked event: {selectedEvent.title || "Untitled meeting"}</p> : null}
        </div>
        <div className="flex flex-col gap-3">
          <label className="text-sm font-medium">Transcript<Textarea rows={7} value={transcript} onChange={(event) => setTranscript(event.target.value)} placeholder={transcribing ? "Transcribing locally..." : "Transcript appears here after local transcription."} disabled={transcribing} /></label>
          <label className="text-sm font-medium">Meeting notes<Textarea rows={4} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Decisions, follow-ups, and candidate facts." /></label>
          <Button onClick={saveDraft} disabled={transcribing || (!recordedAudio && !transcript.trim() && !notes.trim())}>{transcribing ? "Transcribing..." : "Save meeting draft"}</Button>
        </div>
      </CardContent>
    </Card>
  </div>;
}
