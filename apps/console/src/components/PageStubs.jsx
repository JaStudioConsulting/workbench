import { Cloud, Contact, GitBranch, User, UserCog, Users } from "lucide-react";

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
  return (
    <section className="google-workspace-panel" aria-labelledby="google-workspace-title">
      <div className="google-workspace-copy">
        <div className="google-workspace-title">
          <span className="google-workspace-icon" aria-hidden="true">
            <Cloud size={22} />
          </span>
          <div>
            <span className="eyebrow">INTEGRATIONS</span>
            <h2 id="google-workspace-title">Google Workspace</h2>
          </div>
        </div>
        <p>Connect Google once, then use the approved Workspace tools from the Workbench.</p>
        <p className="google-workspace-services">
          Gmail, Calendar, Drive, Docs, Sheets, Contacts, Tasks, Chat, Meet, Forms, and Workspace Events
        </p>
      </div>

      <div className="google-workspace-action">
        <span className="connection-status"><span aria-hidden="true" />Not connected</span>
        <button type="button" disabled>Connect Google Workspace</button>
        <small>Connection setup is not configured yet.</small>
      </div>
    </section>
  );
}
