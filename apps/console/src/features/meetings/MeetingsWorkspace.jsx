import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, FileDown, Mic, Printer, RefreshCw } from "lucide-react";
import { Badge } from "../../components/ui/badge.tsx";
import { Button } from "../../components/ui/button.tsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger } from "../../components/ui/select.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs.tsx";
import { getUpcomingGoogleCalendar } from "../../google-workspace-client.js";
import { loadLiveCandidatesForJob, loadLiveReviewJobs } from "../candidate-review/candidateReviewService.js";
import { makeCandidateNotes } from "./afterCallClient.js";
import {
  discardRecordingArchive,
  isSecureRecordingContext,
  listInterruptedRecordings,
  meetingCaptureState,
  meetingRecordingErrorMessage,
  meetingRecordingFilename,
  recoverBrowserRecording,
  startBrowserRecording,
} from "./browserRecorder.js";
import { createMeetingAdapter } from "./meetingAdapter.js";
import { downloadMeetingMarkdown, printMeetingPdf } from "./meetingExport.js";
import { createMeetingDraft, formatSpeakerTranscript, groupCalendarEvents, safeJoinUrl } from "./meetingModel.js";
import { saveMeetingAndReleaseArchive } from "./meetingRetention.js";
import { MEETING_TEMPLATES, renderMeetingTemplate } from "./meetingTemplates.js";
import MeetingCaptureVariants from "./MeetingCaptureVariants.jsx";

const defaultAdapter = createMeetingAdapter();

function browserCaptureMetadata(recording) {
  return {
    id: recording.id,
    status: recording.captureStatus || "captured",
    source: "browser_recording",
    twoSided: Boolean(recording.twoSided),
    captureMode: recording.captureMode || "microphone",
    warning: recording.warning || null,
    jobId: String(recording.jobId || ""),
    candidateId: String(recording.candidateId || ""),
    jobTitle: recording.jobTitle || "",
    candidateName: recording.candidateName || "",
    startedAt: recording.startedAt || null,
  };
}

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

