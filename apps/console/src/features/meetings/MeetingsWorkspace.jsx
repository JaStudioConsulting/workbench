import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, FileDown, Mic, Printer, RefreshCw } from "lucide-react";
import { Button } from "../../components/ui/button.tsx";
import { Badge } from "../../components/ui/badge.tsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger } from "../../components/ui/select.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs.tsx";
import { getUpcomingGoogleCalendar } from "../../google-workspace-client.js";
import { calendarEnabled } from "../../featureFlags.js";
import { supabase } from "../../supabase-client.js";
import { loadLiveCandidatesForJob, loadLiveReviewJobs } from "../candidate-review/candidateReviewService.js";
import {
  deleteLocalMeetingDraft,
  isSecureRecordingContext,
  loadLocalMeetingDraft,
  listInterruptedRecordings,
  meetingCaptureState,
  meetingRecordingErrorMessage,
  meetingRecordingFilename,
  recoverBrowserRecording,
  saveLocalMeetingDraft,
  startBrowserRecording,
} from "./browserRecorder.js";
import { createMeetingAdapter } from "./meetingAdapter.js";
import { downloadMeetingMarkdown, printMeetingPdf } from "./meetingExport.js";
import { createMeetingDraft, formatSpeakerTranscript, groupCalendarEvents, safeJoinUrl } from "./meetingModel.js";
import { syncMeetingDraftNotes } from "./meetingNotesSync.js";
import { loadMeetingDraft } from "./meetingStore.js";
import { MEETING_TEMPLATES, renderMeetingTemplate } from "./meetingTemplates.js";
import MeetingCaptureVariants from "./MeetingCaptureVariants.jsx";

const defaultAdapter = createMeetingAdapter();
const NotesPanel = lazy(() => import("../notes/NotesPanel.jsx"));
const BoardPanel = lazy(() => import("../board/BoardPanel.jsx"));

