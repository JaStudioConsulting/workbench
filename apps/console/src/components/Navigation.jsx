import { Home, Mail, Users, Briefcase, Building2, GitBranch, UserCog, User, Settings } from "lucide-react";

const NAV_ITEMS = [
  { id: "home", label: "Home", icon: Home, group: "primary" },
  { id: "mail", label: "Mail", icon: Mail, group: "primary" },
  { id: "candidates", label: "Candidates", icon: Users, group: "primary" },
  { id: "jobs", label: "Jobs", icon: Briefcase, group: "primary" },
  { id: "companies", label: "Companies", icon: Building2, group: "primary" },
  { id: "process", label: "Process", icon: GitBranch, group: "secondary" },
  { id: "staff", label: "Staff", icon: UserCog, group: "secondary" },
  { id: "profile", label: "Profile", icon: User, group: "secondary" },
  { id: "settings", label: "Settings", icon: Settings, group: "secondary" },
];

export default function Navigation({ active, onNavigate }) {
  const primary = NAV_ITEMS.filter((n) => n.group === "primary");
  const secondary = NAV_ITEMS.filter((n) => n.group === "secondary");

  return (
    <aside className="rail" aria-label="Workbench navigation">
      <div className="mark" aria-hidden="true">
        <span className="mark-text">JA</span>
      </div>
      <nav className="nav-group">
        {primary.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={`rail-button ${active === id ? "active" : ""}`}
            onClick={() => onNavigate(id)}
            aria-label={label}
            aria-current={active === id ? "page" : undefined}
          >
            <Icon size={20} />
            <span className="nav-label">{label}</span>
          </button>
        ))}
      </nav>
      <nav className="nav-group lower" aria-label="Settings and profile">
        {secondary.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={`rail-button ${active === id ? "active" : ""}`}
            onClick={() => onNavigate(id)}
            aria-label={label}
            aria-current={active === id ? "page" : undefined}
          >
            <Icon size={20} />
            <span className="nav-label">{label}</span>
          </button>
        ))}
      </nav>
    </aside>
  );
}
