import { Archive, FileText, Inbox, Mail, Search, Send, Star, Trash2 } from "lucide-react";

const FOLDERS = [
  { label: "Inbox", icon: Inbox },
  { label: "Starred", icon: Star },
  { label: "Sent", icon: Send },
  { label: "Drafts", icon: FileText },
  { label: "Archive", icon: Archive },
  { label: "Trash", icon: Trash2 },
];

export default function MailInbox() {
  return (
    <section className="mail-shell" aria-label="Mail workspace">
      <aside className="mail-folders" aria-label="Mail folders">
        <nav>
          {FOLDERS.map(({ label, icon: Icon }, index) => (
            <button key={label} className={`mail-folder ${index === 0 ? "active" : ""}`}>
              <Icon size={16} aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </nav>
      </aside>

      <div className="mail-list-pane">
        <div className="mail-search" aria-label="Search mail">
          <Search size={16} aria-hidden="true" />
          <span>Search mail</span>
        </div>
        <div className="empty-state compact">
          <Mail size={24} aria-hidden="true" />
          <h2>No mail connected</h2>
          <p>Messages will appear here after a mail account is connected.</p>
        </div>
      </div>

      <div className="mail-reader-pane">
        <div className="empty-state compact">
          <h2>No message selected</h2>
          <p>Select a connected message to read it here.</p>
        </div>
      </div>
    </section>
  );
}
