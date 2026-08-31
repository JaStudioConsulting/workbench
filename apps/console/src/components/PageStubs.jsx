import { Contact, GitBranch, User, UserCog, Users } from "lucide-react";
import { GoogleWorkspacePanel } from "./GoogleWorkspacePanel.jsx";

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

export function LeadsPage() {
  return <EmptyPage icon={Contact} title="No leads" message="No lead data has been connected or added." />;
}

export function ProcessPage() {
  return <EmptyPage icon={GitBranch} title="No process data" message="No recruiting process has been connected or added." />;
}

export function StaffPage() {
  return <EmptyPage icon={UserCog} title="No staff profiles" message="No staff data has been added." />;
}

export function ProfilePage() {
  return <EmptyPage icon={User} title="No profile details" message="No business profile details have been added." />;
}

export function SettingsPage() {
  return <GoogleWorkspacePanel />;
}
