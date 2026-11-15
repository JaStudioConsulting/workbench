import { Component, lazy, Suspense, useEffect, useRef, useState } from "react";
import { Settings } from "lucide-react";
import { Skeleton } from "./components/ui/skeleton.tsx";
import ExistingAccountAccess from "./ExistingAccountAccess.jsx";
import { getWorkbenchSession, signOutWorkbench, subscribeToWorkbenchSession } from "./supabase-auth.js";
import { getVerifiedLocalWorkbenchSession, openLocalWorkbenchSession } from "./local-session.js";
import { startCandidateCallSession } from "./features/meetings/candidateCallSession.js";
import { getMeetingStatus } from "./features/meetings/meetingGatewayClient.js";
import HeaderSearch from "./features/search/HeaderSearch.jsx";
import { candidateReviewIdFromHomeItem } from "./features/home/homeNavigation.js";
import { clearLiveReviewCache } from "./features/candidate-review/candidateReviewService.js";

const ContextPicker = lazy(() => import("./ContextPicker.jsx"));
const WorkbenchOneView = lazy(() => import("./features/workbench/WorkbenchOneView.jsx"));

const loadRecentMeetings = () => import("./features/meetings/meetingStore.js").then((module) => module.listRecentMeetings());

function PanelFallback() { return <div className="min-h-[520px] rounded-lg border p-6" role="status" aria-label="Loading workspace"><Skeleton className="h-6 w-48" /><Skeleton className="mt-4 h-24 w-full" /></div>; }

class PageErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) { return { error }; }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <section className="rounded-lg border border-rose-300 bg-rose-50 p-5 text-rose-950" role="alert">
        <h2 className="font-semibold">Unable to load this page</h2>
        <p className="mt-1 text-sm">Return to Home or try loading this page again.</p>
        <div className="mt-4 flex gap-2">
          <button type="button" className="min-h-10 rounded-md border bg-background px-3 text-sm" onClick={this.props.onHome}>Go to Home</button>
          <button type="button" className="min-h-10 rounded-md border bg-background px-3 text-sm" onClick={() => this.setState({ error: null })}>Try again</button>
        </div>
      </section>
    );
  }
}

