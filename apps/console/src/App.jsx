import { lazy, Suspense, useState } from "react";
import { Briefcase, CalendarDays, GitBranch, Home, Settings, Users, Contact, UserCheck } from "lucide-react";
import { SidebarProvider, Sidebar, SidebarHeader, SidebarContent, SidebarGroup, SidebarGroupLabel, SidebarGroupContent, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarInset, SidebarTrigger } from "./components/ui/sidebar.tsx";
import { Skeleton } from "./components/ui/skeleton.tsx";

const ContextPicker = lazy(() => import("./ContextPicker.jsx"));
const EmptyWorkspace = lazy(() => import("./EmptyWorkspace.jsx"));
const GoogleWorkspacePanel = lazy(() => import("./components/GoogleWorkspacePanel.jsx").then((module) => ({ default: module.GoogleWorkspacePanel })));
const RecruitingWorkspace = lazy(() => import("./features/recruiting/RecruitingWorkspace.jsx"));
const CandidateReview = lazy(() => import("./features/candidate-review/CandidateReview.jsx"));
const MeetingsWorkspace = lazy(() => import("./features/meetings/MeetingsWorkspace.jsx"));
const areas = [["Home", Home], ["Candidates", Users], ["Leads", Contact], ["Jobs", Briefcase], ["Candidate Review", UserCheck], ["Meetings", CalendarDays], ["Process", GitBranch], ["Settings", Settings]];

function PanelFallback() { return <div className="min-h-[520px] rounded-lg border p-6" role="status" aria-label="Loading workspace"><Skeleton className="h-6 w-48" /><Skeleton className="mt-4 h-24 w-full" /></div>; }

export default function App() {
  const [page, setPage] = useState("Home");
  const [context, setContext] = useState("Independent recruiting");
  const [recruiting, setRecruiting] = useState(null);
  const recruitingPage = ["Jobs", "Candidates", "Process"].includes(page);
  return <SidebarProvider><Sidebar><SidebarHeader><div className="px-2 py-3 text-lg font-semibold">JA <span className="text-muted-foreground">Workbench</span></div></SidebarHeader><SidebarContent><SidebarGroup><SidebarGroupLabel>Work areas</SidebarGroupLabel><SidebarGroupContent><SidebarMenu>{areas.slice(0, 6).map(([label, Icon]) => <SidebarMenuItem key={label}><SidebarMenuButton isActive={page === label} onClick={() => setPage(label)}><Icon /><span>{label}</span></SidebarMenuButton></SidebarMenuItem>)}</SidebarMenu></SidebarGroupContent></SidebarGroup><SidebarGroup><SidebarGroupLabel>Supporting</SidebarGroupLabel><SidebarGroupContent><SidebarMenu>{areas.slice(6).map(([label, Icon]) => <SidebarMenuItem key={label}><SidebarMenuButton isActive={page === label} onClick={() => setPage(label)}><Icon /><span>{label}</span></SidebarMenuButton></SidebarMenuItem>)}</SidebarMenu></SidebarGroupContent></SidebarGroup></SidebarContent></Sidebar><SidebarInset className="min-w-0"><header className="flex min-h-16 flex-wrap items-center gap-3 border-b px-4 py-3"><SidebarTrigger /><div className="min-w-0 flex-1"><h1 className="truncate text-xl font-semibold">{page}</h1></div><Suspense fallback={null}><ContextPicker value={context} onChange={setContext} /></Suspense></header><main className="flex min-w-0 flex-1 flex-col gap-4 overflow-x-clip p-4 md:p-6"><Suspense fallback={<PanelFallback />}>{page === "Candidate Review" ? <CandidateReview selectedJob={recruiting?.job} onSelectJob={(job) => setRecruiting((prev) => ({ ...(prev || {}), job }))} onNavigateJobsMap={() => setPage("Jobs")} /> : page === "Meetings" ? <MeetingsWorkspace /> : recruitingPage ? <RecruitingWorkspace page={page} value={recruiting} onChange={setRecruiting} /> : page === "Settings" ? <GoogleWorkspacePanel /> : <EmptyWorkspace page={page} />}</Suspense></main></SidebarInset></SidebarProvider>;
}
