import { lazy, Suspense, useState } from "react";
import { Briefcase, CalendarDays, Columns3, Contact, GitBranch, Home, Mail, Settings, UserCheck, UserRound, Users } from "lucide-react";
import { SidebarProvider, Sidebar, SidebarHeader, SidebarContent, SidebarGroup, SidebarGroupLabel, SidebarGroupContent, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarInset, SidebarTrigger } from "./components/ui/sidebar.tsx";
import { Skeleton } from "./components/ui/skeleton.tsx";

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

function NavGroup({ label, items, page, onSelect }) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map(([name, Icon]) => (
            <SidebarMenuItem key={name}>
              <SidebarMenuButton isActive={page === name} onClick={() => onSelect(name)}><Icon /><span>{name}</span></SidebarMenuButton>
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

  const selectPage = (next) => {
    setFocusCandidateId("");
    setPage(next);
  };

  // Opens one candidate for one job in Candidate Review (used by Pipeline and Home).
  const openCandidate = (jobId, personId) => {
    if (jobId) setRecruiting((prev) => ({ ...(prev || {}), job: { id: String(jobId) } }));
    setFocusCandidateId(personId ? String(personId) : "");
    setPage("Candidate Review");
  };

  const navigateFromHome = (next, item) => {
    const jobId = item?.job_id ?? item?.jobId;
    const personId = item?.person_id ?? item?.personId;
    if (next === "Candidate Review" && jobId) return openCandidate(jobId, personId);
    selectPage(next);
  };

  const renderPage = () => {
    switch (page) {
      case "Home": return <HomePage onNavigate={navigateFromHome} recentMeetingsLoader={loadRecentMeetings} />;
      case "Candidates":
      case "Candidate Review":
        return <CandidateReview key={page} initialView={page === "Candidates" ? "people" : "swipe"} selectedJob={recruiting?.job} focusCandidateId={page === "Candidate Review" ? focusCandidateId : ""} onSelectJob={(job) => setRecruiting((prev) => ({ ...(prev || {}), job }))} onNavigateJobsMap={() => selectPage("Jobs")} />;
      case "Pipeline": return <PipelinePage onOpenCandidate={openCandidate} />;
      case "Leads": return <LeadsPage />;
      case "Jobs":
      case "Process":
        return <RecruitingWorkspace page={page} value={recruiting} onChange={setRecruiting} />;
      case "Meetings": return <MeetingsWorkspace />;
      case "Mail": return <MailPage />;
      case "Settings": return <SettingsPage />;
      case "Profile": return <ProfilePage />;
      default: return <EmptyWorkspace page={page} />;
    }
  };

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader><div className="px-2 py-3 text-lg font-semibold">JA <span className="text-muted-foreground">Workbench</span></div></SidebarHeader>
        <SidebarContent>
          <NavGroup label="Work areas" items={workAreas} page={page} onSelect={selectPage} />
          <NavGroup label="Supporting" items={supporting} page={page} onSelect={selectPage} />
        </SidebarContent>
      </Sidebar>
      <SidebarInset className="min-w-0">
        <header className="flex min-h-16 flex-wrap items-center gap-3 border-b px-4 py-3">
          <SidebarTrigger />
          <div className="min-w-0 flex-1"><h1 className="truncate text-xl font-semibold">{page}</h1></div>
          <Suspense fallback={null}><ContextPicker value={context} onChange={setContext} /></Suspense>
        </header>
        <main className="flex min-w-0 flex-1 flex-col gap-4 overflow-x-clip p-4 md:p-6">
          <Suspense fallback={<PanelFallback />}>{renderPage()}</Suspense>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