export default function App() {
  const localSessionMode = import.meta.env?.VITE_TAILSCALE_LOCAL_SESSION_ENABLED === "1";
  const localSessionOwnerId = String(import.meta.env?.VITE_TAILSCALE_LOCAL_SESSION_OWNER_ID || "");
  const [authLoading, setAuthLoading] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [sessionUserId, setSessionUserId] = useState("");
  const [authError, setAuthError] = useState("");
  const [localSessionRetry, setLocalSessionRetry] = useState(0);
  const [signingOut, setSigningOut] = useState(false);
  const [page, setPage] = useState("Home");
  const [context, setContext] = useState("Independent recruiting");
  const [recruiting, setRecruiting] = useState(null);
  const [focusCandidateId, setFocusCandidateId] = useState("");
  const [focusLeadId, setFocusLeadId] = useState("");
  const [focusClient, setFocusClient] = useState(null);
  const [focusNote, setFocusNote] = useState(null);
  const [meetingLaunch, setMeetingLaunch] = useState(null);
  const callStartRef = useRef(false);
  const sessionUserIdRef = useRef("");
  const pageHeadingRef = useRef(null);
  const recordingLocked = ["starting", "recording", "finalizing"].includes(meetingLaunch?.phase);

  useEffect(() => {
    let active = true;
    let initialized = false;
    const unsubscribe = subscribeToWorkbenchSession((session) => {
      if (!active) return;
      const nextUserId = String(session?.user?.id || "");
      const acceptedSession = Boolean(session) && (!localSessionMode
        || (initialized && localSessionOwnerId && nextUserId === localSessionOwnerId && sessionUserIdRef.current === localSessionOwnerId));
      if (sessionUserIdRef.current && sessionUserIdRef.current !== nextUserId) {
        clearLiveReviewCache();
        setPage("Home"); setContext("Independent recruiting"); setRecruiting(null);
        setFocusCandidateId(""); setFocusLeadId(""); setFocusClient(null); setFocusNote(null); setMeetingLaunch(null);
      }
      sessionUserIdRef.current = acceptedSession ? nextUserId : "";
      setSessionUserId(acceptedSession ? nextUserId : "");
      setHasSession(acceptedSession);
      setAuthError("");
      if ((session && acceptedSession) || initialized) setAuthLoading(false);
    });
    getWorkbenchSession()
      .then(async (savedSession) => {
        if (!active) return;
        if (localSessionMode && !localSessionOwnerId) throw new Error("Local session owner is not configured");
        const verifiedSavedSession = localSessionMode && savedSession
          ? await getVerifiedLocalWorkbenchSession({ expectedUserId: localSessionOwnerId })
          : null;
        const session = localSessionMode
          ? (verifiedSavedSession
            ? verifiedSavedSession
            : await openLocalWorkbenchSession({ expectedUserId: localSessionOwnerId }))
          : savedSession;
        if (!active) return;
        const nextUserId = String(session?.user?.id || "");
        if (localSessionMode && nextUserId !== localSessionOwnerId) throw new Error("Unexpected local session owner");
        sessionUserIdRef.current = nextUserId;
        setSessionUserId(nextUserId);
        setHasSession(Boolean(session));
        initialized = true;
        setAuthLoading(false);
      })
      .catch((error) => {
        if (!active) return;
        setAuthError(localSessionMode
          ? "Workbench could not open this private session. Check your connection and try again."
          : (error.message || "Unable to check the Workbench session"));
        initialized = true;
        setAuthLoading(false);
      });
    return () => { active = false; unsubscribe(); };
  }, [localSessionMode, localSessionRetry]);

  useEffect(() => {
    document.title = "Workbench — JA Workbench";
  }, []);

  const selectPage = (next) => {
    if (recordingLocked && next !== "Meetings") return;
    setFocusCandidateId("");
    setFocusLeadId("");
    setFocusClient(null);
    setFocusNote(null);
    setPage(next);
  };

  // Opens one candidate for one job in Candidate Review (used by Pipeline and Home).
  const openCandidate = (jobId, personId) => {
    if (recordingLocked) return;
    if (jobId) setRecruiting((prev) => ({ ...(prev || {}), job: { id: String(jobId) } }));
    setFocusLeadId("");
    setFocusClient(null);
    setFocusCandidateId(personId ? String(personId) : "");
    setPage("Candidate Review");
  };

  const navigateFromSearch = (target) => {
    if (!target) return;
    if (recordingLocked && target.page && target.page !== "Meetings") return;

    if (target.entityType === "note") {
      setFocusCandidateId("");
      setFocusLeadId("");
      setFocusClient(null);
      setFocusNote({ noteId: target.focusNoteId || target.entityId || "" });
      setPage("Notes");
      return;
    }

    if (target.entityType === "candidate") {
      setFocusLeadId("");
      setFocusClient(null);
      setFocusNote(null);
      setFocusCandidateId(target.focusCandidateId || target.entityId || "");
      setPage(target.page || "Candidates");
      return;
    }

    if (target.entityType === "lead") {
      setFocusCandidateId("");
      setFocusClient(null);
      setFocusLeadId(target.focusLeadId || target.entityId || "");
      setPage("Leads");
      return;
    }

    if (target.entityType === "client") {
      setFocusCandidateId("");
      setFocusLeadId("");
      setFocusClient(
        target.client || {
          id: target.id,
          entityId: target.entityId,
          company: target.entityId,
          jobTitles: null,
          location: null,
          status: null,
          clientContact: null,
        },
      );
      setPage("Leads");
      return;
    }

    if (target.entityType === "job") {
      setFocusCandidateId("");
      setFocusLeadId("");
      setFocusClient(null);
      setFocusNote(null);
      if (target.job) {
        setRecruiting((current) => ({ ...(current || {}), job: target.job }));
      }
      setPage("Jobs");
      return;
    }

    if (target.page) {
      selectPage(target.page);
    }
  };

  // Opens the record a note is attached to. Only links that passed the subject-link rules reach here.
  const openNoteSubject = (link) => {
    if (!link) return;
    if (recordingLocked && link.page !== "Meetings") return;
    setFocusLeadId("");
    setFocusClient(null);
    setFocusNote(null);
    if (link.type === "candidate") {
      setFocusCandidateId(link.id);
      setPage("Candidates");
      return;
    }
    if (link.type === "job") {
      setFocusCandidateId("");
      setRecruiting((current) => ({
        ...(current || {}),
        job: { id: link.id, loxoJobId: link.id, title: null, company: null, location: null, status: null, description: null },
      }));
      setPage("Jobs");
      return;
    }
    if (link.type === "meeting") {
      setFocusCandidateId("");
      setMeetingLaunch({ phase: "saved", source: "note_directory", meeting: { id: link.id } });
      setPage("Meetings");
    }
  };

  const startCandidateCall = async ({ job, candidate }) => {
    if (callStartRef.current) return;
    callStartRef.current = true;
    const pending = { job, candidate, source: "candidate_call", phase: "starting", error: "" };
    setMeetingLaunch(pending);
    setPage("Meetings");
    try {
      const session = await startCandidateCallSession({ job, candidate, ownerId: sessionUserId });
      setMeetingLaunch(session);
    } catch (error) {
      callStartRef.current = false;
      setMeetingLaunch({ ...pending, phase: "error", error: error.message || "The recorded call could not start." });
    }
  };

  const updateMeetingLaunch = (patch) => {
    if (patch?.phase && !["starting", "recording"].includes(patch.phase)) callStartRef.current = false;
    setMeetingLaunch((current) => ({ ...(current || { source: "meeting" }), ...patch }));
  };

  const handleSignOut = async () => {
    if (recordingLocked) {
      setAuthError("Stop the active meeting recording before signing out.");
      return;
    }
    setSigningOut(true);
    setAuthError("");
    try {
      await signOutWorkbench();
      clearLiveReviewCache();
      setHasSession(false);
    } catch (error) {
      setAuthError(error.message || "Unable to sign out of Workbench");
    } finally {
      setSigningOut(false);
    }
  };

  const openJobReview = (job) => {
    if (recordingLocked) return;
    setRecruiting((current) => ({ ...(current || {}), job }));
    setFocusCandidateId("");
    setPage("Candidate Review");
  };

  const navigateFromHome = (next, item) => {
    const jobId = item?.job_id ?? item?.jobId;
    const personId = candidateReviewIdFromHomeItem(item);
    if (next === "Candidate Review" && jobId) return openCandidate(jobId, personId);
    if (next === "Meetings" && item?.id) {
      setMeetingLaunch({
        phase: "saved",
        source: "recent_meeting",
        meeting: item,
        job: { id: item.jobId },
        candidate: { id: item.candidateId },
      });
      setPage("Meetings");
      return undefined;
    }
    selectPage(next);
  };

  if (authLoading) {
    return <main className="flex min-h-screen items-center justify-center" role="status">{localSessionMode ? "Opening your workspace…" : "Checking Workbench session…"}</main>;
  }
  if (!hasSession) {
    if (localSessionMode) {
      return (
        <main className="flex min-h-screen items-center justify-center bg-background p-4">
          <section className="w-full max-w-md rounded-xl border bg-card p-6 shadow-sm" aria-labelledby="local-session-title">
            <p className="text-sm font-semibold text-muted-foreground">JA Workbench</p>
            <h1 id="local-session-title" className="mt-2 text-2xl font-semibold">Opening your workspace…</h1>
            <p className="mt-3 text-sm text-destructive" role="alert">{authError || "Your private session could not be opened."}</p>
            <button type="button" className="mt-5 min-h-11 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground" onClick={() => { setAuthError(""); setAuthLoading(true); setLocalSessionRetry((value) => value + 1); }}>Try again</button>
          </section>
        </main>
      );
    }
    return <ExistingAccountAccess sessionError={authError} />;
  }

  return <div className="min-h-screen bg-background text-foreground">
    <a href="#workbench-main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:text-foreground focus:shadow-lg focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-ring">Skip to content</a>
    <header data-print-hide className="sticky top-0 z-40 flex min-h-16 flex-wrap items-center gap-3 border-b bg-background/95 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur md:px-6">
      <h1 ref={pageHeadingRef} tabIndex={-1} className="shrink-0 text-lg font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">JA <span className="text-muted-foreground">Workbench</span></h1>
      <div className="min-w-56 flex-1"><HeaderSearch onSelectResult={navigateFromSearch} onNavigatePage={selectPage} /></div>
      <Suspense fallback={null}><ContextPicker value={context} onChange={setContext} /></Suspense>
      <button type="button" onClick={() => selectPage("Settings")} disabled={recordingLocked} title={recordingLocked ? "Stop the active recording before opening Settings" : undefined} className="inline-flex min-h-10 items-center gap-2 rounded-md border px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50" aria-label="Open Settings and Profile"><Settings size={16} />Settings</button>
      <button type="button" onClick={() => window.print()} className="min-h-10 rounded-md border px-3 text-sm font-medium" aria-label="Print current Workbench view">Print</button>
      {!localSessionMode ? <button type="button" onClick={handleSignOut} disabled={signingOut || recordingLocked} title={recordingLocked ? "Stop the active recording before signing out" : undefined} className="min-h-10 rounded-md border px-3 text-sm font-medium disabled:opacity-60">
        {signingOut ? "Signing out…" : "Sign out"}
      </button> : null}
    </header>
    {authError ? <p className="px-4 pt-2 text-sm text-destructive md:px-6" role="alert">{authError}</p> : null}
    <div className="workbench-print-label" aria-hidden="true"><strong>JA Workbench</strong><span>Current view: Workbench</span></div>
    <main id="workbench-main" tabIndex={-1} className="workbench-main min-w-0 overflow-x-clip p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:p-4">
      <PageErrorBoundary key={`${sessionUserId}:${page}`} onHome={() => selectPage("Home")}>
        <Suspense fallback={<PanelFallback />}>
          <WorkbenchOneView
            destination={page}
            selectedJob={recruiting?.job || null}
            focusCandidateId={focusCandidateId}
            focusLeadId={focusLeadId}
            focusClient={focusClient}
            focusNote={focusNote}
            meetingLaunch={meetingLaunch}
            recordingLocked={recordingLocked}
            onNavigate={selectPage}
            onHomeNavigate={navigateFromHome}
            onSelectJob={(job) => setRecruiting((current) => ({ ...(current || {}), job }))}
            onOpenCandidate={openCandidate}
            onOpenJobReview={openJobReview}
            onStartCandidateCall={startCandidateCall}
            onMeetingLaunchChange={updateMeetingLaunch}
            onOpenNoteSubject={openNoteSubject}
            recentMeetingsLoader={loadRecentMeetings}
            meetingsStatusLoader={getMeetingStatus}
          />
        </Suspense>
      </PageErrorBoundary>
    </main>
  </div>;
}
