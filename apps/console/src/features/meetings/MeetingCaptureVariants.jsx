import { useEffect, useRef, useState } from "react";
import { CalendarDays, ClipboardList, Link2, Mic, Square } from "lucide-react";
import { Button } from "../../components/ui/button.tsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card.tsx";
import { Input } from "../../components/ui/input.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select.tsx";
import { Textarea } from "../../components/ui/textarea.tsx";
import { isSecureRecordingContext, meetingCaptureState } from "./browserRecorder.js";
import { isMeetingContextLocked } from "./meetingModel.js";
import { operatorCasesEnabled } from "../operator-cases/operatorCaseService.js";

const VARIANTS = [
  { id: "guided", label: "Guided", rightWhen: "The workflow is occasional and sequence matters", cost: "More vertical travel" },
  { id: "split", label: "Split", rightWhen: "Recruiters compare context and notes while working", cost: "Tighter at medium widths" },
  { id: "transcript-first", label: "Transcript first", rightWhen: "Most work begins from an existing transcript", cost: "Recording controls carry less weight" },
];

function readVariant() {
  const value = new URLSearchParams(globalThis.location?.search || "").get("__variant");
  return VARIANTS.some((variant) => variant.id === value) ? value : VARIANTS[0].id;
}

function useVariantPicker() {
  const [active, setActive] = useState(readVariant);
  const [hidden, setHidden] = useState(false);
  const showPicker = new URLSearchParams(globalThis.location?.search || "").has("__variant");

  useEffect(() => {
    const sync = () => setActive(readVariant());
    globalThis.addEventListener("popstate", sync);
    return () => globalThis.removeEventListener("popstate", sync);
  }, []);

  useEffect(() => {
    if (!showPicker) return undefined;
    const onKeyDown = (event) => {
      const target = event.target;
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (target instanceof HTMLElement && (target.matches("input, textarea, select") || target.isContentEditable)) return;
      if (event.key.toLowerCase() === "h") {
        event.preventDefault();
        setHidden((value) => !value);
        return;
      }
      if (!["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"].includes(event.key)) return;
      event.preventDefault();
      const current = VARIANTS.findIndex((variant) => variant.id === active);
      const delta = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1;
      const next = VARIANTS[(current + delta + VARIANTS.length) % VARIANTS.length];
      const url = new URL(globalThis.location.href);
      url.searchParams.set("__variant", next.id);
      globalThis.history.replaceState(null, "", url);
      setActive(next.id);
    };
    globalThis.addEventListener("keydown", onKeyDown);
    return () => globalThis.removeEventListener("keydown", onKeyDown);
  }, [active, showPicker]);

  const choose = (id) => {
    const url = new URL(globalThis.location.href);
    url.searchParams.set("__variant", id);
    globalThis.history.replaceState(null, "", url);
    setActive(id);
  };

  return { active, choose, hidden, showPicker };
}

function VariantPicker({ active, choose, hidden }) {
  const activeRef = useRef(null);

  useEffect(() => {
    const button = activeRef.current;
    const picker = button?.closest(".meeting-variant-picker");
    if (!button || !picker) return;
    if (button.offsetTop < picker.scrollTop) picker.scrollTop = button.offsetTop;
    if (button.offsetTop + button.offsetHeight > picker.scrollTop + picker.clientHeight) picker.scrollTop = button.offsetTop + button.offsetHeight - picker.clientHeight;
  }, [active]);

  return <>
    <nav className={`meeting-variant-picker${hidden ? " is-hidden" : ""}`} aria-label="Meeting capture variants">
      <div className="meeting-variant-picker-group" role="group" aria-labelledby="meeting-variant-structure">
        <span className="meeting-variant-picker-heading" id="meeting-variant-structure">
          <svg aria-hidden="true" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v4a3 3 0 0 0 3 3h7" /><path d="m10 7 3 3-3 3" /></svg>
          Structure
        </span>
        {VARIANTS.map((variant) => <button key={variant.id} ref={variant.id === active ? activeRef : null} type="button" data-variant={variant.id} aria-pressed={variant.id === active} onClick={() => choose(variant.id)}>{variant.label}</button>)}
      </div>
      <span className="meeting-variant-picker-hint">Arrow keys switch. H hides.</span>
    </nav>
    <div className={`meeting-variant-picker-select${hidden ? " is-hidden" : ""}`}>
      <select aria-label="Meeting capture variant" value={active} onChange={(event) => choose(event.target.value)}>
        <optgroup label="Structure">
          {VARIANTS.map((variant) => <option key={variant.id} value={variant.id}>{variant.label}</option>)}
        </optgroup>
      </select>
      <svg aria-hidden="true" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="m4 6 4 4 4-4" /></svg>
    </div>
  </>;
}

