import { lazy, Suspense, useEffect, useMemo, useState, useRef } from "react";
import { ExternalLink, MapPin, Tag, Check, ShieldAlert, AlertCircle, FileText, Loader2, NotebookText, Pencil, Plus, Send } from "lucide-react";
import { Badge } from "../../components/ui/badge.tsx";
import { handleTabListKeyDown } from "../../components/handleTabListKeyDown.js";
import { Button } from "../../components/ui/button.tsx";
import { RESUME_INDICATOR_STATES } from "./constants.js";
import ResumeSection from "./ResumeSection.jsx";
import ActivityTrail from "./ActivityTrail.jsx";
import LogActivityForm from "./LogActivityForm.jsx";
import AlsoFitsDialog from "./AlsoFitsDialog.jsx";
import CandidateWriteUpDialog from "./CandidateWriteUpDialog.jsx";
import CandidateEditorDialog from "./CandidateEditorDialog.jsx";
import CandidatePresentationSummary, {
  CandidatePresentationBadges,
} from "./CandidatePresentationSummary.jsx";
import {
  applyCandidateRecordToUiCandidate,
  describeCandidateProvenance,
  getCachedCandidateRecord,
  getCandidateById,
  subscribeCandidateRecords,
} from "./candidateEditorService.js";
import { getOwnershipStatus, openBrandedResume } from "./brandResume.js";
import { createCandidateDraft } from "./candidateReviewService.js";
import RejectMenu from "./RejectMenu.jsx";
import ContactReveal from "./ContactReveal.jsx";
import ExperienceTimeline from "./ExperienceTimeline.jsx";
import ForYourAiBox from "./ForYourAiBox.jsx";
import OutreachComposer from "./OutreachComposer.jsx";
import { FitBadge, getResumeSource } from "./externals.js";

const LOXO_PEOPLE_BASE_URL = "https://app.loxo.co/people/";
const NotesPanel = lazy(() => import("../notes/NotesPanel.jsx"));
const BoardPanel = lazy(() => import("../board/BoardPanel.jsx"));

