import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, FileDown, Mic, Printer, RefreshCw } from "lucide-react";
import { Badge } from "../../components/ui/badge.tsx";
import { Button } from "../../components/ui/button.tsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger } from "../../components/ui/select.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs.tsx";
import { getUpcomingGoogleCalendar } from "../../google-workspace-client.js";
import { supabase } from "../../supabase-client.js";
import { loadLiveCandidatesForJob, loadLiveReviewJobs } from "../candidate-review/candidateReviewService.js";
import { makeCandidateNotes, persistAfterCallCase, persistLegacyAfterCallNote } from "./afterCallClient.js";
import {
  discardRecordingArchive,
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
import { downloadMeetingMarkdown, downloadWorkflowResumePdf, printMeetingPdf } from "./meetingExport.js";
import { createMeetingDraft, formatSpeakerTranscript, groupCalendarEvents, safeJoinUrl } from "./meetingModel.js";
import { syncMeetingDraftNotes } from "./meetingNotesSync.js";
import { saveMeetingAndReleaseArchive } from "./meetingRetention.js";
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

const afterCallSourceLabels = { candidate_record: "candidate record", resume: "resume", transcript: "call transcript", call_notes: "call notes", job_description: "job description" };
const submissionLabels = { name: "Name", title: "Title", compensationTarget: "Compensation target", currentCompensation: "Current compensation", vacation: "Vacation", location: "Location", workStatus: "Work status", interviewAvailability: "Interview availability", startDate: "Start date / notice period", reasonForLeaving: "Reason for leaving", profileSummary: "Profile summary" };

function AfterCallDraftReview({ result, onRetrySave, busy = false }) {
  const workflow = result.workflow;
  const fields = workflow.submission?.fields || {};
  const fieldLines = Object.entries(fields).flatMap(([key, field]) => {
    const label = submissionLabels[key] || key;
    if (Array.isArray(field)) return field.map((claim) => [label, claim?.text].filter(Boolean).join(": "));
    return field?.value ? [`${label}: ${field.value}`] : [];
  });
  if (workflow.submission?.client?.value) fieldLines.unshift(`Client: ${workflow.submission.client.value}`);
  const pdf = workflow.brandedResume?.pdf;
  return <Card data-testid="after-call-draft-review"><CardHeader><CardTitle className="text-base">After-call draft review</CardTitle><CardDescription>Drafts are for recruiter review. Check each claim against the source material.</CardDescription></CardHeader><CardContent className="grid gap-4">
    {workflow.audit?.finalizationBlocked ? <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm" role="alert">Unresolved source differences block finalization. Review the differences below before proceeding.</p> : null}
    {workflow.audit?.identityReviewRequired ? <p className="rounded-md border border-amber-700/30 bg-amber-50 p-3 text-sm text-amber-950" role="alert">Candidate identity needs review. These drafts remain available, but approval is blocked until the selected candidate record is confirmed.</p> : null}
    {workflow.audit?.missingSources?.length ? <div className="rounded-md border p-3 text-sm"><p className="font-medium">Sources not provided</p><ul className="mt-1 list-disc pl-5 text-muted-foreground">{workflow.audit.missingSources.map((source) => <li key={source}>{afterCallSourceLabels[source] || source}</li>)}</ul></div> : null}
    {workflow.audit?.conflicts?.length ? <div className="rounded-md border p-3 text-sm"><p className="font-medium">Source differences to review</p><ul className="mt-1 list-disc pl-5">{workflow.audit.conflicts.map((conflict, index) => <li key={`${conflict.field}:${index}`}>{conflict.description || `${conflict.field}: ${conflict.evidence?.map((item) => `“${item.quote}” (${afterCallSourceLabels[item.source] || item.source})`).join(" versus ")}`}</li>)}</ul></div> : null}
    {workflow.audit?.supportedClaims?.length ? <details className="rounded-md border p-3 text-sm"><summary className="cursor-pointer font-medium">Check claims against source quotes ({workflow.audit.supportedClaims.length})</summary><ul className="mt-3 grid gap-3">{workflow.audit.supportedClaims.map((claim, index) => <li key={`${index}:${claim.text}`}><p>{claim.text}</p><ul className="mt-1 list-disc pl-5 text-muted-foreground">{claim.evidence?.map((item, evidenceIndex) => <li key={`${item.source}:${evidenceIndex}`}>“{item.quote}” · {afterCallSourceLabels[item.source] || item.source}</li>)}</ul></li>)}</ul></details> : null}
    <section className="grid gap-2" aria-labelledby="after-call-resume-title"><h3 id="after-call-resume-title" className="font-semibold">Branded resume draft</h3><pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/20 p-3 text-sm">{workflow.brandedResume.content}</pre>{pdf ? <div className="grid justify-items-start gap-1"><Button type="button" variant="outline" onClick={() => downloadWorkflowResumePdf(pdf)}>Download resume PDF</Button><p className="text-xs text-muted-foreground">Draft for recruiter review. This file is not an email attachment.</p></div> : <p className="text-sm text-muted-foreground">A PDF isn’t ready to download.</p>}</section>
    <section className="grid gap-2" aria-labelledby="after-call-submission-title"><h3 id="after-call-submission-title" className="font-semibold">Candidate submission draft</h3><ul className="grid gap-1 text-sm">{fieldLines.map((line, index) => <li key={`${index}:${line}`}>{line}</li>)}</ul></section>
    <section className="grid gap-2" aria-labelledby="after-call-email-title"><h3 id="after-call-email-title" className="font-semibold">Presentation email draft</h3><p className="text-sm font-medium">{workflow.presentationEmail.subject}</p><pre className="whitespace-pre-wrap rounded-md border bg-muted/20 p-3 text-sm">{workflow.presentationEmail.body}</pre><p className="text-xs text-muted-foreground">{workflow.presentationEmail.attachmentStatus === "generated" ? "An attachment was generated." : "No attachment was generated."}</p></section>
    <section className="grid gap-2" aria-labelledby="after-call-loxo-title"><h3 id="after-call-loxo-title" className="font-semibold">Loxo update notes</h3><ul className="list-disc pl-5 text-sm">{workflow.loxoDraft.bullets.map((bullet, index) => <li key={`${index}:${bullet?.text || bullet}`}>{bullet?.text || bullet}</li>)}</ul><p className="text-xs text-muted-foreground">Copy and review these notes before you enter them in Loxo.</p></section>
    {result.caseSaveError || result.draftSaveError ? <div className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm" role="alert"><span>{result.caseSaveError || result.draftSaveError}</span><Button type="button" variant="outline" size="sm" disabled={busy} onClick={onRetrySave}>{busy ? "Saving…" : "Retry save"}</Button></div> : result.approvalCase ? <p className={`rounded-md border p-3 text-sm ${result.blocked ? "border-amber-700/30 bg-amber-50 text-amber-950" : "border-success/40 bg-success/5"}`} role="status">All four drafts are saved in approval history. {result.blocked ? "Review is blocked until the missing source or identity checks are resolved." : "Review them there before any separate action."}</p> : result.draft ? <p className="rounded-md border border-success/40 bg-success/5 p-3 text-sm" role="status">Candidate notes were saved to Candidate Review. The resume, submission, and email remain available only in this preview.</p> : null}
  </CardContent></Card>;
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
  const [showLinkedNotes, setShowLinkedNotes] = useState(false);
  const [showLinkedBoard, setShowLinkedBoard] = useState(false);
  const [recording, setRecording] = useState(null);
  const [includeSharedAudio, setIncludeSharedAudio] = useState(false);
  const [recordedAudio, setRecordedAudio] = useState(null);
  const [pendingAudio, setPendingAudio] = useState(null);
  const [recoveryState, setRecoveryState] = useState({ phase: "loading", items: [], error: "", requestId: 0 });
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
  const [archiveCleanupWarning, setArchiveCleanupWarning] = useState("");
  const [notesWarning, setNotesWarning] = useState("");
  const [makingNotes, setMakingNotes] = useState(false);
  const [afterCallResult, setAfterCallResult] = useState(null);
  const transcriptRef = useRef(transcript);
  const notesRef = useRef(notes);
  const draftOwnerRef = useRef(draftOwnerId);
  const meetingDraftOwnerRef = useRef(meetingDraftOwnerId);
  const localDraftSnapshotRef = useRef(null);
  transcriptRef.current = transcript;
  notesRef.current = notes;
  draftOwnerRef.current = draftOwnerId;
  meetingDraftOwnerRef.current = meetingDraftOwnerId;
  localDraftSnapshotRef.current = { jobId: selectedJobId, candidateId: selectedCandidateId, transcript, notes, templateId, eventTitle: selectedEvent?.title || "", dirty: meetingDraftDirty };

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
        && (String(snapshot.transcript || "").trim() || String(snapshot.notes || "").trim())
        && snapshot.jobId && snapshot.candidateId) {
        void saveLocalMeetingDraft({ ...snapshot, ownerId: previousOwnerId }).catch(() => {});
      }
      setDraftOwnerId(session?.user?.id || "");
      setRecoveryState((current) => ({ ...current, phase: "loading", items: [], error: "", requestId: current.requestId + 1 }));
    });
    supabase.auth.getUser().then(({ data, error: authError }) => {
      if (!active) return;
      if (authError) { setLocalDraftError("Sign-in status could not be checked. Unsaved meeting recovery is unavailable until you retry."); return; }
      setDraftOwnerId(data?.user?.id || "");
    }).catch(() => { if (active) setLocalDraftError("Sign-in status could not be checked. Unsaved meeting recovery is unavailable until you retry."); });
    return () => { active = false; authListener?.subscription?.unsubscribe?.(); };
  }, []);
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
      if (draftOwnerId) setMeetingDraftOwnerId((current) => current || draftOwnerId);
      setTranscript(launchContext.meeting.transcript || "");
      setNotes(launchContext.meeting.notes || "");
      setMeetingDraftDirty(false);
      setSegments(launchContext.meeting.segments || []);
      setSpeakers(launchContext.meeting.speakers || []);
      setSpeakerLabels(launchContext.meeting.speakerLabels || {});
      setRecordingMetadata(launchContext.meeting.recordingId ? { id: launchContext.meeting.recordingId, status: launchContext.meeting.captureStatus, warning: launchContext.meeting.captureWarning, source: "browser_recording" } : null);
      setTranscriptionMetadata({ status: launchContext.meeting.transcriptionStatus || "ready", warning: launchContext.meeting.transcriptionWarning || null, source: launchContext.meeting.transcriptionSource || null, model: launchContext.meeting.transcriptionModel || null });
      setLoadedMeetingId(launchContext.meeting.id || null);
      if (launchContext.meeting.templateId) setTemplateId(launchContext.meeting.templateId);
      setStatus(launchContext.meeting.transcriptExpiredAt
        ? "Saved meeting loaded. Its transcript was removed under the one-year retention rule."
        : "Saved meeting loaded.");
    }
  }, [draftOwnerId, launchCandidateId, launchContext, launchJobId]);

  const grouped = useMemo(() => groupCalendarEvents(calendar.events), [calendar.events]);
  const selectedJob = recruiting.jobs.find((job) => String(job.id) === selectedJobId)
    || (launchJobId === selectedJobId ? launchContext?.job : null)
    || null;
  const selectedCandidate = recruiting.candidates.find((candidate) => String(candidate.id) === selectedCandidateId)
    || (launchCandidateId === selectedCandidateId ? launchContext?.candidate : null)
    || null;
  const template = useMemo(() => renderMeetingTemplate(templateId, transcript), [templateId, transcript]);

  const saveDeviceDraft = async (context, text = transcriptRef.current, callNotes = notesRef.current) => {
    if (!String(text || "").trim() && !String(callNotes || "").trim()) return null;
    const ownerId = meetingDraftOwnerId || draftOwnerId;
    if (!ownerId) throw new Error("Sign-in status is unavailable. Save this meeting before changing its candidate or job.");
    if (!context?.jobId || !context?.candidateId) throw new Error("Choose a candidate and job before keeping an unsaved meeting draft.");
    return saveLocalMeetingDraft({
      ownerId,
      jobId: context.jobId,
      candidateId: context.candidateId,
      transcript: text,
      notes: callNotes,
      templateId,
      eventTitle: selectedEvent?.title || "",
    });
  };

  useEffect(() => {
    if (!draftOwnerId || !selectedJobId || !selectedCandidateId || loadedMeetingId) return undefined;
    let active = true;
    loadLocalMeetingDraft({ ownerId: draftOwnerId, jobId: selectedJobId, candidateId: selectedCandidateId })
      .then((draft) => {
        if (!active || !draft || transcriptRef.current.trim() || notesRef.current.trim()) return;
        setMeetingDraftOwnerId(draft.ownerId);
        setTranscript(draft.transcript);
        setNotes(draft.notes);
        if (draft.templateId) setTemplateId(draft.templateId);
        setLocalDraftStatus("Unsaved meeting work was restored from this device. It isn’t saved to your account yet.");
        setLocalDraftError("");
      })
      .catch((cause) => { if (active) setLocalDraftError(cause.message || "The unsaved meeting draft could not be checked."); });
    return () => { active = false; };
  }, [draftOwnerId, selectedJobId, selectedCandidateId, loadedMeetingId]);

  useEffect(() => {
    if (!meetingDraftDirty) return undefined;
    if (!transcript.trim() && !notes.trim()) return undefined;
    const ownerId = meetingDraftOwnerId || draftOwnerId;
    if (!ownerId) { setLocalDraftError("Sign-in status is unavailable. Unsaved text is not being saved on this device."); return undefined; }
    if (!selectedJobId || !selectedCandidateId) { setLocalDraftError("Choose a candidate and job before keeping this unsaved meeting draft."); return undefined; }
    const timer = setTimeout(() => {
      saveDeviceDraft({ jobId: selectedJobId, candidateId: selectedCandidateId })
        .then((saved) => { if (saved) { setLocalDraftStatus("Unsaved meeting work is saved on this device only."); setLocalDraftError(""); } })
        .catch((cause) => setLocalDraftError(cause.message || "Unsaved meeting work could not be kept on this device."));
    }, 700);
    return () => clearTimeout(timer);
  }, [draftOwnerId, meetingDraftOwnerId, selectedJobId, selectedCandidateId, transcript, notes, templateId, selectedEvent?.title, meetingDraftDirty]);

  const changeMeetingContext = async (field, value) => {
    if (meetingDraftOwnerId && meetingDraftOwnerId !== draftOwnerId) {
      setLocalDraftError("Sign in to the account that owns this unsaved meeting before changing its candidate or job.");
      return;
    }
    try {
      const saved = await saveDeviceDraft({ jobId: selectedJobId, candidateId: selectedCandidateId });
      if (saved) setLocalDraftStatus("Unsaved meeting work is saved on this device only.");
    } catch (cause) {
      setLocalDraftError(cause.message || "Unsaved meeting work could not be kept on this device.");
      return;
    }
    setTranscript(""); setNotes(""); setSegments([]); setSpeakers([]); setSpeakerLabels({}); setAfterCallResult(null);
    setMeetingDraftDirty(false);
    setMeetingDraftOwnerId("");
    setLoadedMeetingId(null);
    if (field === "job") setSelectedJobId(value);
    else setSelectedCandidateId(value);
  };

  const transcribeCapture = async (blob, capture) => {
    setTranscribing(true); setError("");
    try {
      const result = await adapter.transcribe(blob);
      if (!result?.transcript) throw new Error("The M1 returned no transcript.");
      const nextSpeakers = Array.isArray(result.speakers) ? result.speakers : [];
      setTranscript(result.transcript || "");
      setSegments(Array.isArray(result.segments) ? result.segments : []);
      setSpeakers(nextSpeakers);
      setMeetingDraftOwnerId(capture.ownerId || draftOwnerId);
      setMeetingDraftDirty(true);
      setLocalDraftStatus("Keeping this unsaved meeting draft on this device…");
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
    if (meetingDraftOwnerId && meetingDraftOwnerId !== draftOwnerId) {
      setError("Sign in to the account that owns this unsaved meeting before starting another recording.");
      return;
    }
    if (!selectedJob?.id || !selectedCandidate?.id) {
      setError("Choose a real job and candidate before starting the microphone recorder.");
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
    setTranscriptionMetadata(null); setRecordedAudio(null); setPendingAudio(null); setLoadedMeetingId(null);
    setStatus("Preparing this device's microphone...");
    try {
      const activeRecording = await startBrowserRecording({
        includeSharedAudio,
        ownerId: draftOwnerId,
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
      setRecordingMetadata(capture);
      setMeetingDraftOwnerId(meta.ownerId || draftOwnerId);
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
    setError(""); setStatus(""); setArchiveCleanupWarning(""); setNotesWarning("");
    if (meetingDraftOwnerId && meetingDraftOwnerId !== draftOwnerId) { setError("This unsaved meeting belongs to the previous signed-in account. Sign in to that account to save or continue it."); return; }
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
        discardArchive: (recordingId) => discardRecordingArchive(recordingId, { ownerId: draftOwnerId }),
        recordingId: recordingMetadata?.id,
      });
      if (result?.persistence === "durable" && result?.draft?.id) setLoadedMeetingId(result.draft.id);
      if (result?.persistence === "durable") {
        try {
          await deleteLocalMeetingDraft({ ownerId: draftOwnerId, jobId: String(jobForDraft.id), candidateId: String(candidateForDraft.id) });
          setLocalDraftStatus(""); setLocalDraftError("");
          setMeetingDraftDirty(false);
        } catch {
          setLocalDraftStatus("Meeting draft saved to your account. A device-only recovery copy remains on this device.");
        }
      }
      if (result?.persistence === "durable" && result?.draft?.id && result.draft.transcript?.trim() && !result.archiveRetained) {
        setRecoveryState((current) => ({ ...current, items: current.items.filter((item) => item.id !== recordingMetadata?.id) }));
        if (recordedAudio?.url) URL.revokeObjectURL(recordedAudio.url);
        setRecordedAudio(null);
        setPendingAudio(null);
      }
      if (result?.persistence === "durable" && result?.draft?.id) {
        const notesSync = await syncMeetingDraftNotes({
          persistence: result.persistence,
          draftId: result.draft.id,
          candidateId: candidateForDraft.id,
          label: draft.event?.title || candidateForDraft.name,
          transcript,
          notes,
        });
        setNotesWarning(notesSync.warning);
      }
      setStatus(result.warning || (result.persistence === "durable" ? "Meeting draft saved." : "Meeting draft saved for this session."));
      setArchiveCleanupWarning(result.archiveRetained ? "Recoverable audio could not be removed from this device and remains available for recovery." : "");
    } catch (saveError) { setError(saveError.message || "Meeting draft could not be saved."); }
  };

  const createNotes = async () => {
    if (meetingDraftOwnerId && meetingDraftOwnerId !== draftOwnerId) { setError("This unsaved meeting belongs to the previous signed-in account. Sign in to that account to prepare its drafts."); return; }
    const jobForNotes = selectedJob || launchContext?.job;
    const candidateForNotes = selectedCandidate || launchContext?.candidate;
    if (!jobForNotes || !candidateForNotes) { setError("Choose a real candidate and job first."); return; }
    setMakingNotes(true); setError(""); setStatus(""); setAfterCallResult(null);
    try {
      const result = await makeCandidateNotes({ job: jobForNotes, candidate: candidateForNotes, transcript, notes, meetingId: loadedMeetingId });
      setMeetingDraftOwnerId(draftOwnerId);
      setAfterCallResult({ ...result, source: { job: jobForNotes, candidate: candidateForNotes, transcript, notes, meetingId: loadedMeetingId } });
      const caseStatus = result.approvalCase?.record?.status;
      if (!result.caseSaveError && !result.draftSaveError) setStatus(result.approvalCase
        ? caseStatus === "ready_for_review" ? "After-call drafts were saved to approval history." : "After-call drafts were saved, but required source evidence needs review."
        : result.draft ? "Candidate notes were saved. Other drafts are available in this preview only." : "After-call drafts are ready for review.");
    } catch (notesError) { setError(notesError.message || "Candidate notes could not be prepared."); }
    finally { setMakingNotes(false); }
  };

  const retryAfterCallSave = async () => {
    const pending = afterCallResult;
    if (!pending?.workflow || !pending.source) return;
    if (meetingDraftOwnerId && meetingDraftOwnerId !== draftOwnerId) { setError("This unsaved meeting belongs to the previous signed-in account. Sign in to that account to save its drafts."); return; }
    setMakingNotes(true); setError("");
    try {
      if (pending.approvalCase || pending.caseSaveError) {
        const approvalCase = await persistAfterCallCase({ ...pending.source, workflow: pending.workflow });
        setAfterCallResult({ ...pending, approvalCase, caseSaveError: "", blocked: approvalCase?.record?.status === "blocked" || Boolean(pending.workflow.audit?.finalizationBlocked) });
        setStatus(approvalCase?.record?.status === "ready_for_review" ? "After-call drafts were saved to approval history." : "After-call drafts were saved, but required source evidence needs review.");
      } else {
        const draft = await persistLegacyAfterCallNote({ ...pending.source, workflow: pending.workflow });
        setAfterCallResult({ ...pending, draft, draftSaveError: "" });
        setStatus("Candidate notes were saved. Other drafts are available in this preview only.");
      }
    } catch (saveError) { setError(saveError.message || "The drafts could not be saved. Try again."); }
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
    {notesWarning ? <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{notesWarning}</div> : null}
    <div role="status" aria-atomic="true" className={status ? "rounded-md border border-emerald-700/30 bg-emerald-50 p-3 text-sm text-emerald-950" : "sr-only"}>{status}</div>
    <div role="status" aria-atomic="true" className={archiveCleanupWarning ? "rounded-md border border-amber-700/30 bg-amber-50 p-3 text-sm text-amber-950" : "sr-only"}>{archiveCleanupWarning}</div>
    {localDraftStatus ? <p className="rounded-md border border-amber-700/30 bg-amber-50 p-3 text-sm text-amber-950" role="status">{localDraftStatus}</p> : null}
    {localDraftError ? <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert">{localDraftError}</p> : null}

    {recoveryState.phase === "loading" ? <p role="status" className="text-sm text-muted-foreground">Checking for recordings to recover…</p> : null}
    {recoveryState.phase === "error" ? <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/30 p-3 text-sm"><span>{recoveryState.error}</span><Button type="button" size="sm" variant="outline" onClick={() => setRecoveryState((current) => ({ ...current, requestId: current.requestId + 1 }))}>Retry</Button></div> : null}
    {recoveryState.items.length ? <Card><CardHeader><CardTitle>Recovered audio on this device</CardTitle><CardDescription>These recordings were kept on this device after the recorder stopped or the tab closed. Send one to the M1 to recover its transcript.</CardDescription></CardHeader><CardContent className="grid gap-3">{recoveryState.items.map((item) => <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3" key={item.id}><div className="min-w-0"><p className="break-words text-sm font-semibold">{item.candidateName || "Candidate"}{item.jobTitle ? ` · ${item.jobTitle}` : ""}</p><p className="text-xs text-muted-foreground">{item.startedAt ? new Date(item.startedAt).toLocaleString() : "Saved recording"} · Microphone only</p></div><Button className="h-auto min-h-9 whitespace-normal text-center" variant="outline" onClick={() => recoverSavedRecording(item.id)} disabled={Boolean(recoveringId) || Boolean(recording)}>{recoveringId === item.id ? "Recovering…" : "Recover recording"}</Button></div>)}</CardContent></Card> : null}

    <Card><CardHeader><CardTitle>Calendar</CardTitle><CardDescription>Events come from the connected Google Calendar account.</CardDescription></CardHeader><CardContent>
      {calendar.phase === "loading" ? <p className="text-sm text-muted-foreground">Loading meetings...</p> : null}
      {calendar.phase === "error" ? <Button variant="outline" onClick={loadCalendar}><RefreshCw size={14} /> Retry Calendar</Button> : null}
      {calendar.phase === "ready" ? <Tabs defaultValue="today"><TabsList><TabsTrigger value="today">Today</TabsTrigger><TabsTrigger value="upcoming">Upcoming</TabsTrigger><TabsTrigger value="past">Past</TabsTrigger></TabsList><TabsContent value="today"><EventList events={grouped.today} onRecord={beginRecording} /></TabsContent><TabsContent value="upcoming"><EventList events={grouped.upcoming} onRecord={beginRecording} /></TabsContent><TabsContent value="past"><EventList events={grouped.past} onRecord={beginRecording} /></TabsContent></Tabs> : null}
    </CardContent></Card>

    {meetingDraftOwnerId && meetingDraftOwnerId !== draftOwnerId ? <p className="rounded-md border border-amber-700/30 bg-amber-50 p-3 text-sm text-amber-950" role="alert">This unsaved meeting belongs to the previous signed-in account. It is saved on this device under that account and hidden until that account signs in again.</p> : <MeetingCaptureVariants launchContext={launchContext} recruiting={recruiting} selectedJob={selectedJob} selectedJobId={selectedJobId} setSelectedJobId={(value) => { void changeMeetingContext("job", value); }} selectedCandidate={selectedCandidate} selectedCandidateId={selectedCandidateId} setSelectedCandidateId={(value) => { void changeMeetingContext("candidate", value); }} recording={recording} beginRecording={beginRecording} finishRecording={finishRecording} recordedAudio={recordedAudio} selectedEvent={selectedEvent} transcribing={transcribing} includeSharedAudio={includeSharedAudio} setIncludeSharedAudio={setIncludeSharedAudio} pendingAudio={pendingAudio} retryTranscription={retryTranscription} transcript={transcript} setTranscript={(value) => { setMeetingDraftOwnerId((current) => current || draftOwnerId); setMeetingDraftDirty(true); setAfterCallResult(null); setLocalDraftStatus("Keeping this unsaved meeting draft on this device…"); setTranscript(value); }} notes={notes} setNotes={(value) => { setMeetingDraftOwnerId((current) => current || draftOwnerId); setMeetingDraftDirty(true); setAfterCallResult(null); setLocalDraftStatus("Keeping this unsaved meeting draft on this device…"); setNotes(value); }} segments={segments} speakers={speakers} speakerLabels={speakerLabels} onSpeakerLabelChange={renameSpeaker} saveDraft={saveDraft} createNotes={createNotes} makingNotes={makingNotes} />}
    {afterCallResult && (!meetingDraftOwnerId || meetingDraftOwnerId === draftOwnerId) ? <AfterCallDraftReview result={afterCallResult} onRetrySave={retryAfterCallSave} busy={makingNotes} /> : null}

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

    <Card><CardHeader><CardTitle>Recruiter template</CardTitle><CardDescription>Sections use transcript text only. Missing topics stay marked Not discussed.</CardDescription></CardHeader><CardContent className="grid gap-4">
      <Select value={templateId} onValueChange={setTemplateId}><SelectTrigger aria-label="Select meeting template" className="w-full sm:max-w-xs"><span>{MEETING_TEMPLATES.find((item) => item.id === templateId)?.label || "Select template"}</span></SelectTrigger><SelectContent>{MEETING_TEMPLATES.map((item) => <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>)}</SelectContent></Select>
      <div className="grid gap-3 rounded-lg border bg-background p-4">{template.sections.map((section) => <section key={section.heading}><h3 className="text-sm font-semibold">{section.heading}</h3><p className="whitespace-pre-wrap text-sm text-muted-foreground">{section.content}</p></section>)}</div>
      <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => downloadMeetingMarkdown({ title: exportTitle, markdown: template.markdown })}><FileDown size={14} /> Download Markdown</Button><Button variant="outline" onClick={() => printMeetingPdf({ title: exportTitle, template })}><Printer size={14} /> Print or save PDF</Button></div>
    </CardContent></Card>
  </div>;
}
