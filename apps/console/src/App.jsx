import { useState } from "react";
import Navigation from "./components/Navigation.jsx";
import HomeWidgets from "./components/HomeWidgets.jsx";
import MailInbox from "./components/MailInbox.jsx";
import {
  CandidatesPage,
  LeadsPage,
  ProcessPage,
  StaffPage,
  ProfilePage,
  SettingsPage,
} from "./components/PageStubs.jsx";

const PAGE_TITLES = {
  home: "Home",
  mail: "Mail",
  candidates: "Candidates",
  leads: "Leads",
  process: "Process",
  staff: "Staff",
  profile: "Profile",
  settings: "Settings",
};

function App() {
  const [page, setPage] = useState("home");

  return (
    <div className="app-shell">
      <Navigation active={page} onNavigate={setPage} />
      <main>
        <header className="page-header">
          <div>
            <span className="eyebrow">JA STUDIO CONSULTING</span>
            <h1>{PAGE_TITLES[page]}</h1>
          </div>
        </header>

        {page === "home" && <HomeWidgets />}
        {page === "mail" && <MailInbox />}
        {page === "candidates" && <CandidatesPage />}
        {page === "leads" && <LeadsPage />}
        {page === "process" && <ProcessPage />}
        {page === "staff" && <StaffPage />}
        {page === "profile" && <ProfilePage />}
        {page === "settings" && <SettingsPage />}
      </main>
    </div>
  );
}

export default App;
