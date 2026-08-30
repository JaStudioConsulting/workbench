import { Users, Briefcase, Building2, GitBranch, UserCog, User, Settings, Search, Zap } from "lucide-react";
import { hiringNowCompanies } from "../data/placeholders.js";

function PageStub({ icon: Icon, title, description }) {
  return (
    <section className="page-stub">
      <div className="stub-icon"><Icon size={32} /></div>
      <h2>{title}</h2>
      <p>{description}</p>
    </section>
  );
}

export function CandidatesPage() {
  return (
    <PageStub
      icon={Users}
      title="Candidates"
      description="Search, review, and manage candidate profiles. Candidate records will appear here once connected to a data source."
    />
  );
}

export function JobsPage() {
  return (
    <PageStub
      icon={Briefcase}
      title="Jobs"
      description="Active roles, job requirements, candidate pipelines, and submission tracking. Connect a job source to populate this view."
    />
  );
}

export function CompaniesPage({ filter }) {
  if (filter === "hiring-now") {
    return (
      <div className="companies-filtered">
        <div className="companies-filter-header">
          <Zap size={18} />
          <h2>Hiring Now</h2>
          <span className="filter-badge">{hiringNowCompanies.length} active signals</span>
        </div>
        <div className="companies-list">
          {hiringNowCompanies.map((co) => (
            <article key={co.id} className="company-card">
              <div className="company-info">
                <h3>{co.name}</h3>
                <span className="company-sector">{co.sector}</span>
              </div>
              <div className="company-signal">
                <Zap size={13} />
                <span>{co.signal}</span>
              </div>
            </article>
          ))}
        </div>
      </div>
    );
  }

  return (
    <PageStub
      icon={Building2}
      title="Companies"
      description="Company profiles, contacts, hiring signals, open opportunities, and ownership tracking. Connect a data source to populate."
    />
  );
}

export function ProcessPage() {
  return (
    <PageStub
      icon={GitBranch}
      title="Process"
      description="Recruiting workflow stages, required actions, approvals, and blockers. Define your process to track candidates through each stage."
    />
  );
}

export function StaffPage() {
  return (
    <PageStub
      icon={UserCog}
      title="Staff"
      description="You're currently operating independently. Team members, workload distribution, and access controls will appear here when your team grows."
    />
  );
}

export function ProfilePage() {
  return (
    <PageStub
      icon={User}
      title="Profile"
      description="Your business identity, recruiting focus areas, contact details, email signature, and working preferences."
    />
  );
}

export function SettingsPage() {
  return (
    <section className="settings-page">
      <h2>Settings</h2>
      <p className="settings-intro">Connections, workflow defaults, display preferences, and account controls.</p>
      <div className="settings-grid">
        <SettingsGroup title="Connections" items={["Google Workspace", "Neo4j", "Loxo", "Calendar"]} />
        <SettingsGroup title="Workflow" items={["Approval rules", "Stage defaults", "Notification preferences"]} />
        <SettingsGroup title="Display" items={["Theme", "Density", "Default landing page"]} />
        <SettingsGroup title="Account" items={["Session management", "Access controls", "Data export"]} />
      </div>
    </section>
  );
}

function SettingsGroup({ title, items }) {
  return (
    <div className="settings-group">
      <h3>{title}</h3>
      <ul>
        {items.map((item) => (
          <li key={item}>
            <button className="settings-item">{item}</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
