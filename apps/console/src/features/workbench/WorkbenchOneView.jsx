import { Component, lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "../../components/ui/button.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs.tsx";

const CandidateReview = lazy(() => import("../candidate-review/CandidateReview.jsx"));
const PipelinePage = lazy(() => import("../pipeline/PipelinePage.jsx"));
const HomePage = lazy(() => import("../home/HomePage.jsx"));
const MeetingsWorkspace = lazy(() => import("../meetings/MeetingsWorkspace.jsx"));
const RecruitingWorkspace = lazy(() => import("../recruiting/RecruitingWorkspace.jsx"));
const ProcessPage = lazy(() => import("../recruiting/ProcessPage.jsx"));
const LeadsPage = lazy(() => import("../leads/LeadsPage.jsx"));
const MailPage = lazy(() => import("../mail/MailPage.jsx"));
const NotesDirectory = lazy(() => import("../notes/NotesDirectory.jsx"));
const SettingsPage = lazy(() => import("../settings/SettingsPage.jsx"));
const ProfilePage = lazy(() => import("../profile/ProfilePage.jsx"));
const JobRail = lazy(() => import("./JobRail.jsx"));

const UTILITY_DESTINATIONS = new Set(["Jobs", "Process", "Leads", "Notes", "Settings", "Profile"]);

function LoadingPanel() {
  return <div className="min-h-40 rounded-lg border border-dashed p-4 text-sm text-muted-foreground" role="status">Loading panel…</div>;
}

class PanelBoundary extends Component {
  state = { error: false };

  static getDerivedStateFromError() { return { error: true }; }

  render() {
    if (!this.state.error) return this.props.children;
    return <section className="rounded-xl border border-destructive/30 bg-destructive/5 p-4" role="alert">
      <h2 className="font-semibold">{this.props.name} could not be loaded</h2>
      <p className="mt-1 text-sm text-muted-foreground">The rest of Workbench is still available.</p>
      <Button type="button" className="mt-3" size="sm" variant="outline" onClick={() => this.setState({ error: false })}>Try again</Button>
    </section>;
  }
}

function destinationForWorkView(value) {
  if (value === "board") return "Pipeline";
  if (value === "swipe") return "Candidate Review";
  return "Candidates";
}

function useDesktopLayout() {
  const [desktop, setDesktop] = useState(() => globalThis.matchMedia?.("(min-width: 1280px)").matches ?? true);
  useEffect(() => {
    const query = globalThis.matchMedia?.("(min-width: 1280px)");
    if (!query) return undefined;
    const update = () => setDesktop(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return desktop;
}

function UtilityPanel({ destination, selectedJob, focusLeadId, focusClient, focusNote, meetingsStatusLoader, onSelectJob, onOpenJobReview, onOpenNoteSubject, onClose }) {
  const [settingsTab, setSettingsTab] = useState(destination === "Profile" ? "profile" : "settings");
  const panelRef = useRef(null);
  useEffect(() => {
    if (destination === "Profile") setSettingsTab("profile");
    if (destination === "Settings") setSettingsTab("settings");
  }, [destination]);
  useEffect(() => {
    const previous = document.activeElement;
    panelRef.current?.focus();
    const closeOnEscape = (event) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      previous?.focus?.();
    };
  }, [onClose]);

  let content = null;
  if (destination === "Jobs") content = <RecruitingWorkspace page="Jobs" value={{ job: selectedJob }} onChange={(value) => onSelectJob(value?.job || null)} onOpenJobReview={onOpenJobReview} />;
  if (destination === "Process") content = <ProcessPage />;
  if (destination === "Leads") content = <LeadsPage focusLeadId={focusLeadId} focusClient={focusClient} />;
  if (destination === "Mail") content = <MailPage />;
  if (destination === "Notes") content = <NotesDirectory focusRequest={focusNote} onOpenSubject={onOpenNoteSubject} />;
  if (destination === "Settings" || destination === "Profile") content = <Tabs value={settingsTab} onValueChange={setSettingsTab} className="min-h-0 flex-col">
    <TabsList aria-label="Settings and Profile"><TabsTrigger value="settings">Settings</TabsTrigger><TabsTrigger value="profile">Profile</TabsTrigger></TabsList>
    <TabsContent value="settings"><SettingsPage meetingsStatusLoader={meetingsStatusLoader} /></TabsContent>
    <TabsContent value="profile"><ProfilePage /></TabsContent>
  </Tabs>;

  return <section ref={panelRef} role="dialog" aria-modal="false" aria-labelledby="utility-panel-title" tabIndex={-1} className="absolute inset-0 z-20 overflow-auto bg-background p-3 outline-none md:p-4">
    <div className="mb-3 flex items-center justify-between gap-3 border-b pb-3">
      <h2 id="utility-panel-title" className="text-lg font-semibold">{destination === "Jobs" ? "Jobs map" : destination}</h2>
      <Button type="button" size="sm" variant="outline" onClick={onClose}><X size={15} />Close</Button>
    </div>
    <Suspense fallback={<LoadingPanel />}>{content}</Suspense>
  </section>;
}

export default function WorkbenchOneView({
  destination,
  selectedJob,
  focusCandidateId,
  focusLeadId,
  focusClient,
  focusNote,
  meetingLaunch,
  recordingLocked = false,
  onNavigate,
  onHomeNavigate,
  onSelectJob,
  onOpenCandidate,
  onOpenJobReview,
  onStartCandidateCall,
  onMeetingLaunchChange,
  onOpenNoteSubject,
  recentMeetingsLoader,
  meetingsStatusLoader,
}) {
  const [workView, setWorkView] = useState(() => destination === "Pipeline" ? "board" : destination === "Candidate Review" ? "swipe" : "people");
  const [mobileTab, setMobileTab] = useState(() => destination === "Meetings" ? "meetings" : destination === "Home" || destination === "Mail" ? "today" : "work");
  const desktop = useDesktopLayout();

  useEffect(() => {
    if (destination === "Pipeline") setWorkView("board");
    if (destination === "Candidate Review") setWorkView("swipe");
    if (destination === "Candidates") setWorkView("people");
  }, [destination]);
  useEffect(() => {
    if (recordingLocked) {
      setMobileTab("meetings");
      return;
    }
    if (destination === "Meetings") setMobileTab("meetings");
    else if (destination === "Notes") setMobileTab("work");
    else if (destination === "Home" || destination === "Mail") setMobileTab("today");
    else setMobileTab("work");
  }, [destination, recordingLocked]);

  const utilityOpen = UTILITY_DESTINATIONS.has(destination);
  const chooseWorkView = (value) => {
    if (recordingLocked) return;
    setWorkView(value);
    onNavigate(destinationForWorkView(value));
  };
  const closeUtility = useCallback(() => onNavigate(destinationForWorkView(workView)), [onNavigate, workView]);
  const navigateFromToday = (next, item) => onHomeNavigate(next, item);

  const jobsPanel = <PanelBoundary name="Jobs"><Suspense fallback={<LoadingPanel />}><JobRail
    selectedJob={selectedJob}
    onSelectJob={onSelectJob}
    onOpenMap={() => onNavigate("Jobs")}
    onOpenProcess={() => onNavigate("Process")}
    onOpenLeads={() => onNavigate("Leads")}
    disabled={recordingLocked}
  /></Suspense></PanelBoundary>;

  const workPanel = <PanelBoundary name="Candidate work"><section className="relative h-full min-h-0 min-w-0 overflow-hidden rounded-xl border bg-card" aria-label="Candidate work">
    <Tabs value={workView} onValueChange={chooseWorkView} className="h-full min-h-0 flex-col gap-0 overflow-hidden" inert={utilityOpen ? true : undefined} aria-hidden={utilityOpen ? "true" : undefined}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-3">
        <div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Work</p><h2 className="sr-only">Candidate work</h2></div>
        <TabsList aria-label="Candidate view"><TabsTrigger value="people" disabled={recordingLocked}>People</TabsTrigger><TabsTrigger value="swipe" disabled={recordingLocked}>Swipe</TabsTrigger><TabsTrigger value="board" disabled={recordingLocked}>Pipeline</TabsTrigger></TabsList>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3 md:p-4">
        <Suspense fallback={<LoadingPanel />}>
          {workView === "people" ? <TabsContent value="people"><CandidateReview key="people" initialView="people" selectedJob={selectedJob} focusCandidateId={focusCandidateId} onSelectJob={onSelectJob} onNavigateJobsMap={() => onNavigate("Jobs")} onStartCandidateCall={onStartCandidateCall} /></TabsContent> : null}
          {workView === "swipe" ? <TabsContent value="swipe"><CandidateReview key="swipe" initialView="swipe" selectedJob={selectedJob} focusCandidateId={focusCandidateId} onSelectJob={onSelectJob} onNavigateJobsMap={() => onNavigate("Jobs")} onStartCandidateCall={onStartCandidateCall} /></TabsContent> : null}
          {workView === "board" ? <TabsContent value="board"><PipelinePage selectedJob={selectedJob} onSelectJob={onSelectJob} onOpenCandidate={onOpenCandidate} /></TabsContent> : null}
        </Suspense>
      </div>
    </Tabs>
    {utilityOpen ? <UtilityPanel destination={destination} selectedJob={selectedJob} focusLeadId={focusLeadId} focusClient={focusClient} focusNote={focusNote} meetingsStatusLoader={meetingsStatusLoader} onSelectJob={onSelectJob} onOpenJobReview={onOpenJobReview} onOpenNoteSubject={onOpenNoteSubject} onClose={closeUtility} /> : null}
  </section></PanelBoundary>;

  const todayPanel = <PanelBoundary name="Today"><section className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border bg-card p-3" aria-label="Today">
    <div className="min-h-0 flex-1 overflow-y-auto"><Suspense fallback={<LoadingPanel />}><div className="grid gap-5"><HomePage onNavigate={navigateFromToday} recentMeetingsLoader={recentMeetingsLoader} /><MailPage /></div></Suspense></div>
  </section></PanelBoundary>;

  const meetingsPanel = <PanelBoundary name="Meetings"><section className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border bg-card p-3" aria-label="Meetings and notes">
    <div className="min-h-0 flex-1 overflow-y-auto"><Suspense fallback={<LoadingPanel />}><MeetingsWorkspace launchContext={meetingLaunch} selectedJob={selectedJob} onLaunchChange={onMeetingLaunchChange} /></Suspense></div>
  </section></PanelBoundary>;

  return <div className={`grid min-w-0 gap-3 ${desktop ? "h-[calc(100dvh-6rem)] min-h-0 overflow-hidden" : ""}`} style={desktop
    ? { gridTemplateColumns: "minmax(200px, 240px) minmax(0, 1fr) minmax(240px, 320px)", gridTemplateRows: "minmax(0, 1fr)", height: "calc(100dvh - 6rem)" }
    : { gridTemplateColumns: "minmax(0, 1fr)" }} data-testid="workbench-one-view">
    <div className="contents">{!desktop ? <Tabs value={mobileTab} onValueChange={(value) => { if (!recordingLocked) setMobileTab(value); }} className="min-w-0 flex-col gap-3">
      <TabsList className="sticky top-[4.5rem] z-30 grid h-10 w-full max-w-full shrink-0 grid-cols-3" aria-label="Workbench panels"><TabsTrigger className="h-full" value="today" disabled={recordingLocked}>Today</TabsTrigger><TabsTrigger className="h-full" value="work" disabled={recordingLocked}>Work</TabsTrigger><TabsTrigger className="h-full" value="meetings">Meetings</TabsTrigger></TabsList>
    </Tabs> : null}</div>
    <div className={desktop ? "h-full min-h-0 min-w-0" : mobileTab === "work" ? "min-h-0 min-w-0" : "hidden"}>{jobsPanel}</div>
    <div className={desktop ? "h-full min-h-0 min-w-0" : mobileTab === "work" ? "min-h-0 min-w-0" : "hidden"}>{workPanel}</div>
    <aside className={`min-h-0 min-w-0 gap-3 ${desktop ? "grid h-full overflow-hidden" : "grid"}`} style={desktop ? { gridTemplateRows: "minmax(0, 1fr) minmax(0, 1fr)" } : undefined} aria-label="Today and meetings">
      <div className={desktop || mobileTab === "today" ? "min-h-0 min-w-0" : "hidden"}>{todayPanel}</div>
      <div className={desktop || mobileTab === "meetings" ? "min-h-0 min-w-0" : "hidden"}>{meetingsPanel}</div>
    </aside>
  </div>;
}
