import { lazy, Suspense, useRef, useState } from "react";
import { Briefcase, CalendarDays, Columns3, Contact, GitBranch, Home, Mail, Settings, UserCheck, UserRound, Users } from "lucide-react";
import { SidebarProvider, Sidebar, SidebarHeader, SidebarContent, SidebarGroup, SidebarGroupLabel, SidebarGroupContent, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarInset, SidebarTrigger, useSidebar } from "./components/ui/sidebar.tsx";
import { Skeleton } from "./components/ui/skeleton.tsx";
import { startCandidateCallSession } from "./features/meetings/candidateCallSession.js";
import { getMeetingStatus } from "./features/meetings/meetingGatewayClient.js";

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

const workAreas = [["Home", Home], ["Candidates", Users], ["Candidate Review", UserCheck], ["Pipeline", Columns3], ["Leads", Contact], ["Jobs", Briefcase], ["Meetings", CalendarDays], ["Mail", Mail]];
const supporting = [["Process", GitBranch], ["Settings", Settings], ["Profile", UserRound]];

const loadRecentMeetings = () => import("./features/meetings/meetingStore.js").then((module) => module.listRecentMeetings());

function PanelFallback() { return <div className="min-h-[520px] rounded-lg border p-6" role="status" aria-label="Loading workspace"><Skeleton className="h-6 w-48" /><Skeleton className="mt-4 h-24 w-full" /></div>; }

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
  const [page, setPage] = useState("Home");
  const [context, setContext] = useState("Independent recruiting");
  const [recruiting, setRecruiting] = useState(null);
  const [focusCandidateId, setFocusCandidateId] = useState("");
  const [meetingLaunch, setMeetingLaunch] = useState(null);
  const callStartRef = useRef(false);
  const recordingLocked = ["starting", "recording", "finalizing"].includes(meetingLaunch?.phase);

  const selectPage = (next) => {
    if (recordingLocked && next !== "Meetings") return;
    setFocusCandidateId("");
    setPage(next);
  };

  // Opens one candidate for one job in Candidate Review (used by Pipeline and Home).
  const openCandidate = (jobId, personId) => {
    if (jobId) setRecruiting((prev) => ({ ...(prev || {}), job: { id: String(jobId) } }));
    setFocusCandidateId(personId ? String(personId) : "");
    setPage("Candidate Review");
  };

  const startCandidateCall = async ({ job, candidate }) => {
    if (callStartRef.current) return;
    callStartRef.current = true;
    const pending = { job, candidate, source: "candidate_call", phase: "starting", error: "" };
    setMeetingLaunch(pending);
    setPage("Meetings");
    try {
      const session = await startCandidateCallSession({ job, candidate });
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

  const openJobReview = (job) => {
    setRecruiting((current) => ({ ...(current || {}), job }));
    setFocusCandidateId("");
    setPage("Candidate Review");
  };

  const navigateFromHome = (next, item) => {
    const jobId = item?.job_id ?? item?.jobId;
    const personId = item?.person_id ?? item?.personId;
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
        return <CandidateReview key={page} initialView={page === "Candidates" ? "people" : "swipe"} selectedJob={recruiting?.job} focusCandidateId={page === "Candidate Review" ? focusCandidateId : ""} onSelectJob={(job) => setRecruiting((prev) => ({ ...(prev || {}), job }))} onNavigateJobsMap={() => selectPage("Jobs")} onStartCandidateCall={startCandidateCall} />;
      case "Pipeline": return <PipelinePage onOpenCandidate={openCandidate} />;
      case "Leads": return <LeadsPage />;
      case "Jobs":
      case "Process":
        return <RecruitingWorkspace page={page} value={recruiting} onChange={setRecruiting} onOpenJobReview={openJobReview} />;
      case "Meetings": return <MeetingsWorkspace launchContext={meetingLaunch} onLaunchChange={updateMeetingLaunch} />;
      case "Mail": return <MailPage />;
      case "Settings": return <SettingsPage meetingsStatusLoader={getMeetingStatus} />;
      case "Profile": return <ProfilePage />;
      default: return <EmptyWorkspace page={page} />;
    }
  };

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader><div className="px-2 py-3 text-lg font-semibold">JA <span className="text-muted-foreground">Workbench</span></div></SidebarHeader>
        <SidebarContent>
          <NavGroup label="Work areas" items={workAreas} page={page} onSelect={selectPage} recordingLocked={recordingLocked} />
          <NavGroup label="Supporting" items={supporting} page={page} onSelect={selectPage} recordingLocked={recordingLocked} />
        </SidebarContent>
      </Sidebar>
      <SidebarInset className="min-w-0">
        <header className="flex min-h-16 flex-wrap items-center gap-3 border-b px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <SidebarTrigger />
          <div className="min-w-0 flex-1"><h1 className="truncate text-xl font-semibold">{page}</h1></div>
          <Suspense fallback={null}><ContextPicker value={context} onChange={setContext} /></Suspense>
        </header>
        <main className="flex min-w-0 flex-1 flex-col gap-4 overflow-x-clip p-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:p-6">
          <Suspense fallback={<PanelFallback />}>{renderPage()}</Suspense>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