export default function CandidateCard({
  candidate: rawCandidate,
  currentJob,
  jobs = [],
  onReject,
  onWant,
  onLogActivity,
  onStartCandidateCall,
  onCandidateSaved,
}) {
  const [overlayRecord, setOverlayRecord] = useState(() => getCachedCandidateRecord(rawCandidate?.id));
  const [editorMode, setEditorMode] = useState(null); // "edit" | "create" | null
  const [saveNotice, setSaveNotice] = useState("");
  const [activeFit, setActiveFit] = useState(null);
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isDeciding, setIsDeciding] = useState(false);
  const [decisionError, setDecisionError] = useState("");
  const [brandError, setBrandError] = useState("");
  const [showWriteUp, setShowWriteUp] = useState(false);
  const [ownershipOverride, setOwnershipOverride] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [showOutreach, setShowOutreach] = useState(false);
  const [activeTab, setActiveTab] = useState("profile");
  const [notesOpened, setNotesOpened] = useState(false);
  const [boardOpened, setBoardOpened] = useState(false);
  const [ticked, setTicked] = useState(() => new Set());
  const startXRef = useRef(0);

  useEffect(() => {
    setOverlayRecord(getCachedCandidateRecord(rawCandidate?.id));
    setSaveNotice("");
    const unsubscribe = subscribeCandidateRecords(() => {
      setOverlayRecord(getCachedCandidateRecord(rawCandidate?.id));
    });
    const prov = describeCandidateProvenance(rawCandidate, { mode: "edit" });
    if (rawCandidate?.id && !prov.invalidKey && !getCachedCandidateRecord(rawCandidate.id)) {
      getCandidateById(rawCandidate.id).catch(() => {
        // Ignore unauthenticated or offline background lookup on mount.
      });
    }
    return unsubscribe;
  }, [rawCandidate?.id]);

  const candidate = useMemo(
    () => (overlayRecord ? applyCandidateRecordToUiCandidate(rawCandidate, overlayRecord) : rawCandidate),
    [rawCandidate, overlayRecord],
  );

  const provenance = useMemo(
    () => describeCandidateProvenance(overlayRecord || candidate, { mode: "edit" }),
    [overlayRecord, candidate],
  );

  const ownership = useMemo(
    () => getOwnershipStatus(candidate.activityTrail),
    [candidate.activityTrail]
  );

  const resumeSource = useMemo(() => {
    try {
      return getResumeSource(candidate);
    } catch {
      return { kind: "none" };
    }
  }, [candidate]);

  const markDone = (moduleId) =>
    setTicked((current) => (current.has(moduleId) ? current : new Set([...current, moduleId])));
  const toggleModule = (moduleId) =>
    setTicked((current) => {
      const next = new Set(current);
      if (next.has(moduleId)) next.delete(moduleId);
      else next.add(moduleId);
      return next;
    });

  const resumeIndicator =
    RESUME_INDICATOR_STATES[candidate.resumeStatus] ||
    RESUME_INDICATOR_STATES.resume_on_file;

  const handlePointerDown = (e) => {
    if (isDeciding) return;
    // Avoid dragging when clicking inside interactive elements
    if (
      e.target.closest("button") ||
      e.target.closest("a") ||
      e.target.closest("input") ||
      e.target.closest("textarea") ||
      e.target.closest("select") ||
      e.target.closest("[role='dialog']") ||
      e.target.closest(".workbench-notes-panel") ||
      e.target.closest(".workbench-board-panel")
    ) {
      return;
    }
    setIsDragging(true);
    startXRef.current = e.clientX;
  };

  const handlePointerMove = (e) => {
    if (!isDragging || isDeciding) return;
    const diff = e.clientX - startXRef.current;
    setDragOffset(diff);
  };

  const handlePointerUp = () => {
    if (!isDragging) return;
    setIsDragging(false);

    if (dragOffset > 90) {
      handleDecision("want");
    } else if (dragOffset < -90) {
      setRejectOpen(true);
    }
    setDragOffset(0);
  };

  const handleDecision = async (decision) => {
    if (isDeciding) return { ok: false, error: "Decision already saving" };
    setIsDeciding(true);
    setDecisionError("");
    try {
      const result = await onWant(candidate.id);
      if (result?.ok === false) throw new Error(result.error || "Decision failed");
      return result || { ok: true };
    } catch (error) {
      const message = error.message || "Decision failed. Try again.";
      setDecisionError(message);
      return { ok: false, error: message };
    } finally {
      setIsDeciding(false);
    }
  };

  const handleReject = async (reason) => {
    if (isDeciding) return;
    setIsDeciding(true);
    setDecisionError("");
    try {
      const result = await onReject(candidate.id, reason);
      if (result?.ok === false) throw new Error(result.error || "Pass failed");
      markDone("loxo");
    } catch (error) {
      setDecisionError(error.message || "Pass failed. Try again.");
    } finally {
      setIsDeciding(false);
    }
  };

  const handleCardLogActivity = async (candidateId, payload) => {
    const result = await onLogActivity(candidateId, payload);
    if (result?.ok !== false) markDone("loxo");
    return result;
  };

  const handleBrandResume = async () => {
    setBrandError("");
    try {
      if (resumeSource.kind === "none") {
        throw new Error("Not enough data to build a resume");
      }
      await createCandidateDraft({
        job: currentJob,
        candidate,
        kind: "resume_pdf",
        body: resumeSource.text,
      });
      const result = openBrandedResume(candidate);
      if (!result.ok) throw new Error(result.error);
      markDone("brandedresume");
    } catch (error) {
      setBrandError(error.message || "The branded resume could not be opened.");
    }
  };

  // Drag overlay stamps
  const showWantStamp = dragOffset > 40;
  const showPassStamp = dragOffset < -40;

  return (
    <div
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      style={{
        transform: dragOffset ? `translateX(${dragOffset}px) rotate(${dragOffset * 0.04}deg)` : undefined,
        transition: isDragging ? "none" : "transform 0.25s ease-out",
        fontFamily: "Arial, Calibri, sans-serif",
      }}
      className="relative flex h-full max-h-[calc(100vh-175px)] w-full select-none flex-col overflow-hidden rounded-xl border bg-card text-foreground shadow-sm"
      data-testid="swipe-candidate-card"
    >
      {/* Visual Swipe Direction Stamps */}
      {showWantStamp && (
        <div className="pointer-events-none absolute right-8 top-8 z-30 rotate-12 rounded-lg border-2 border-emerald-600 bg-emerald-50/90 px-4 py-2 text-base font-extrabold tracking-wider text-emerald-700 shadow-lg">
          WANT THIS CANDIDATE
        </div>
      )}
      {showPassStamp && (
        <div className="pointer-events-none absolute left-8 top-8 z-30 -rotate-12 rounded-lg border-2 border-rose-600 bg-rose-50/90 px-4 py-2 text-base font-extrabold tracking-wider text-rose-700 shadow-lg">
          PASS
        </div>
      )}

      {/* 1. Header Row */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/10 p-4 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-foreground text-background font-bold text-lg">
            {candidate.initials}
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {/* Candidate NAME link opens Loxo profile in a new tab */}
              {candidate.profileUrl || candidate.loxoPersonId ? <a
                href={candidate.profileUrl || `${LOXO_PEOPLE_BASE_URL}${candidate.loxoPersonId}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-lg font-bold hover:underline hover:text-amber-800 flex items-center gap-1 leading-snug"
                title="Open Loxo profile in new tab"
              >
                <span>{candidate.name}</span>
                <ExternalLink size={14} className="text-muted-foreground" />
              </a> : <span className="text-lg font-bold leading-snug">{candidate.name}</span>}

              {/* Pipeline Stage Pill (exact Loxo name) */}
              <Badge variant="outline" className="font-semibold text-xs border-foreground/30 bg-background">
                {candidate.stage}
              </Badge>

              <FitBadge job={currentJob} candidate={candidate} />

              {/* Resume Indicator (3 states) */}
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold border ${
                  resumeIndicator.key === "no_resume_data"
                    ? "border-amber-400 bg-amber-50 text-amber-900"
                    : resumeIndicator.key === "profile_only"
                    ? "border-border bg-muted/40 text-muted-foreground"
                    : "border-emerald-300 bg-emerald-50 text-emerald-800"
                }`}
                title={resumeIndicator.label}
              >
                <span>{resumeIndicator.symbol}</span>
                <span>{resumeIndicator.label}</span>
              </span>

              {!provenance.invalidKey ? (
                <Badge
                  variant="outline"
                  className={
                    provenance.isManual
                      ? "border-emerald-400 bg-emerald-50 text-emerald-900 text-[11px] font-semibold"
                      : provenance.hasOverlay
                        ? "border-amber-400 bg-amber-50 text-amber-900 text-[11px] font-semibold"
                        : "text-[11px]"
                  }
                  data-testid="card-provenance-badge"
                >
                  {provenance.badgeLabel}
                </Badge>
              ) : null}

              <CandidatePresentationBadges
                candidate={candidate}
                jobId={currentJob?.id}
                prefix="card"
              />

              {/* Candidate Decision Badge if already marked */}
              {candidate.decision && (
                <Badge
                  variant="outline"
                  className={`text-xs font-bold ${
                    candidate.decision === "want"
                      ? "border-emerald-500 bg-emerald-50 text-emerald-800"
                      : "border-rose-400 bg-rose-50 text-rose-800"
                  }`}
                >
                  {candidate.decision === "want" ? "Marked: Want" : "Marked: Pass"}
                </Badge>
              )}
            </div>

            <p className="text-xs text-muted-foreground truncate mt-0.5">
              {candidate.title} at {candidate.employer}
            </p>
          </div>
        </div>

        {/* Contact info: email and number stay hidden until asked for */}
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {candidate.location && (
            <span className="flex items-center gap-1 bg-background border px-2 py-1 rounded-md">
              <MapPin size={12} /> {candidate.location}
            </span>
          )}
          <ContactReveal candidate={candidate} currentJob={currentJob} onStartCandidateCall={onStartCandidateCall} />
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setEditorMode("edit")}
            className="h-7 px-2 text-xs font-semibold"
            aria-label={`Edit ${candidate.name}`}
            data-testid="card-edit-candidate-button"
          >
            <Pencil size={12} className="mr-1" /> Edit candidate
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setEditorMode("create")}
            className="h-7 px-2 text-xs font-semibold"
            data-testid="card-add-candidate-button"
          >
            <Plus size={12} className="mr-1" /> Add candidate
          </Button>
        </div>
      </div>

      <div className="mx-4 mt-2 empty:hidden">
        <CandidatePresentationSummary
          candidate={candidate}
          jobId={currentJob?.id}
          prefix="card"
        />
      </div>

      {(candidate.industry || candidate.shift || candidate.compensation_target || candidate.current_compensation || candidate.compensation_context || candidate.role_context || candidate.client_context || candidate.notes) ? (
        <div
          className="mx-4 mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border bg-muted/20 px-3 py-1.5 text-xs"
          data-testid="card-candidate-details"
        >
          {candidate.industry ? <span><strong className="font-semibold">Industry:</strong> {candidate.industry}</span> : null}
          {candidate.shift ? <span><strong className="font-semibold">Shift:</strong> {candidate.shift}</span> : null}
          {candidate.compensation_target ? <span><strong className="font-semibold">Target comp:</strong> {candidate.compensation_target}</span> : null}
          {candidate.current_compensation ? <span><strong className="font-semibold">Current comp:</strong> {candidate.current_compensation}</span> : null}
          {candidate.compensation_context ? <span><strong className="font-semibold">Comp context:</strong> {candidate.compensation_context}</span> : null}
          {candidate.role_context ? <span><strong className="font-semibold">Role context:</strong> {candidate.role_context}</span> : null}
          {candidate.client_context ? <span><strong className="font-semibold">Client context:</strong> {candidate.client_context}</span> : null}
          {candidate.notes ? <span className="truncate max-w-md"><strong className="font-semibold">Notes:</strong> {candidate.notes}</span> : null}
        </div>
      ) : null}

      {saveNotice ? (
        <div
          role="status"
          className="mx-4 mt-2 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-900"
          data-testid="card-candidate-save-status"
        >
          {saveNotice}
        </div>
      ) : null}

      {ownership.active && !ownershipOverride ? (
        <div className="mx-4 mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-950" data-testid="ownership-warning">
          <span className="flex items-center gap-2">
            <ShieldAlert size={14} />
            Ownership check: {ownership.latest.actor} contacted this candidate on {ownership.latest.date}. This is within six months.
          </span>
          <Button type="button" size="sm" variant="outline" onClick={() => setOwnershipOverride(true)} className="h-7 bg-white text-xs">
            Reach out anyway
          </Button>
        </div>
      ) : null}

      {ownershipOverride ? (
        <div className="mx-4 mt-2 rounded-md border bg-muted/30 p-2 text-xs text-muted-foreground" data-testid="ownership-override">
          Ownership warning overridden for this session. No message was sent.
        </div>
      ) : null}

      {decisionError || brandError ? (
        <div role="alert" className="mx-4 mt-2 flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          <AlertCircle size={14} /> {decisionError || brandError}
        </div>
      ) : null}

      <div role="tablist" aria-label="Candidate details" onKeyDown={handleTabListKeyDown} className="flex shrink-0 gap-2 border-b px-4 pt-2">
        <button id="candidate-profile-tab" type="button" role="tab" tabIndex={activeTab === "profile" ? 0 : -1} aria-controls="candidate-profile-panel" aria-selected={activeTab === "profile"} onClick={() => setActiveTab("profile")} className="min-h-10 rounded-t-md border px-3 text-sm aria-selected:bg-muted">Profile</button>
        <button id="candidate-notes-tab" type="button" role="tab" tabIndex={activeTab === "notes" ? 0 : -1} aria-controls="candidate-notes-panel" aria-selected={activeTab === "notes"} onClick={() => { setNotesOpened(true); setActiveTab("notes"); }} className="min-h-10 rounded-t-md border px-3 text-sm aria-selected:bg-muted">Notes</button>
        <button id="candidate-board-tab" type="button" role="tab" tabIndex={activeTab === "board" ? 0 : -1} aria-controls="candidate-board-panel" aria-selected={activeTab === "board"} onClick={() => { setBoardOpened(true); setActiveTab("board"); }} className="min-h-10 rounded-t-md border px-3 text-sm aria-selected:bg-muted">Board</button>
      </div>
      <div id="candidate-notes-panel" role="tabpanel" aria-labelledby="candidate-notes-tab" hidden={activeTab !== "notes"} className={activeTab === "notes" ? "min-h-0 flex-1 overflow-y-auto p-4 select-text" : "hidden"}>
        {notesOpened ? <Suspense fallback={<p className="text-sm text-muted-foreground">Loading notes editor…</p>}>
          <NotesPanel subjectType="candidate" subjectId={candidate.id} defaultTitle={candidate.name} />
        </Suspense> : null}
      </div>
      <div id="candidate-board-panel" role="tabpanel" aria-labelledby="candidate-board-tab" hidden={activeTab !== "board"} className={activeTab === "board" ? "min-h-0 flex-1 overflow-y-auto p-4 select-text" : "hidden"}>
        {boardOpened ? <Suspense fallback={<p className="text-sm text-muted-foreground">Loading board editor…</p>}>
          <BoardPanel subjectType="candidate" subjectId={candidate.id} defaultTitle={candidate.name} />
        </Suspense> : null}
      </div>
      {/* 2. Main Two-Column Body with internal scrolling */}
      <div id="candidate-profile-panel" role="tabpanel" aria-labelledby="candidate-profile-tab" hidden={activeTab !== "profile"} className={activeTab === "profile" ? "grid flex-1 min-h-0 gap-4 overflow-hidden p-4 lg:grid-cols-12" : "hidden"}>
        {/* Left Column: Also Fits Tags + Resume Section */}
        <div className="lg:col-span-7 flex flex-col gap-3 min-h-0 overflow-y-auto pr-1">
          {/* "Also Fits" Tags (Source produced only) */}
          {candidate.alsoFits && candidate.alsoFits.length > 0 && (
            <div className="rounded-lg border bg-muted/20 p-2.5">
              <div className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
                <Tag size={12} />
                <span>Also fits other roles (Tracker verified)</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {candidate.alsoFits.map((fit) => (
                  <button
                    key={fit.id}
                    type="button"
                    onClick={() => setActiveFit(fit)}
                    className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-950 hover:bg-amber-100 transition-colors"
                  >
                    <span>{fit.jobTitle}</span>
                    <span className="text-[10px] text-amber-800 font-normal">
                      ({fit.company})
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <ExperienceTimeline candidate={candidate} job={currentJob} />

          {/* Resume Section with bolded figures & expandable jobs */}
          <ResumeSection candidate={candidate} />
        </div>

        {/* Right Column: Full Activity Trail + Log Activity Form */}
        <div className="lg:col-span-5 flex flex-col gap-3 min-h-0 overflow-y-auto pl-1">
          <ActivityTrail candidate={candidate} />
          <LogActivityForm
            candidateId={candidate.id}
            onLogActivity={handleCardLogActivity}
          />
          <ForYourAiBox candidate={candidate} job={currentJob} ticked={ticked} onToggle={toggleModule} />
        </div>
      </div>

      {/* 3. Bottom Decision Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/10 p-3 shrink-0">
        <RejectMenu
          onReject={handleReject}
          disabled={isDeciding}
          open={rejectOpen}
          onOpenChange={setRejectOpen}
        />

        <Button type="button" variant="outline" onClick={() => setShowOutreach(true)} className="h-10 text-xs font-semibold" data-testid="outreach-button">
          <Send size={15} className="mr-1.5" /> Outreach
        </Button>

        <Button type="button" variant="outline" onClick={() => { markDone("write-up"); setShowWriteUp(true); }} className="h-10 text-xs font-semibold">
          <NotebookText size={15} className="mr-1.5" /> Write-up
        </Button>

        <Button type="button" variant="outline" onClick={handleBrandResume} className="h-10 border-amber-400 bg-amber-50 text-xs font-bold text-amber-950 hover:bg-amber-100" data-testid="brand-resume-button">
          <FileText size={15} className="mr-1.5" /> Brand resume
        </Button>
        {resumeSource.kind === "profile" ? (
          <Badge variant="outline" className="text-[10px]" title={`Sources: ${(resumeSource.usedSources || []).join(", ")}`}>
            Built from profile, no resume on file
          </Badge>
        ) : null}

        <Button
          type="button"
          onClick={() => handleDecision("want")}
          disabled={isDeciding}
          className="flex-1 max-w-[220px] bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs h-10 shadow-sm"
        >
          <Check size={15} className="mr-1.5" /> Want this candidate
        </Button>
      </div>

      {/* Dialog showing WHY this fit exists from Tracker Sheet */}
      <AlsoFitsDialog
        fit={activeFit}
        open={Boolean(activeFit)}
        onOpenChange={(open) => !open && setActiveFit(null)}
      />
      <OutreachComposer
        open={showOutreach}
        onOpenChange={setShowOutreach}
        candidate={candidate}
        currentJob={currentJob}
        jobs={jobs}
        onDrafted={() => markDone("ja-writer")}
      />
      <CandidateWriteUpDialog
        candidate={candidate}
        currentJob={currentJob}
        open={showWriteUp}
        onOpenChange={setShowWriteUp}
      />
      <CandidateEditorDialog
        open={Boolean(editorMode)}
        onOpenChange={(open) => !open && setEditorMode(null)}
        mode={editorMode || "edit"}
        candidate={editorMode === "edit" ? candidate : null}
        onSaved={(savedRecord) => {
          if (savedRecord?.id === rawCandidate?.id) {
            setOverlayRecord(savedRecord);
            setSaveNotice(
              savedRecord.is_manual
                ? `Saved manual candidate: ${savedRecord.candidate_name}`
                : `Saved overlay edits for ${savedRecord.candidate_name || candidate.name}`
            );
          } else if (savedRecord) {
            setSaveNotice(`Added manual candidate: ${savedRecord.candidate_name}`);
          }
          onCandidateSaved?.(savedRecord);
        }}
      />
    </div>
  );
}

