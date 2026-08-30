import { Home, Mail, Users, Contact, GitBranch, UserCog, User, Settings } from "lucide-react";

const NAV_ITEMS = [
  { id: "home", label: "Home", icon: Home, group: "primary" },
  { id: "mail", label: "Mail", icon: Mail, group: "primary" },
  { id: "candidates", label: "Candidates", icon: Users, group: "primary" },
  { id: "leads", label: "Leads", icon: Contact, group: "primary" },
  { id: "process", label: "Process", icon: GitBranch, group: "secondary" },
  { id: "staff", label: "Staff", icon: UserCog, group: "secondary" },
  { id: "profile", label: "Profile", icon: User, group: "secondary" },
  { id: "settings", label: "Settings", icon: Settings, group: "secondary" },
];

function NavGroup({ items, active, onNavigate, className = "" }) {
  return (
    <nav className={`nav-group ${className}`.trim()}>
      {items.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          className={`rail-button ${active === id ? "active" : ""}`}
          onClick={() => onNavigate(id)}
          aria-label={label}
          aria-current={active === id ? "page" : undefined}
        >
          <Icon size={20} aria-hidden="true" />
          <span className="nav-label">{label}</span>
        </button>
      ))}
    </nav>
  );
}

export default function Navigation({ active, onNavigate }) {
  return (
    <aside className="rail" aria-label="Workbench navigation">
      <div className="mark" aria-hidden="true">JA</div>
      <NavGroup items={NAV_ITEMS.filter((item) => item.group === "primary")} active={active} onNavigate={onNavigate} />
      <NavGroup items={NAV_ITEMS.filter((item) => item.group === "secondary")} active={active} onNavigate={onNavigate} className="lower" />
    </aside>
  );
}
