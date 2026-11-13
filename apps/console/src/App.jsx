import { Component, lazy, Suspense, useEffect, useRef, useState } from "react";
import { Briefcase, CalendarDays, Columns3, Contact, GitBranch, Home, Mail, Settings, StickyNote, UserCheck, UserRound, Users } from "lucide-react";
import { SidebarProvider, Sidebar, SidebarHeader, SidebarContent, SidebarGroup, SidebarGroupLabel, SidebarGroupContent, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarInset, SidebarTrigger, useSidebar } from "./components/ui/sidebar.tsx";
import { Skeleton } from "./components/ui/skeleton.tsx";
import ExistingAccountAccess from "./ExistingAccountAccess.jsx";
import { getWorkbenchSession, signOutWorkbench, subscribeToWorkbenchSession } from "./supabase-auth.js";
import { getVerifiedLocalWorkbenchSession, openLocalWorkbenchSession } from "./local-session.js";
import { startCandidateCallSession } from "./features/meetings/candidateCallSession.js";
import { getMeetingStatus } from "./features/meetings/meetingGatewayClient.js";
import HeaderSearch from "./features/search/HeaderSearch.jsx";
import { candidateReviewIdFromHomeItem } from "./features/home/homeNavigation.js";

const ContextPicker = lazy(() => import("./ContextPicker.jsx"));
const EmptyWorkspace = lazy(() => import("./EmptyWorkspace.jsx"));
const RecruitingWorkspace = lazy(() => import("./features/recruiting/RecruitingWorkspace.jsx"));
const CandidateReview = lazy(() => import("./features/candidate-review/CandidateReview.jsx"));
const MeetingsWorkspace = lazy(() => import("./features/meetings/MeetingsWorkspace.jsx"));
const PipelinePage = lazy(() => import("./features/pipeline/PipelinePage.jsx"));
const HomePage = lazy(() => import("./features/home/HomePage.jsx"));
const LeadsPage = lazy(() => import("./features/leads/LeadsPage.jsx"));
const MailPage = lazy(() => import("./features/mail/MailPage.jsx"));
const SettingsPage = lazy(() => import("./features/settings/SettingsPage.jsx"));
const ProfilePage = lazy(() => import("./features/profile/ProfilePage.jsx"));
const NotesDirectory = lazy(() => import("./features/notes/NotesDirectory.jsx"));

const workAreas = [["Home", Home], ["Candidates", Users], ["Candidate Review", UserCheck], ["Pipeline", Columns3], ["Leads", Contact], ["Jobs", Briefcase], ["Meetings", CalendarDays], ["Notes", StickyNote], ["Mail", Mail]];
const supporting = [["Process", GitBranch], ["Settings", Settings], ["Profile", UserRound]];

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

function NavGroup({ label, items, page, onSelect, recordingLocked = false }) {
  const { isMobile, setOpenMobile } = useSidebar();
  const selectItem = (name) => {
    onSelect(name);
    if (isMobile && !(recordingLocked && name !== "Meetings")) setOpenMobile(false);
  };
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map(([name, Icon]) => (
            <SidebarMenuItem key={name}>
              <SidebarMenuButton isActive={page === name} size="lg" disabled={recordingLocked && name !== "Meetings"} title={recordingLocked && name !== "Meetings" ? "Stop the active recording before leaving Meetings" : undefined} onClick={() => selectItem(name)}><Icon /><span>{name}</span></SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
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
    document.title = `${page} — JA Workbench`;
    if (page !== "Home") pageHeadingRef.current?.focus();
  }, [page]);

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

  const renderPage = () => {
    switch (page) {
      case "Home": return <HomePage onNavigate={navigateFromHome} recentMeetingsLoader={loadRecentMeetings} />;
      case "Candidates":
      case "Candidate Review":
        return <CandidateReview key={page} initialView={page === "Candidates" ? "people" : "swipe"} selectedJob={recruiting?.job} focusCandidateId={focusCandidateId} onSelectJob={(job) => setRecruiting((prev) => ({ ...(prev || {}), job }))} onNavigateJobsMap={() => selectPage("Jobs")} onStartCandidateCall={startCandidateCall} />;
      case "Pipeline": return <PipelinePage onOpenCandidate={openCandidate} />;
      case "Leads": return <LeadsPage focusLeadId={focusLeadId} focusClient={focusClient} />;
      case "Jobs":
      case "Process":
        return <RecruitingWorkspace page={page} value={recruiting} onChange={setRecruiting} onOpenJobReview={openJobReview} />;
      case "Meetings": return <MeetingsWorkspace launchContext={meetingLaunch} onLaunchChange={updateMeetingLaunch} />;
      case "Notes": return <NotesDirectory focusRequest={focusNote} onOpenSubject={openNoteSubject} />;
      case "Mail": return <MailPage />;
      case "Settings": return <SettingsPage meetingsStatusLoader={getMeetingStatus} />;
      case "Profile": return <ProfilePage />;
      default: return <EmptyWorkspace page={page} />;
    }
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

  return (
    <SidebarProvider>
      <a href="#workbench-main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:text-foreground focus:shadow-lg focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-ring">Skip to content</a>
      <Sidebar data-print-hide>
        <SidebarHeader><div className="px-2 py-3 text-lg font-semibold">JA <span className="text-muted-foreground">Workbench</span></div></SidebarHeader>
        <SidebarContent>
          <NavGroup label="Work areas" items={workAreas} page={page} onSelect={selectPage} recordingLocked={recordingLocked} />
          <NavGroup label="Supporting" items={supporting} page={page} onSelect={selectPage} recordingLocked={recordingLocked} />
        </SidebarContent>
      </Sidebar>
      <SidebarInset className="min-w-0">
        <header data-print-hide className="flex min-h-16 flex-wrap items-center gap-3 border-b px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <SidebarTrigger />
          <div className="min-w-0 flex-1"><h1 ref={pageHeadingRef} tabIndex={-1} className="truncate text-xl font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{page}</h1></div>
          <HeaderSearch onSelectResult={navigateFromSearch} onNavigatePage={selectPage} />
          <Suspense fallback={null}><ContextPicker value={context} onChange={setContext} /></Suspense>
          <button type="button" onClick={() => window.print()} className="min-h-10 rounded-md border px-3 text-sm font-medium" aria-label={`Print current view: ${page}`}>Print current view</button>
          {!localSessionMode ? <button type="button" onClick={handleSignOut} disabled={signingOut || recordingLocked} title={recordingLocked ? "Stop the active recording before signing out" : undefined} className="min-h-10 rounded-md border px-3 text-sm font-medium disabled:opacity-60">
            {signingOut ? "Signing out…" : "Sign out"}
          </button> : null}
        </header>
        {authError ? <p className="px-4 pt-2 text-sm text-destructive" role="alert">{authError}</p> : null}
        <div className="workbench-print-label" aria-hidden="true"><strong>JA Workbench</strong><span>Current view: {page}</span></div>
        <main id="workbench-main" tabIndex={-1} className="workbench-main flex min-w-0 flex-1 flex-col gap-4 overflow-x-clip p-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:p-6">
          <PageErrorBoundary key={`${sessionUserId}:${page}`} onHome={() => selectPage("Home")}>
            <Suspense fallback={<PanelFallback />}>{renderPage()}</Suspense>
          </PageErrorBoundary>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
