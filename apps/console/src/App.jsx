import { useState, useCallback } from "react";
import { LayoutGrid, Check } from "lucide-react";
import Navigation from "./components/Navigation.jsx";
import HomeWidgets from "./components/HomeWidgets.jsx";
import CandidateWorkspace from "./components/CandidateWorkspace.jsx";
import MailInbox from "./components/MailInbox.jsx";
import { CandidatesPage, JobsPage, CompaniesPage, ProcessPage, StaffPage, ProfilePage, SettingsPage } from "./components/PageStubs.jsx";

const PAGE_TITLES = {
  home: "Home",
  mail: "Mail",
  candidates: "Candidates",
  jobs: "Jobs",
  companies: "Companies",
  process: "Process",
  staff: "Staff",
  profile: "Profile",
  settings: "Settings",
};

function App() {
  const [page, setPage] = useState("home");
  const [companiesFilter, setCompaniesFilter] = useState(null);
  const [candidatePanel, setCandidatePanel] = useState(null);
  const [arrangeMode, setArrangeMode] = useState(false);

  const navigateTo = useCallback((p, opts) => {
    setPage(p);
    setCompaniesFilter(p === "companies" && opts?.filter ? opts.filter : null);
    if (p !== "home") {
      setArrangeMode(false);
      setCandidatePanel(null);
    }
  }, []);

  const openCandidate = useCallback((c) => setCandidatePanel(c), []);
  const closeCandidate = useCallback(() => setCandidatePanel(null), []);

  const greeting = getGreeting();

  return (
    <div className="app-shell">
      <Navigation active={page} onNavigate={navigateTo} />
      <main>
        <header>
          <div>
            <span className="eyebrow">JA STUDIO CONSULTING</span>
            <h1>{PAGE_TITLES[page]}</h1>
            {page === "home" && <p className="greeting">{greeting}</p>}
          </div>
          <div className="header-actions">
            {page === "home" && (
              <button
                className={`arrange-toggle ${arrangeMode ? "active" : ""}`}
                onClick={() => setArrangeMode(!arrangeMode)}
                aria-pressed={arrangeMode}
              >
                {arrangeMode ? <><Check size={15} /> Done</> : <><LayoutGrid size={15} /> Arrange layout</>}
              </button>
            )}
          </div>
        </header>

        {page === "home" && <HomeWidgets arrangeMode={arrangeMode} onOpenCandidate={openCandidate} onNavigate={navigateTo} />}
        {page === "mail" && <MailInbox />}
        {page === "candidates" && <CandidatesPage />}
        {page === "jobs" && <JobsPage />}
        {page === "companies" && <CompaniesPage filter={companiesFilter} />}
        {page === "process" && <ProcessPage />}
        {page === "staff" && <StaffPage />}
        {page === "profile" && <ProfilePage />}
        {page === "settings" && <SettingsPage />}
      </main>

      {candidatePanel && <CandidateWorkspace candidate={candidatePanel} onClose={closeCandidate} />}
    </div>
  );
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning, Ja.";
  if (h < 17) return "Good afternoon, Ja.";
  return "Good evening, Ja.";
}

export default App;
