import { UserCog, Users } from "lucide-react";
import HomePage from "../features/home/HomePage.jsx";
import LeadsPage from "../features/leads/LeadsPage.jsx";
import MailPage from "../features/mail/MailPage.jsx";
import ProcessPage from "../features/recruiting/ProcessPage.jsx";
import SettingsPage from "../features/settings/SettingsPage.jsx";
import ProfilePage from "../features/profile/ProfilePage.jsx";

function EmptyPage({ icon: Icon, title, message }) {
  return (
    <section className="page-panel">
      <div className="empty-state page-empty">
        <Icon size={28} aria-hidden="true" />
        <h2>{title}</h2>
        <p>{message}</p>
      </div>
    </section>
  );
}

export function CandidatesPage() {
  return <EmptyPage icon={Users} title="No candidate profiles" message="No candidate data has been connected or added." />;
}

export function StaffPage() {
  return <EmptyPage icon={UserCog} title="No staff profiles" message="No staff data has been added." />;
}

export { HomePage, LeadsPage, MailPage, ProcessPage, ProfilePage, SettingsPage };