function RecruitingContext({ launchContext, recruiting, selectedJob, selectedJobId, setSelectedJobId, selectedCandidate, selectedCandidateId, setSelectedCandidateId, recording, transcribing }) {
  const [editing, setEditing] = useState(false);
  const attached = launchContext?.job?.id && launchContext?.candidate?.id;
  const lockedCall = isMeetingContextLocked({ launchContext, recording, transcribing });
  const attachmentLabel = launchContext?.source === "candidate_call" ? "attached from the Call button" : "restored from Recent meetings";
  useEffect(() => { if (lockedCall) setEditing(false); }, [lockedCall]);

  if (attached && !editing) {
    return <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/20 p-3">
      <div className="min-w-0"><p className="break-words text-sm font-semibold">{selectedCandidate?.name || launchContext.candidate.name || "Candidate"}</p><p className="break-words text-xs text-muted-foreground">{selectedJob?.title || launchContext.job.title || "Job"} · {attachmentLabel}</p></div>
      {lockedCall ? <p className="text-xs font-medium text-muted-foreground">Context locked while recording</p> : <Button type="button" size="sm" variant="outline" onClick={() => setEditing(true)}>Change context</Button>}
    </div>;
  }

  return <div className="grid gap-3 sm:grid-cols-2">
    <label className="text-sm font-medium">Job<Select value={selectedJobId} onValueChange={(value) => setSelectedJobId(String(value))} disabled={lockedCall}><SelectTrigger aria-label="Select meeting job" className="mt-1 w-full"><SelectValue placeholder="Select job" /></SelectTrigger><SelectContent>{recruiting.jobs.map((job) => <SelectItem key={job.id} value={String(job.id)}>{job.title} · {job.company}</SelectItem>)}</SelectContent></Select></label>
    <label className="text-sm font-medium">Candidate<Select value={selectedCandidateId} onValueChange={(value) => setSelectedCandidateId(String(value))} disabled={lockedCall || !selectedJobId || recruiting.phase === "loading_candidates"}><SelectTrigger aria-label="Select meeting candidate" className="mt-1 w-full"><SelectValue placeholder={recruiting.phase === "loading_candidates" ? "Loading candidates" : "Select candidate"} /></SelectTrigger><SelectContent>{recruiting.candidates.map((candidate) => <SelectItem key={candidate.id} value={String(candidate.id)}>{candidate.name} · {candidate.title}</SelectItem>)}</SelectContent></Select></label>
  </div>;
}