function browserCaptureMetadata(recording) {
  return {
    id: recording.id,
    ownerId: String(recording.ownerId || ""),
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

export default function MeetingsWorkspace({ adapter = defaultAdapter, launchContext = null, selectedJob: workspaceSelectedJob = null, onLaunchChange }) {
  const launchJobId = String(launchContext?.job?.id || "");
  const launchCandidateId = String(launchContext?.candidate?.id || "");
  const savedLaunchId = launchContext?.phase === "saved" ? String(launchContext.meeting?.id || "") : "";
  const savedContextRef = useRef({ job: null, candidate: null });
  const [savedMeetingLoad, setSavedMeetingLoad] = useState({ id: "", phase: "idle", error: "" });
  const [savedMeetingReload, setSavedMeetingReload] = useState(0);
  const savedMeetingReady = !savedLaunchId || (savedMeetingLoad.id === savedLaunchId && savedMeetingLoad.phase === "ready");
  const [calendar, setCalendar] = useState({ phase: "loading", events: [] });
  const [recruiting, setRecruiting] = useState({ phase: "loading", jobs: [], candidates: [], error: "" });
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [selectedJobId, setSelectedJobId] = useState(launchJobId);
  const [selectedCandidateId, setSelectedCandidateId] = useState(launchCandidateId);
  const [templateId, setTemplateId] = useState("candidate_screen");
  const [showLinkedNotes, setShowLinkedNotes] = useState(false);
  const [showLinkedBoard, setShowLinkedBoard] = useState(false);
  const [recording, setRecording] = useState(null);
  const [includeSharedAudio, setIncludeSharedAudio] = useState(false);
  const [recordedAudio, setRecordedAudio] = useState(null);
  const [recoveryState, setRecoveryState] = useState({ phase: "loading", items: [], error: "", requestId: 0 });
  const draftSaveId = useRef(globalThis.crypto.randomUUID());
  const [draftOwnerId, setDraftOwnerId] = useState("");
  const [meetingDraftOwnerId, setMeetingDraftOwnerId] = useState("");
  const [localDraftStatus, setLocalDraftStatus] = useState("");
  const [localDraftError, setLocalDraftError] = useState("");
  const [meetingDraftDirty, setMeetingDraftDirty] = useState(false);
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
  const [notesWarning, setNotesWarning] = useState("");
  const transcriptRef = useRef(transcript);
  const notesRef = useRef(notes);
  const draftOwnerRef = useRef(draftOwnerId);
  const meetingDraftOwnerRef = useRef(meetingDraftOwnerId);
  const localDraftSnapshotRef = useRef(null);
  const workspaceJobIdRef = useRef("");
  transcriptRef.current = transcript;
  notesRef.current = notes;
  draftOwnerRef.current = draftOwnerId;
  meetingDraftOwnerRef.current = meetingDraftOwnerId;
  localDraftSnapshotRef.current = { jobId: selectedJobId, candidateId: selectedCandidateId, transcript, notes, templateId, eventTitle: selectedEvent?.title || "", dirty: meetingDraftDirty, idempotencyKey: draftSaveId.current };

  const loadCalendar = useCallback(() => {
    if (!calendarEnabled) return undefined;
    const controller = new AbortController();
    setCalendar({ phase: "loading", events: [] });
    getUpcomingGoogleCalendar({ signal: controller.signal })
      .then((result) => setCalendar({ phase: "ready", events: result.events }))
      .catch((loadError) => { if (loadError?.name !== "AbortError") setCalendar({ phase: "error", events: [] }); });
    return () => controller.abort();
  }, []);

  useEffect(() => calendarEnabled ? loadCalendar() : undefined, [loadCalendar]);
  useEffect(() => {
    const audioUrl = recordedAudio?.url;
    return () => { if (audioUrl) URL.revokeObjectURL(audioUrl); };
  }, [recordedAudio?.url]);
  useEffect(() => {
    let active = true;
    setRecoveryState((current) => ({ ...current, phase: "loading", error: "" }));
    if (!draftOwnerId) {
      setRecoveryState((current) => ({ ...current, phase: "ready", items: [], error: "" }));
      return () => { active = false; };
    }
    listInterruptedRecordings({ ownerId: draftOwnerId })
      .then((items) => { if (active) setRecoveryState((current) => ({ ...current, phase: "ready", items, error: "" })); })
      .catch((cause) => { if (active) setRecoveryState((current) => ({ ...current, phase: "error", error: cause.message || "Recordings on this device could not be checked." })); });
    return () => { active = false; };
  }, [draftOwnerId, recoveryState.requestId]);
  useEffect(() => {
    let active = true;
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      const nextOwnerId = session?.user?.id || "";
      const previousOwnerId = meetingDraftOwnerRef.current || draftOwnerRef.current;
      const snapshot = localDraftSnapshotRef.current;
      if (previousOwnerId && nextOwnerId !== previousOwnerId && snapshot?.dirty
        && (String(snapshot.transcript || "").trim() || String(snapshot.notes || "").trim())) {
        void saveLocalMeetingDraft({ ...snapshot, ownerId: previousOwnerId }).catch(() => {});
      }
      setDraftOwnerId(session?.user?.id || "");
      setRecoveryState((current) => ({ ...current, phase: "loading", items: [], error: "", requestId: current.requestId + 1 }));
    });
    supabase.auth.getUser().then(({ data, error: authError }) => {
      if (!active) return;
      if (authError) { setLocalDraftError("Workbench could not reach your workspace. Reload the page, then check unsaved meeting recovery again."); return; }
      setDraftOwnerId(data?.user?.id || "");
    }).catch(() => { if (active) setLocalDraftError("Workbench could not reach your workspace. Reload the page, then check unsaved meeting recovery again."); });
    return () => { active = false; authListener?.subscription?.unsubscribe?.(); };
  }, []);
  useEffect(() => {
    if (savedLaunchId && !savedMeetingReady) return;
    const nextJobId = String(workspaceSelectedJob?.loxoJobId || workspaceSelectedJob?.id || "");
    if (savedLaunchId && loadedMeetingId === savedLaunchId) {
      if (!selectedJobId && !selectedCandidateId && nextJobId) {
        workspaceJobIdRef.current = nextJobId;
        setSelectedJobId(nextJobId);
      }
      return;
    }
    if (!nextJobId || nextJobId === workspaceJobIdRef.current) return;
    if (meetingDraftOwnerId && meetingDraftOwnerId !== draftOwnerId) return;
    if (meetingDraftDirty || transcript.trim() || notes.trim() || recording?.active) return;
    workspaceJobIdRef.current = nextJobId;
    if (nextJobId === selectedJobId) return;
    setSelectedJobId(nextJobId);
    setSelectedCandidateId("");
    setLoadedMeetingId(null);
    setMeetingDraftOwnerId("");
    setTranscript(""); setNotes(""); setSegments([]); setSpeakers([]); setSpeakerLabels({});
  }, [workspaceSelectedJob?.loxoJobId, workspaceSelectedJob?.id, selectedJobId, selectedCandidateId, meetingDraftOwnerId, draftOwnerId, meetingDraftDirty, transcript, notes, recording, savedLaunchId, savedMeetingReady, loadedMeetingId]);
  useEffect(() => {
    if (!recording?.active) return undefined;
    const activeRecording = recording;
    return () => {
      if (activeRecording.active) void activeRecording.stop().catch(() => {});
    };
  }, [recording]);
  useEffect(() => {
    if (!localDraftStatus) return undefined;
    const warnBeforeLeaving = (event) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [localDraftStatus]);
  useEffect(() => {
    let active = true;
    loadLiveReviewJobs().then((jobs) => {
      if (!active) return;
      const savedJob = savedContextRef.current.job;
      const availableJobs = savedJob && !jobs.some((job) => String(job.id) === String(savedJob.id)) ? [...jobs, savedJob] : jobs;
      setRecruiting((current) => ({ ...current, jobs: availableJobs, error: "" }));
      setSelectedJobId((current) => current || launchJobId);
    }).catch((loadError) => { if (active) setRecruiting((current) => ({ ...current, phase: "error", error: loadError.message || "Recruiting records could not be loaded." })); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    setRecruiting((current) => ({ ...current, phase: "loading_candidates", candidates: [], error: "" }));
    const loadCandidates = selectedJobId ? loadLiveCandidatesForJob(selectedJobId) : (async () => {
      const rows = [];
      for (let offset = 0; ; offset += 1000) {
        const { data, error: loadError } = await supabase.from("candidates_all")
          .select("id,candidate_name,current_title").order("id").range(offset, offset + 999);
        if (loadError) throw new Error("Candidate records could not be loaded.");
        rows.push(...(data || []));
        if (!data || data.length < 1000) break;
      }
      return rows.map((row) => ({ id: row.id, name: row.candidate_name, title: row.current_title }));
    })();
    loadCandidates.then((candidates) => {
      if (!active) return;
      const savedContext = savedContextRef.current;
      const savedCandidate = String(savedContext.job?.id || "") === selectedJobId ? savedContext.candidate : null;
      if (savedCandidate && !candidates.some((candidate) => String(candidate.id) === String(savedCandidate.id))) candidates = [...candidates, savedCandidate];
      setRecruiting((current) => ({ ...current, phase: "ready", candidates, error: "" }));
      const matchedLaunch = launchCandidateId && candidates.some((candidate) => String(candidate.id) === launchCandidateId);
      setSelectedCandidateId((current) => candidates.some((candidate) => String(candidate.id) === current) ? current : matchedLaunch ? launchCandidateId : "");
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

  }, [draftOwnerId, launchCandidateId, launchContext, launchJobId]);

  useEffect(() => {
    if (!savedLaunchId) return undefined;
    let active = true;
    setSavedMeetingLoad({ id: savedLaunchId, phase: "loading", error: "" });
    setLoadedMeetingId(null);
    if (!draftOwnerId) return () => { active = false; };
    loadMeetingDraft(savedLaunchId).then((meeting) => {
      if (!active) return;
      savedContextRef.current = { job: meeting.job, candidate: meeting.candidate };
      setRecruiting((current) => ({
        ...current,
        jobs: meeting.job && !current.jobs.some((job) => String(job.id) === meeting.jobId) ? [...current.jobs, meeting.job] : current.jobs,
        candidates: meeting.candidate && !current.candidates.some((candidate) => String(candidate.id) === meeting.candidateId) ? [...current.candidates, meeting.candidate] : current.candidates,
      }));
      setSelectedJobId(meeting.jobId || "");
      setSelectedCandidateId(meeting.candidateId || "");
      setMeetingDraftOwnerId(meeting.ownerId || draftOwnerId);
      setTranscript(meeting.transcript || ""); setNotes(meeting.notes || "");
      setSegments(meeting.segments || []); setSpeakers(meeting.speakers || []); setSpeakerLabels(meeting.speakerLabels || {});
      setRecordingMetadata(meeting.recordingId ? { id: meeting.recordingId, ownerId: meeting.ownerId || draftOwnerId, status: meeting.captureStatus, warning: meeting.captureWarning, source: "browser_recording", jobId: meeting.jobId || "", candidateId: meeting.candidateId || "", jobTitle: meeting.job?.title || "", candidateName: meeting.candidate?.name || "" } : null);
      setTranscriptionMetadata({ status: meeting.transcriptionStatus || "disabled", warning: meeting.transcriptionWarning || null, source: meeting.transcriptionSource || null, model: meeting.transcriptionModel || null });
      setRecordedAudio(null);
      setSelectedEvent(meeting.eventTitle ? { title: meeting.eventTitle } : null);
      draftSaveId.current = meeting.id;
      setLoadedMeetingId(meeting.id);
      setMeetingDraftDirty(false); setLocalDraftStatus(""); setLocalDraftError("");
      if (meeting.templateId) setTemplateId(meeting.templateId);
      setSavedMeetingLoad({ id: savedLaunchId, phase: "ready", error: "" });
      setStatus(meeting.transcriptExpiredAt ? "Saved meeting loaded. Its transcript was previously removed under the retention rule." : "Saved meeting loaded.");
    }).catch((cause) => {
      if (active) setSavedMeetingLoad({ id: savedLaunchId, phase: "error", error: cause.message || "The saved meeting could not be loaded." });
    });
    return () => { active = false; };
  }, [savedLaunchId, draftOwnerId, savedMeetingReload]);

  const grouped = useMemo(() => groupCalendarEvents(calendar.events), [calendar.events]);
  const selectedJob = recruiting.jobs.find((job) => String(job.id) === selectedJobId)
    || (String(savedContextRef.current.job?.id || "") === selectedJobId ? savedContextRef.current.job : null)
    || (launchJobId === selectedJobId ? launchContext?.job : null)
    || null;
  const selectedCandidate = recruiting.candidates.find((candidate) => String(candidate.id) === selectedCandidateId)
    || (String(savedContextRef.current.candidate?.id || "") === selectedCandidateId ? savedContextRef.current.candidate : null)
    || (launchCandidateId === selectedCandidateId ? launchContext?.candidate : null)
    || null;
  const template = useMemo(() => {
    const rendered = renderMeetingTemplate(templateId, transcript);
    const sections = rendered.sections.map((section) => ({
      ...section,
    }));
    return { ...rendered, sections, markdown: [`# ${rendered.label}`, "", ...sections.flatMap((section) => [`## ${section.heading}`, "", section.content, ""])].join("\n").trim() };
  }, [templateId, transcript]);

  const saveDeviceDraft = async (context, text = transcriptRef.current, callNotes = notesRef.current) => {
    if (!String(text || "").trim() && !String(callNotes || "").trim()) return null;
    const ownerId = meetingDraftOwnerId || draftOwnerId;
    if (!ownerId) throw new Error("Workbench could not reach your workspace. Reload the page, then save this meeting before changing its candidate or job.");
    
    return saveLocalMeetingDraft({
      ownerId,
      jobId: context?.jobId || "",
      candidateId: context?.candidateId || "",
      transcript: text,
      notes: callNotes,
      templateId,
      eventTitle: selectedEvent?.title || "",
      idempotencyKey: draftSaveId.current,
    });
  };

  useEffect(() => {
    if (!draftOwnerId || loadedMeetingId || (savedLaunchId && !savedMeetingReady)) return undefined;
    let active = true;
    loadLocalMeetingDraft({ ownerId: draftOwnerId, jobId: selectedJobId, candidateId: selectedCandidateId })
      .then((draft) => {
        if (!active || !draft || transcriptRef.current.trim() || notesRef.current.trim()) return;
        if (draft.idempotencyKey) draftSaveId.current = draft.idempotencyKey;
        setMeetingDraftOwnerId(draft.ownerId);
        setTranscript(draft.transcript);
        setNotes(draft.notes);
        if (draft.templateId) setTemplateId(draft.templateId);
        setLocalDraftStatus("Unsaved meeting work was restored from this device. It isn’t saved to your account yet.");
        setLocalDraftError("");
      })
      .catch((cause) => { if (active) setLocalDraftError(cause.message || "The unsaved meeting draft could not be checked."); });
    return () => { active = false; };
  }, [draftOwnerId, selectedJobId, selectedCandidateId, loadedMeetingId, savedLaunchId, savedMeetingReady]);

  useEffect(() => {
    if (!meetingDraftDirty) return undefined;
    if (!transcript.trim() && !notes.trim()) return undefined;
    const ownerId = meetingDraftOwnerId || draftOwnerId;
    if (!ownerId) { setLocalDraftError("Workbench could not reach your workspace. Reload the page, then save this meeting draft on this device again."); return undefined; }
    
    const timer = setTimeout(() => {
      saveDeviceDraft({ jobId: selectedJobId, candidateId: selectedCandidateId })
        .then((saved) => { if (saved) { setLocalDraftStatus("Unsaved meeting work is saved on this device only."); setLocalDraftError(""); } })
        .catch((cause) => setLocalDraftError(cause.message || "Unsaved meeting work could not be kept on this device."));
    }, 700);
    return () => clearTimeout(timer);
  }, [draftOwnerId, meetingDraftOwnerId, selectedJobId, selectedCandidateId, transcript, notes, templateId, selectedEvent?.title, meetingDraftDirty]);

  const changeMeetingContext = async (field, value) => {
    if (meetingDraftOwnerId && meetingDraftOwnerId !== draftOwnerId) {
      setLocalDraftError("This unsaved meeting was recorded under a different workspace owner, so it can't be opened here. Its candidate or job was not changed.");
      return;
    }
    try {
      const saved = await saveDeviceDraft({ jobId: selectedJobId, candidateId: selectedCandidateId });
      if (saved) setLocalDraftStatus("Unsaved meeting work is saved on this device only.");
    } catch (cause) {
      setLocalDraftError(cause.message || "Unsaved meeting work could not be kept on this device.");
      return;
    }
    setTranscript(""); setNotes(""); setSegments([]); setSpeakers([]); setSpeakerLabels({});
    setMeetingDraftDirty(false);
    setMeetingDraftOwnerId("");
    setLoadedMeetingId(null); draftSaveId.current = globalThis.crypto.randomUUID();
    if (field === "job") setSelectedJobId(value);
    else setSelectedCandidateId(value);
  };

  const beginRecording = async (event = null) => {
    if (!savedMeetingReady) return;
    setError(""); setStatus(""); setSelectedEvent(event);
    if (meetingDraftOwnerId && meetingDraftOwnerId !== draftOwnerId) {
      setError("This unsaved meeting was recorded under a different workspace owner, so it can't be opened here. Recording was not started.");
      return;
    }
    if (!isSecureRecordingContext()) {
      setError(meetingRecordingErrorMessage({ code: "INSECURE_CONTEXT" }));
      return;
    }
    try {
      const saved = await saveDeviceDraft({ jobId: selectedJobId, candidateId: selectedCandidateId });
      if (saved) setLocalDraftStatus("Unsaved meeting work is saved on this device only.");
    } catch (draftError) {
      setLocalDraftError(draftError.message || "Unsaved meeting work could not be kept on this device.");
      return;
    }
    setTranscript(""); setNotes(""); setSegments([]); setSpeakers([]); setSpeakerLabels({});
    setMeetingDraftDirty(false);
    setMeetingDraftOwnerId(draftOwnerId);
    setTranscriptionMetadata({ status: "disabled", source: null, model: null }); setRecordedAudio(null); setLoadedMeetingId(null); draftSaveId.current = globalThis.crypto.randomUUID();
    setStatus("Preparing this device's microphone...");
    try {
      const activeRecording = await startBrowserRecording({
        includeSharedAudio,
        ownerId: draftOwnerId,
        jobId: String(selectedJob?.id || ""),
        candidateId: String(selectedCandidate?.id || ""),
        jobTitle: selectedJob?.title || "",
        candidateName: selectedCandidate?.name || "",
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
      if (capture.jobId !== String(selectedJob?.id || "") || capture.candidateId !== String(selectedCandidate?.id || "")) {
        throw new Error("The recording context did not match the attached job and candidate.");
      }
      setRecording(null);
      setRecordingMetadata(capture);
      setRecordedAudio({ url: URL.createObjectURL(blob), filename: meetingRecordingFilename(blob), blob });
      setTranscriptionMetadata({ status: "disabled", source: null, model: null });
      setStatus("Recording saved on this device. Play or download it below; add notes or paste a transcript when available.");
      setRecoveryState((current) => ({ ...current, requestId: current.requestId + 1 }));
      onLaunchChange?.({ phase: "ready", recording: null, captureId: capture.id });
    } catch (recordError) {
      setRecording(null); setTranscribing(false);
      onLaunchChange?.({ phase: "error", recording: null, error: recordError.message });
      setError(recordError.message || "Meeting recording could not stop.");
    } finally {
      setTranscribing(false);
    }
  };

  const recoverSavedRecording = async (recordingId) => {
    if (!savedMeetingReady) return;
    setRecoveringId(recordingId); setError(""); setStatus("Recovering the saved recording...");
    try {
      await saveDeviceDraft({ jobId: selectedJobId, candidateId: selectedCandidateId });
      const { blob, meta } = await recoverBrowserRecording(recordingId, { ownerId: draftOwnerId });
      const capture = {
        id: meta.id,
        ownerId: meta.ownerId,
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
      setTranscript(""); setNotes(""); setSegments([]); setSpeakers([]); setSpeakerLabels({});
      setLoadedMeetingId(null); draftSaveId.current = globalThis.crypto.randomUUID(); setMeetingDraftDirty(false);
      setRecordingMetadata(capture);
      setMeetingDraftOwnerId(meta.ownerId || draftOwnerId);
      setRecordedAudio({ url: URL.createObjectURL(blob), filename: meetingRecordingFilename(blob), blob });
      setSelectedJobId(String(meta.jobId || ""));
      setSelectedCandidateId(String(meta.candidateId || ""));
      onLaunchChange?.({ phase: "ready", source: "recovery", job: { id: meta.jobId, title: meta.jobTitle }, candidate: { id: meta.candidateId, name: meta.candidateName } });
      setTranscriptionMetadata({ status: "disabled", source: null, model: null });
      setStatus("Recording recovered. Audio remains saved on this device and is ready to play or download.");
    } catch (recoverError) {
      setError(recoverError.message || "The saved recording could not be recovered.");
    } finally {
      setRecoveringId("");
    }
  };

  const saveDraft = async () => {
    if (!savedMeetingReady) { setError("Load the saved meeting successfully before editing or saving it."); return; }
    setError(""); setStatus(""); setNotesWarning("");
    if (meetingDraftOwnerId && meetingDraftOwnerId !== draftOwnerId) { setError("This unsaved meeting was recorded under a different workspace owner, so it can't be opened here."); return; }
    const jobForDraft = selectedJob || (recordingMetadata?.jobId ? { id: recordingMetadata.jobId, title: recordingMetadata.jobTitle } : null);
    const candidateForDraft = selectedCandidate || (recordingMetadata?.candidateId ? { id: recordingMetadata.candidateId, name: recordingMetadata.candidateName } : null);
    if (recordingMetadata?.jobId && String(recordingMetadata.jobId) !== String(jobForDraft?.id || "")) { setError("The recording belongs to a different job. Recover it without changing context."); return; }
    if (recordingMetadata?.candidateId && String(recordingMetadata.candidateId) !== String(candidateForDraft?.id || "")) { setError("The recording belongs to a different candidate. Recover it without changing context."); return; }
    if (!transcript.trim() && !notes.trim() && !recordingMetadata?.id) { setError("Add a recording, transcript, or meeting notes before saving."); return; }
    const draft = createMeetingDraft({
      idempotencyKey: draftSaveId.current,
      event: selectedEvent,
      candidate: candidateForDraft ? { id: candidateForDraft.id, label: candidateForDraft.name } : null,
      job: jobForDraft ? { id: jobForDraft.id, label: jobForDraft.title } : null,
      transcript,
      notes,
      recording: recordingMetadata,
      transcription: transcriptionMetadata || { status: "disabled", source: null, model: null },
      segments,
      speakers,
      speakerLabels,
      existingId: loadedMeetingId,
    });
    try {
      // Saving text never deletes the only retained copy of a recording.
      const result = await adapter.saveDraft({ draft, job: jobForDraft, candidate: candidateForDraft, templateId });
      if (result?.ok === false) throw new Error(result.error || "Meeting draft could not be saved.");
      if (result?.persistence === "durable" && result?.draft?.id) setLoadedMeetingId(result.draft.id);
      if (result?.persistence === "durable") {
        try {
          await deleteLocalMeetingDraft({ ownerId: draftOwnerId, jobId: String(jobForDraft?.id || ""), candidateId: String(candidateForDraft?.id || "") });
          setLocalDraftStatus(""); setLocalDraftError("");
          setMeetingDraftDirty(false);
        } catch {
          setLocalDraftStatus("Meeting draft saved to your account. A device-only recovery copy remains on this device.");
        }
      }
      if (result?.persistence === "durable" && result?.draft?.id && candidateForDraft?.id) {
        const notesSync = await syncMeetingDraftNotes({
          persistence: result.persistence,
          draftId: result.draft.id,
          candidateId: candidateForDraft?.id || null,
          label: draft.event?.title || candidateForDraft?.name || "Meeting notes",
          transcript,
          notes,
        });
        setNotesWarning(notesSync.warning);
      }
      setStatus(result.warning || (result.persistence === "durable" ? "Meeting draft saved." : "Meeting draft saved for this session."));
    } catch (saveError) { setError(saveError.message || "Meeting draft could not be saved."); }
  };

  const renameSpeaker = (speaker, nextName) => {
    const cleanName = String(nextName || "").trimStart();
    setSpeakerLabels((current) => {
      const next = { ...current, [speaker]: cleanName };
      if (segments.length) setTranscript(formatSpeakerTranscript(segments, next));
      return next;
    });
  };

  if (!savedMeetingReady) return <div className="rounded-md border p-4 text-sm" role={savedMeetingLoad.phase === "error" ? "alert" : "status"}>{savedMeetingLoad.phase === "error" ? <><p>{savedMeetingLoad.error}</p><Button className="mt-2" variant="outline" onClick={() => setSavedMeetingReload((value) => value + 1)}>Retry saved meeting</Button></> : "Loading saved meeting and source links…"}</div>;

  const exportTitle = selectedEvent?.title || (selectedCandidate ? `${selectedCandidate.name} meeting` : template.label);

  return <div className="flex flex-col gap-4" data-testid="meetings-workspace">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Meetings</h2><p className="text-sm text-muted-foreground">Recordings, transcripts, notes, and recruiting context.</p></div>{calendarEnabled ? <Badge variant="outline">Google Calendar read-only</Badge> : null}</div>
    {error ? <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}
    {notesWarning ? <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{notesWarning}</div> : null}
    <div role="status" aria-atomic="true" className={status ? "rounded-md border border-emerald-700/30 bg-emerald-50 p-3 text-sm text-emerald-950" : "sr-only"}>{status}</div>
    {localDraftStatus ? <p className="rounded-md border border-amber-700/30 bg-amber-50 p-3 text-sm text-amber-950" role="status">{localDraftStatus}</p> : null}
    {localDraftError ? <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert">{localDraftError}</p> : null}

    {recoveryState.phase === "loading" ? <p role="status" className="text-sm text-muted-foreground">Checking for recordings to recover…</p> : null}
    {recoveryState.phase === "error" ? <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/30 p-3 text-sm"><span>{recoveryState.error}</span><Button type="button" size="sm" variant="outline" onClick={() => setRecoveryState((current) => ({ ...current, requestId: current.requestId + 1 }))}>Retry</Button></div> : null}
    {recoveryState.items.length ? <Card><CardHeader><CardTitle>Recovered audio on this device</CardTitle><CardDescription>These recordings were kept on this device after the recorder stopped or the tab closed. Recover one to play or download its audio.</CardDescription></CardHeader><CardContent className="grid gap-3">{recoveryState.items.map((item) => <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3" key={item.id}><div className="min-w-0"><p className="break-words text-sm font-semibold">{item.candidateName || "Candidate"}{item.jobTitle ? ` · ${item.jobTitle}` : ""}</p><p className="text-xs text-muted-foreground">{item.startedAt ? new Date(item.startedAt).toLocaleString() : "Saved recording"} · Microphone only</p></div><Button className="h-auto min-h-9 whitespace-normal text-center" variant="outline" onClick={() => recoverSavedRecording(item.id)} disabled={Boolean(recoveringId) || Boolean(recording) || !savedMeetingReady}>{recoveringId === item.id ? "Recovering…" : "Recover recording"}</Button></div>)}</CardContent></Card> : null}

    {calendarEnabled ? <Card><CardHeader><CardTitle>Calendar</CardTitle><CardDescription>Events come from the connected Google Calendar account.</CardDescription></CardHeader><CardContent>
      {calendar.phase === "loading" ? <p className="text-sm text-muted-foreground">Loading meetings...</p> : null}
      {calendar.phase === "error" ? <Button variant="outline" onClick={loadCalendar}><RefreshCw size={14} /> Retry Calendar</Button> : null}
      {calendar.phase === "ready" ? <Tabs defaultValue="today"><TabsList><TabsTrigger value="today">Today</TabsTrigger><TabsTrigger value="upcoming">Upcoming</TabsTrigger><TabsTrigger value="past">Past</TabsTrigger></TabsList><TabsContent value="today"><EventList events={grouped.today} onRecord={beginRecording} /></TabsContent><TabsContent value="upcoming"><EventList events={grouped.upcoming} onRecord={beginRecording} /></TabsContent><TabsContent value="past"><EventList events={grouped.past} onRecord={beginRecording} /></TabsContent></Tabs> : null}
    </CardContent></Card> : null}

    {meetingDraftOwnerId && meetingDraftOwnerId !== draftOwnerId ? <p className="rounded-md border border-amber-700/30 bg-amber-50 p-3 text-sm text-amber-950" role="alert">This unsaved meeting was recorded under a different workspace owner, so it can't be opened here.</p> : <MeetingCaptureVariants launchContext={launchContext} recruiting={recruiting} selectedJob={selectedJob} selectedJobId={selectedJobId} setSelectedJobId={(value) => { void changeMeetingContext("job", value); }} selectedCandidate={selectedCandidate} selectedCandidateId={selectedCandidateId} setSelectedCandidateId={(value) => { void changeMeetingContext("candidate", value); }} recording={recording} beginRecording={beginRecording} finishRecording={finishRecording} recordedAudio={recordedAudio} selectedEvent={selectedEvent} transcribing={transcribing} includeSharedAudio={includeSharedAudio} setIncludeSharedAudio={setIncludeSharedAudio} transcript={transcript} setTranscript={(value) => { setMeetingDraftOwnerId((current) => current || draftOwnerId); setMeetingDraftDirty(true); setLocalDraftStatus("Keeping this unsaved meeting draft on this device…"); setTranscript(value); }} notes={notes} setNotes={(value) => { setMeetingDraftOwnerId((current) => current || draftOwnerId); setMeetingDraftDirty(true); setLocalDraftStatus("Keeping this unsaved meeting draft on this device…"); setNotes(value); }} segments={segments} speakers={speakers} speakerLabels={speakerLabels} onSpeakerLabelChange={renameSpeaker} saveDraft={saveDraft} />}

    <section className="rounded-lg border bg-card p-4" aria-label="Meeting notes tab">
      <button type="button" aria-expanded={showLinkedNotes} onClick={() => setShowLinkedNotes((value) => !value)} className="min-h-11 rounded-md border px-3 text-sm font-semibold">Notes</button>
      <button type="button" aria-expanded={showLinkedBoard} onClick={() => setShowLinkedBoard((value) => !value)} className="ml-2 min-h-11 rounded-md border px-3 text-sm font-semibold">Board</button>
      {showLinkedNotes ? (
        loadedMeetingId ? (
          <div className="mt-3">
            <Suspense fallback={<p className="text-sm text-muted-foreground">Loading notes editor…</p>}>
              <NotesPanel subjectType="meeting" subjectId={loadedMeetingId} defaultTitle={exportTitle} />
            </Suspense>
          </div>
        ) : <p className="mt-3 text-sm text-muted-foreground">Save the meeting draft before attaching notes.</p>
      ) : null}
      {showLinkedBoard ? (
        loadedMeetingId ? (
          <div className="mt-3">
            <Suspense fallback={<p className="text-sm text-muted-foreground">Loading board editor…</p>}>
              <BoardPanel subjectType="meeting" subjectId={loadedMeetingId} defaultTitle={exportTitle} />
            </Suspense>
          </div>
        ) : <p className="mt-3 text-sm text-muted-foreground">Save the meeting draft before attaching a board.</p>
      ) : null}
    </section>

    <Card><CardHeader><CardTitle>Recruiter template</CardTitle><CardDescription>Sections show exact keyword matches from the transcript. Unmatched sections are marked No matching transcript text.</CardDescription></CardHeader><CardContent className="grid gap-4">
      <Select value={templateId} onValueChange={setTemplateId}><SelectTrigger aria-label="Select meeting template" className="w-full sm:max-w-xs"><span>{MEETING_TEMPLATES.find((item) => item.id === templateId)?.label || "Select template"}</span></SelectTrigger><SelectContent>{MEETING_TEMPLATES.map((item) => <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>)}</SelectContent></Select>
      <div className="grid gap-3 rounded-lg border bg-background p-4">{template.sections.map((section) => <section key={section.heading}><h3 className="text-sm font-semibold">{section.heading}</h3><p className="whitespace-pre-wrap text-sm text-muted-foreground">{section.content}</p></section>)}</div>
      <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => downloadMeetingMarkdown({ title: exportTitle, markdown: template.markdown })}><FileDown size={14} /> Download Markdown</Button><Button variant="outline" onClick={() => printMeetingPdf({ title: exportTitle, template })}><Printer size={14} /> Print or save PDF</Button></div>
    </CardContent></Card>
  </div>;
}