export default function MeetingsWorkspace({ adapter = defaultAdapter, launchContext = null, onLaunchChange }) {
  const launchJobId = String(launchContext?.job?.id || "");
  const launchCandidateId = String(launchContext?.candidate?.id || "");
  const [calendar, setCalendar] = useState({ phase: "loading", events: [] });
  const [recruiting, setRecruiting] = useState({ phase: "loading", jobs: [], candidates: [], error: "" });
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [selectedJobId, setSelectedJobId] = useState(launchJobId);
  const [selectedCandidateId, setSelectedCandidateId] = useState(launchCandidateId);
  const [templateId, setTemplateId] = useState("candidate_screen");
  const [recording, setRecording] = useState(null);
  const [includeSharedAudio, setIncludeSharedAudio] = useState(false);
  const [recordedAudio, setRecordedAudio] = useState(null);
  const [pendingAudio, setPendingAudio] = useState(null);
  const [recoveries, setRecoveries] = useState([]);
  const [recoveringId, setRecoveringId] = useState("");
  const [transcript, setTranscript] = useState("");
  const [segments, setSegments] = useState([]);
  const [speakers, setSpeakers] = useState([]);
  const [speakerLabels, setSpeakerLabels] = useState({});
  const [recordingMetadata, setRecordingMetadata] = useState(null);
  const [transcriptionMetadata, setTranscriptionMetadata] = useState(null);
  const [loadedMeetingId, setLoadedMeetingId] = useState(null);
  const [transcribing, setTranscribing] = useState(false);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [archiveCleanupWarning, setArchiveCleanupWarning] = useState("");
  const [makingNotes, setMakingNotes] = useState(false);

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
    listInterruptedRecordings()
      .then((items) => { if (active) setRecoveries(items); })
      .catch(() => {});
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    loadLiveReviewJobs().then((jobs) => {
      if (!active) return;
      setRecruiting({ phase: "ready", jobs, candidates: [], error: "" });
      const matchedLaunch = launchJobId && jobs.some((job) => String(job.id) === launchJobId);
      setSelectedJobId(matchedLaunch ? launchJobId : String(jobs[0]?.id || ""));
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
      const matchedLaunch = launchCandidateId && candidates.some((candidate) => String(candidate.id) === launchCandidateId);
      setSelectedCandidateId(matchedLaunch ? launchCandidateId : "");
    }).catch((loadError) => { if (active) setRecruiting((current) => ({ ...current, phase: "error", candidates: [], error: loadError.message || "Candidates could not be loaded." })); });
    return () => { active = false; };
  }, [selectedJobId]);
  useEffect(() => {
    if (launchJobId) setSelectedJobId(launchJobId);
    if (launchCandidateId) setSelectedCandidateId(launchCandidateId);
    if (launchContext?.phase === "starting") setStatus("Preparing microphone recording before placing the call...");
    if (launchContext?.phase === "error") setError(launchContext.error || "The recorded call could not start.");
    if (launchContext?.phase === "recording" && launchContext.recording) {
      setRecording((current) => current || launchContext.recording);
      setRecordingMetadata((current) => current || browserCaptureMetadata(launchContext.recording));
      setStatus(`${meetingCaptureState(launchContext.recording)} Recording ${launchContext.candidate?.name || "candidate"}. Stop recording when the call ends.`);
    }
    if (launchContext?.phase === "saved" && launchContext.meeting) {
      setTranscript(launchContext.meeting.transcript || "");
      setNotes(launchContext.meeting.notes || "");
      setSegments(launchContext.meeting.segments || []);
      setSpeakers(launchContext.meeting.speakers || []);
      setSpeakerLabels(launchContext.meeting.speakerLabels || {});
      setRecordingMetadata(launchContext.meeting.recordingId ? { id: launchContext.meeting.recordingId, status: launchContext.meeting.captureStatus, warning: launchContext.meeting.captureWarning, source: "browser_recording" } : null);
      setTranscriptionMetadata({ status: launchContext.meeting.transcriptionStatus || "ready", warning: launchContext.meeting.transcriptionWarning || null, source: launchContext.meeting.transcriptionSource || null, model: launchContext.meeting.transcriptionModel || null });
      setLoadedMeetingId(launchContext.meeting.id || null);
      if (launchContext.meeting.templateId) setTemplateId(launchContext.meeting.templateId);
      setStatus("Saved meeting loaded.");
    }
  }, [launchCandidateId, launchContext, launchJobId]);

  const grouped = useMemo(() => groupCalendarEvents(calendar.events), [calendar.events]);
  const selectedJob = recruiting.jobs.find((job) => String(job.id) === selectedJobId)
    || (launchJobId === selectedJobId ? launchContext?.job : null)
    || null;
  const selectedCandidate = recruiting.candidates.find((candidate) => String(candidate.id) === selectedCandidateId)
    || (launchCandidateId === selectedCandidateId ? launchContext?.candidate : null)
    || null;
  const template = useMemo(() => renderMeetingTemplate(templateId, transcript), [templateId, transcript]);

  const transcribeCapture = async (blob, capture) => {
    setTranscribing(true); setError("");
    try {
      const result = await adapter.transcribe(blob);
      if (!result?.transcript) throw new Error("The M1 returned no transcript.");
      const nextSpeakers = Array.isArray(result.speakers) ? result.speakers : [];
      setTranscript(result.transcript || "");
      setSegments(Array.isArray(result.segments) ? result.segments : []);
      setSpeakers(nextSpeakers);
      setSpeakerLabels(Object.fromEntries(nextSpeakers.map((speaker) => [speaker, speaker])));
      setTranscriptionMetadata({
        status: "ready",
        warning: result.warning || null,
        source: result.source || "workbench_native",
        model: result.model || null,
      });
      setPendingAudio(null);
      setStatus(result.warning || (capture.warning ? `${capture.warning} Transcript ready.` : "Recording and transcript are ready."));
      onLaunchChange?.({ phase: "ready", recording: null, captureId: capture.id });
    } catch (transcriptionError) {
      const message = transcriptionError.message || "Try again.";
      setTranscriptionMetadata({ status: "failed", warning: message, source: "workbench_native", model: null });
      setError(`Recording saved on this device, but M1 transcription failed: ${message}`);
      onLaunchChange?.({ phase: "ready", recording: null, captureId: capture.id });
    } finally {
      setTranscribing(false);
    }
  };

  const beginRecording = async (event = null) => {
    setError(""); setStatus(""); setSelectedEvent(event);
    if (!selectedJob?.id || !selectedCandidate?.id) {
      setError("Choose a real job and candidate before starting the microphone recorder.");
      return;
    }
    if (!isSecureRecordingContext()) {
      setError(meetingRecordingErrorMessage({ code: "INSECURE_CONTEXT" }));
      return;
    }
    setTranscript(""); setNotes(""); setSegments([]); setSpeakers([]); setSpeakerLabels({});
    setTranscriptionMetadata(null); setRecordedAudio(null); setPendingAudio(null); setLoadedMeetingId(null);
    setStatus("Preparing this device's microphone...");
    try {
      const activeRecording = await startBrowserRecording({
        includeSharedAudio,
        jobId: String(selectedJob.id),
        candidateId: String(selectedCandidate.id),
        jobTitle: selectedJob.title || "",
        candidateName: selectedCandidate.name || "",
        source: "meeting",
      });
      setRecording(activeRecording);
      setRecordingMetadata(browserCaptureMetadata(activeRecording));
      setStatus(meetingCaptureState(activeRecording));
      onLaunchChange?.({ phase: "recording", source: "meeting", job: selectedJob, candidate: selectedCandidate, recording: activeRecording });
    } catch (recordError) {
      setError(meetingRecordingErrorMessage(recordError));
    }
  };

  const finishRecording = async () => {
    if (!recording?.stop) return;
    setStatus("Finishing the microphone recording...");
    setTranscribing(true);
    onLaunchChange?.({ phase: "finalizing", recording });
    try {
      const blob = await recording.stop();
      const capture = browserCaptureMetadata(recording);
      if (capture.jobId !== String(selectedJob?.id) || capture.candidateId !== String(selectedCandidate?.id)) {
        throw new Error("The recording context did not match the attached job and candidate.");
      }
      setRecording(null);
      setRecordingMetadata(capture);
      setRecordedAudio({ url: URL.createObjectURL(blob), filename: meetingRecordingFilename(blob), blob });
      setPendingAudio({ blob, capture });
      setStatus("Recording saved on this device. Sending it to the M1 for transcription...");
      await transcribeCapture(blob, capture);
    } catch (recordError) {
      setRecording(null); setTranscribing(false);
      onLaunchChange?.({ phase: "error", recording: null, error: recordError.message });
      setError(recordError.message || "Meeting recording could not stop.");
    }
  };

  const retryTranscription = async () => {
    if (!pendingAudio) return;
    await transcribeCapture(pendingAudio.blob, pendingAudio.capture);
  };

  const recoverSavedRecording = async (recordingId) => {
    setRecoveringId(recordingId); setError(""); setStatus("Recovering the saved recording...");
    try {
      const { blob, meta } = await recoverBrowserRecording(recordingId);
      const capture = {
        id: meta.id,
        status: meta.status === "recording" ? "recovered" : "captured",
        source: "browser_recording",
        twoSided: Boolean(meta.twoSided),
        captureMode: meta.captureMode || "microphone",
        warning: meta.warning || (meta.status === "recording" ? "Recovered after the recording ended unexpectedly." : null),
        jobId: String(meta.jobId || ""),
        candidateId: String(meta.candidateId || ""),
        jobTitle: meta.jobTitle || "",
        candidateName: meta.candidateName || "",
        startedAt: meta.startedAt || null,
      };
      setRecordingMetadata(capture);
      setRecordedAudio({ url: URL.createObjectURL(blob), filename: meetingRecordingFilename(blob), blob });
      setPendingAudio({ blob, capture });
      if (meta.jobId) setSelectedJobId(String(meta.jobId));
      if (meta.candidateId) setSelectedCandidateId(String(meta.candidateId));
      onLaunchChange?.({ phase: "ready", source: "recovery", job: { id: meta.jobId, title: meta.jobTitle }, candidate: { id: meta.candidateId, name: meta.candidateName } });
      await transcribeCapture(blob, capture);
    } catch (recoverError) {
      setError(recoverError.message || "The saved recording could not be recovered.");
    } finally {
      setRecoveringId("");
    }
  };

  const saveDraft = async () => {
    setError(""); setStatus(""); setArchiveCleanupWarning("");
    const jobForDraft = selectedJob || launchContext?.job || (recordingMetadata?.jobId ? { id: recordingMetadata.jobId, title: recordingMetadata.jobTitle } : null);
    const candidateForDraft = selectedCandidate || launchContext?.candidate || (recordingMetadata?.candidateId ? { id: recordingMetadata.candidateId, name: recordingMetadata.candidateName } : null);
    if (!jobForDraft || !candidateForDraft) { setError("Choose a real candidate and job before saving."); return; }
    if (recordingMetadata?.jobId && String(recordingMetadata.jobId) !== String(jobForDraft.id)) { setError("The recording belongs to a different job. Recover it without changing context."); return; }
    if (recordingMetadata?.candidateId && String(recordingMetadata.candidateId) !== String(candidateForDraft.id)) { setError("The recording belongs to a different candidate. Recover it without changing context."); return; }
    if (!transcript.trim() && !notes.trim()) { setError("Add a transcript or meeting notes before saving."); return; }
    const draft = createMeetingDraft({
      event: selectedEvent,
      candidate: { id: candidateForDraft.id, label: candidateForDraft.name },
      job: { id: jobForDraft.id, label: jobForDraft.title },
      transcript,
      notes,
      recording: recordingMetadata,
      transcription: transcriptionMetadata,
      segments,
      speakers,
      speakerLabels,
      existingId: loadedMeetingId,
    });
    try {
      const result = await saveMeetingAndReleaseArchive({
        saveDraft: () => adapter.saveDraft({ draft, job: jobForDraft, candidate: candidateForDraft, templateId }),
        discardArchive: discardRecordingArchive,
        recordingId: recordingMetadata?.id,
      });
      if (result?.persistence === "durable" && result?.draft?.id) setLoadedMeetingId(result.draft.id);
      if (result?.persistence === "durable" && result?.draft?.id && !result.archiveRetained) setRecoveries((current) => current.filter((item) => item.id !== recordingMetadata?.id));
      setStatus(result.warning || (result.persistence === "durable" ? "Meeting draft saved." : "Meeting draft saved for this session."));
      setArchiveCleanupWarning(result.archiveRetained ? "Recoverable audio could not be removed from this device and remains available for recovery." : "");
    } catch (saveError) { setError(saveError.message || "Meeting draft could not be saved."); }
  };

  const createNotes = async () => {
    const jobForNotes = selectedJob || launchContext?.job;
    const candidateForNotes = selectedCandidate || launchContext?.candidate;
    if (!jobForNotes || !candidateForNotes) { setError("Choose a real candidate and job first."); return; }
    setMakingNotes(true); setError(""); setStatus("");
    try {
      await makeCandidateNotes({ job: jobForNotes, candidate: candidateForNotes, transcript, notes });
      setStatus("Candidate notes draft ready for review.");
    } catch (notesError) { setError(notesError.message || "Candidate notes could not be prepared."); }
    finally { setMakingNotes(false); }
  };

  const renameSpeaker = (speaker, nextName) => {
    const cleanName = String(nextName || "").trimStart();
    setSpeakerLabels((current) => {
      const next = { ...current, [speaker]: cleanName };
      if (segments.length) setTranscript(formatSpeakerTranscript(segments, next));
      return next;
    });
  };

  const exportTitle = selectedEvent?.title || (selectedCandidate ? `${selectedCandidate.name} meeting` : template.label);

  return <div className="flex flex-col gap-4" data-testid="meetings-workspace">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Meetings</h2><p className="text-sm text-muted-foreground">Calendar, recording, transcript, and recruiting context in one place.</p></div><Badge variant="outline">Google Calendar read-only</Badge></div>
    {error ? <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}
    <div role="status" aria-atomic="true" className={status ? "rounded-md border border-emerald-700/30 bg-emerald-50 p-3 text-sm text-emerald-950" : "sr-only"}>{status}</div>
    <div role="status" aria-atomic="true" className={archiveCleanupWarning ? "rounded-md border border-amber-700/30 bg-amber-50 p-3 text-sm text-amber-950" : "sr-only"}>{archiveCleanupWarning}</div>

    {recoveries.length ? <Card><CardHeader><CardTitle>Recovered audio on this device</CardTitle><CardDescription>These recordings were kept on this device after the recorder stopped or the tab closed. Send one to the M1 to recover its transcript.</CardDescription></CardHeader><CardContent className="grid gap-3">{recoveries.map((item) => <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3" key={item.id}><div className="min-w-0"><p className="break-words text-sm font-semibold">{item.candidateName || "Candidate"}{item.jobTitle ? ` · ${item.jobTitle}` : ""}</p><p className="text-xs text-muted-foreground">{item.startedAt ? new Date(item.startedAt).toLocaleString() : "Saved recording"} · Microphone only</p></div><Button className="h-auto min-h-9 whitespace-normal text-center" variant="outline" onClick={() => recoverSavedRecording(item.id)} disabled={Boolean(recoveringId) || Boolean(recording)}>{recoveringId === item.id ? "Recovering..." : "Recover recording"}</Button></div>)}</CardContent></Card> : null}

    <Card><CardHeader><CardTitle>Calendar</CardTitle><CardDescription>Events come from the connected Google Calendar account.</CardDescription></CardHeader><CardContent>
      {calendar.phase === "loading" ? <p className="text-sm text-muted-foreground">Loading meetings...</p> : null}
      {calendar.phase === "error" ? <Button variant="outline" onClick={loadCalendar}><RefreshCw size={14} /> Retry Calendar</Button> : null}
      {calendar.phase === "ready" ? <Tabs defaultValue="today"><TabsList><TabsTrigger value="today">Today</TabsTrigger><TabsTrigger value="upcoming">Upcoming</TabsTrigger><TabsTrigger value="past">Past</TabsTrigger></TabsList><TabsContent value="today"><EventList events={grouped.today} onRecord={beginRecording} /></TabsContent><TabsContent value="upcoming"><EventList events={grouped.upcoming} onRecord={beginRecording} /></TabsContent><TabsContent value="past"><EventList events={grouped.past} onRecord={beginRecording} /></TabsContent></Tabs> : null}
    </CardContent></Card>

    <MeetingCaptureVariants launchContext={launchContext} recruiting={recruiting} selectedJob={selectedJob} selectedJobId={selectedJobId} setSelectedJobId={setSelectedJobId} selectedCandidate={selectedCandidate} selectedCandidateId={selectedCandidateId} setSelectedCandidateId={setSelectedCandidateId} recording={recording} beginRecording={beginRecording} finishRecording={finishRecording} recordedAudio={recordedAudio} selectedEvent={selectedEvent} transcribing={transcribing} includeSharedAudio={includeSharedAudio} setIncludeSharedAudio={setIncludeSharedAudio} pendingAudio={pendingAudio} retryTranscription={retryTranscription} transcript={transcript} setTranscript={setTranscript} notes={notes} setNotes={setNotes} segments={segments} speakers={speakers} speakerLabels={speakerLabels} onSpeakerLabelChange={renameSpeaker} saveDraft={saveDraft} createNotes={createNotes} makingNotes={makingNotes} />

    <Card><CardHeader><CardTitle>Recruiter template</CardTitle><CardDescription>Sections use transcript text only. Missing topics stay marked Not discussed.</CardDescription></CardHeader><CardContent className="grid gap-4">
      <Select value={templateId} onValueChange={setTemplateId}><SelectTrigger aria-label="Select meeting template" className="w-full sm:max-w-xs"><span>{MEETING_TEMPLATES.find((item) => item.id === templateId)?.label || "Select template"}</span></SelectTrigger><SelectContent>{MEETING_TEMPLATES.map((item) => <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>)}</SelectContent></Select>
      <div className="grid gap-3 rounded-lg border bg-background p-4">{template.sections.map((section) => <section key={section.heading}><h3 className="text-sm font-semibold">{section.heading}</h3><p className="whitespace-pre-wrap text-sm text-muted-foreground">{section.content}</p></section>)}</div>
      <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => downloadMeetingMarkdown({ title: exportTitle, markdown: template.markdown })}><FileDown size={14} /> Download Markdown</Button><Button variant="outline" onClick={() => printMeetingPdf({ title: exportTitle, template })}><Printer size={14} /> Print or save PDF</Button></div>
    </CardContent></Card>
  </div>;
}