function RecordingControls({ launchContext, recording, beginRecording, finishRecording, recordedAudio, selectedEvent, transcribing, includeSharedAudio, setIncludeSharedAudio, pendingAudio, retryTranscription }) {
  const callLaunch = launchContext?.source === "candidate_call";
  const preparing = launchContext?.phase === "starting";
  const secure = isSecureRecordingContext();
  const captureNote = recording
    ? meetingCaptureState(recording)
    : secure
      ? "Recording uses this device's microphone. Audio is sent to the M1 for transcription."
      : "Recording needs the secure Workbench address. Open the Tailscale HTTPS link, then try again.";
  const warning = recording?.warning || (callLaunch ? "Phone call audio is not captured." : "");
  return <div className="flex flex-col gap-3">
    <p className="text-sm text-muted-foreground">{captureNote}{callLaunch ? " The call is placed only after recording starts." : ""}</p>
    {warning ? <p role="status" className="rounded-md border border-amber-700/30 bg-amber-50 p-3 text-sm text-amber-950">{warning}</p> : null}
    {!recording && !callLaunch ? <label className="flex items-start gap-2 text-sm text-muted-foreground"><input className="mt-1" type="checkbox" checked={Boolean(includeSharedAudio)} onChange={(event) => setIncludeSharedAudio?.(event.target.checked)} disabled={!secure} /> Also record this device's shared call audio when the browser allows it</label> : null}
    <div className="flex flex-wrap gap-2">{preparing ? <Button className="h-auto min-h-9 max-w-full whitespace-normal text-center" disabled><Mic size={14} />Preparing recorder</Button> : !recording ? <Button className="h-auto min-h-9 max-w-full whitespace-normal text-center" onClick={() => beginRecording(selectedEvent)} disabled={!secure}><Mic size={14} />Start recording</Button> : transcribing ? <Button className="h-auto min-h-9 max-w-full whitespace-normal text-center" disabled><Square size={14} />Finalizing recording</Button> : <Button className="h-auto min-h-9 max-w-full whitespace-normal text-center" variant="destructive" onClick={finishRecording}><Square size={14} />Stop recording</Button>}{recordedAudio ? <Button className="h-auto min-h-9 max-w-full whitespace-normal text-center" variant="outline" render={<a href={recordedAudio.url} download={recordedAudio.filename} />}><Link2 size={14} />Download recording</Button> : null}{pendingAudio && !recording && !transcribing ? <Button className="h-auto min-h-9 max-w-full whitespace-normal text-center" variant="outline" onClick={retryTranscription}>Retry M1 transcription</Button> : null}</div>
    {selectedEvent ? <p className="text-sm text-muted-foreground"><CalendarDays size={14} className="inline" aria-hidden="true" /> Linked event: {selectedEvent.title || "Untitled meeting"}</p> : null}
  </div>;
}

function NotesEditor({ transcript, setTranscript, notes, setNotes, transcribing, segments = [], speakers = [], speakerLabels = {}, onSpeakerLabelChange, transcriptRows = 7, notesRows = 4 }) {
  const [segmentQuery, setSegmentQuery] = useState("");
  const normalizedQuery = segmentQuery.trim().toLowerCase();
  const visibleSegments = normalizedQuery
    ? segments.filter((segment) => `${speakerLabels[segment.speaker] || segment.speaker || "Speaker"} ${segment.text || ""}`.toLowerCase().includes(normalizedQuery))
    : segments;
  return <div className="flex flex-col gap-3">
    <label className="text-sm font-medium">Transcript<Textarea className="mt-1" rows={transcriptRows} value={transcript} onChange={(event) => setTranscript(event.target.value)} placeholder={transcribing ? "Transcribing on the M1..." : "Transcript appears here after M1 transcription."} disabled={transcribing} /></label>
    {speakers.length ? <fieldset className="grid gap-2 rounded-lg border p-3 sm:grid-cols-2"><legend className="px-1 text-sm font-semibold">Speaker names</legend>{speakers.map((speaker) => <label className="min-w-0 text-xs text-muted-foreground" key={speaker}>{speaker}<Input className="mt-1" aria-label={`Name for ${speaker}`} value={speakerLabels[speaker] || speaker} onChange={(event) => onSpeakerLabelChange?.(speaker, event.target.value)} /></label>)}</fieldset> : null}
    {segments.length ? <div className="grid gap-2 rounded-lg border bg-muted/20 p-3" aria-label="Structured speaker transcript">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold">Speaker lines</span>
        <Input className="max-w-xs" type="search" placeholder="Search transcript" aria-label="Search speaker transcript" value={segmentQuery} onChange={(event) => setSegmentQuery(event.target.value)} />
      </div>
      {visibleSegments.length ? visibleSegments.map((segment, index) => <p className="break-words text-sm" key={`${segment.start || 0}-${index}`}><span className="font-semibold">{speakerLabels[segment.speaker] || segment.speaker || "Speaker"}:</span> {segment.text}</p>) : <p className="text-sm text-muted-foreground">No speaker lines match this search.</p>}
    </div> : null}
    <label className="text-sm font-medium">Meeting notes<Textarea className="mt-1" rows={notesRows} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Decisions, follow-ups, and candidate facts." /></label>
    <p className="text-xs text-muted-foreground">{operatorCasesEnabled ? "Add a transcript or notes to save a meeting draft. Without a transcript, the after-call review is saved as blocked." : "Add a transcript or notes to save a meeting draft. Save the transcript before preparing after-call notes."}</p>
  </div>;
}

function CaptureActions({ transcribing, makingNotes, saveDraft, createNotes }) {
  return <div className="flex flex-wrap gap-2"><Button className="h-auto min-h-9 max-w-full whitespace-normal text-center" onClick={saveDraft} disabled={transcribing}>{transcribing ? "Transcribing..." : "Save meeting draft"}</Button><Button className="h-auto min-h-9 max-w-full whitespace-normal text-center" variant="outline" onClick={createNotes} disabled={makingNotes || transcribing}><ClipboardList size={14} />{makingNotes ? "Preparing..." : "Prepare after-call review"}</Button></div>;
}

function CaptureHeader({ description }) {
  return <CardHeader><CardTitle>Record and attach</CardTitle><CardDescription>{description}</CardDescription></CardHeader>;
}

function GuidedVariant(props) {
  return <Card><CaptureHeader description="Move from recruiting context to source capture, then save the draft." /><CardContent className="flex flex-col gap-5">
    <section className="flex flex-col gap-3"><h3 className="text-sm font-semibold">Recruiting context</h3><RecruitingContext {...props} />{props.recruiting.phase === "loading" ? <p className="text-sm text-muted-foreground">Loading recruiting records...</p> : null}{props.recruiting.error ? <p role="alert" className="text-sm text-destructive">{props.recruiting.error}</p> : null}{props.recruiting.phase === "ready" && !props.recruiting.jobs.length ? <p className="text-sm text-muted-foreground">No active Tracker jobs are available. Refresh Tracker data, then return here.</p> : null}</section>
    <section className="flex flex-col gap-3 border-t pt-5"><h3 className="text-sm font-semibold">Capture</h3><RecordingControls {...props} /></section>
    <section className="flex flex-col gap-3 border-t pt-5"><h3 className="text-sm font-semibold">Document</h3><NotesEditor {...props} transcriptRows={8} notesRows={5} /><CaptureActions {...props} /></section>
  </CardContent></Card>;
}

function SplitVariant(props) {
  return <Card><CaptureHeader description="Keep call controls and source notes visible together." /><CardContent className="grid gap-5 lg:grid-cols-[minmax(16rem,0.8fr)_minmax(0,1.2fr)]">
    <div className="flex flex-col gap-4"><RecruitingContext {...props} />{props.recruiting.phase === "loading" ? <p className="text-sm text-muted-foreground">Loading recruiting records...</p> : null}{props.recruiting.error ? <p role="alert" className="text-sm text-destructive">{props.recruiting.error}</p> : null}{props.recruiting.phase === "ready" && !props.recruiting.jobs.length ? <p className="text-sm text-muted-foreground">No active Tracker jobs are available. Refresh Tracker data, then return here.</p> : null}<RecordingControls {...props} /></div>
    <div className="flex flex-col gap-4"><NotesEditor {...props} /><CaptureActions {...props} /></div>
  </CardContent></Card>;
}

function TranscriptFirstVariant(props) {
  return <Card><CaptureHeader description="Start with the transcript, then attach recruiting context and save." /><CardContent className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
    <div className="flex flex-col gap-4"><NotesEditor {...props} transcriptRows={12} notesRows={4} /><CaptureActions {...props} /></div>
    <aside className="flex flex-col gap-4 rounded-lg border bg-muted/20 p-4"><h3 className="text-sm font-semibold">Attach context</h3><RecruitingContext {...props} />{props.recruiting.phase === "loading" ? <p className="text-sm text-muted-foreground">Loading recruiting records...</p> : null}{props.recruiting.error ? <p role="alert" className="text-sm text-destructive">{props.recruiting.error}</p> : null}{props.recruiting.phase === "ready" && !props.recruiting.jobs.length ? <p className="text-sm text-muted-foreground">No active Tracker jobs are available. Refresh Tracker data, then return here.</p> : null}<RecordingControls {...props} /></aside>
  </CardContent></Card>;
}

const COMPONENTS = { guided: GuidedVariant, split: SplitVariant, "transcript-first": TranscriptFirstVariant };

export default function MeetingCaptureVariants(props) {
  const { active, choose, hidden, showPicker } = useVariantPicker();
  const ActiveVariant = COMPONENTS[active];
  return <div className="meeting-variant-page">
    <div className={`meeting-variant-layout${showPicker ? "" : " without-picker"}`}>
      {showPicker ? <VariantPicker active={active} choose={choose} hidden={hidden} /> : null}
      <div className="meeting-variant-stage"><ActiveVariant {...props} /></div>
    </div>
  </div>;
}

export { VARIANTS };
