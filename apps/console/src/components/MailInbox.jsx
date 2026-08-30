import { useState } from "react";
import {
  Inbox, Send as SendIcon, FileText, Archive, Trash2, Star, Tag,
  Search, SlidersHorizontal, ArrowUpDown, Edit3, Video, Paperclip,
  Send, X, Check, Mail as MailIcon, Reply, Forward, MoreHorizontal,
  Calendar as CalendarIcon, CheckSquare, StickyNote, Plus, ChevronRight,
  ArrowLeft, Clock, Filter, AlertCircle
} from "lucide-react";

/**
 * CITED REFERENCES:
 * 1. Google Workspace Gmail Architecture:
 *    - Left Folder/Label Rail: Inbox, Starred, Sent, Drafts, Archive, Custom Labels
 *    - Center Mail Stream: Bulk actions, label pills, time chips, full thread reader
 *    - Right Companion Panel: Integrated Google Calendar, Tasks, and Keep Notes
 * 2. @shadcn/sidebar (Multi-tier collapsible navigation) & @shadcn/card
 */

export default function MailInbox() {
  const [activeFolder, setActiveFolder] = useState("inbox");
  const [activeLabel, setActiveLabel] = useState(null);
  const [search, setSearch] = useState("");
  const [selectedMessage, setSelectedMessage] = useState(null);
  const [showCompose, setShowCompose] = useState(false);
  const [companionTab, setCompanionTab] = useState("calendar"); // "calendar" | "tasks" | "notes" | null
  const [senderAccount, setSenderAccount] = useState("ja@toptiertalentgroup.com");
  const [toastMessage, setToastMessage] = useState("");

  // Compose form states
  const [composeTo, setComposeTo] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [replyText, setReplyText] = useState("");

  // Google Tasks state
  const [tasks, setTasks] = useState([
    { id: 1, text: "Send Marcus Chen submission to Meridian", done: false, due: "Today" },
    { id: 2, text: "Follow up with Sarah Kim on interview feedback", done: false, due: "Today 1:00 PM" },
    { id: 3, text: "Prepare branded profile for James Wu", done: true, due: "Completed" },
    { id: 4, text: "Confirm 4:00 PM check-in with Maria Santos", done: false, due: "Today 3:30 PM" },
  ]);
  const [newTaskText, setNewTaskText] = useState("");

  // Notes state
  const [notes, setNotes] = useState([
    { id: 1, title: "Meridian Compensation", text: "Client willing to go up to $215k base for top candidate with enterprise team leadership." },
    { id: 2, title: "Cascade Partners Focus", text: "Prioritizing candidates with dual B2B + Brand Strategy backgrounds." },
  ]);

  // Email messages with folders, labels, and timestamps
  const [messages, setMessages] = useState([
    {
      id: 1,
      folder: "inbox",
      from: "Sarah Kim",
      email: "sarah.kim@email.com",
      subject: "Re: VP of Marketing — Cascade Partners",
      preview: "Thanks for sending over the position brief. I've reviewed the scope and I am confirmed for the 11:30 AM interview today.",
      body: "Hi Ja,\n\nThanks for sending over the position brief. I've reviewed the scope and I am confirmed for the 11:30 AM interview today.\n\nCould you please let me know if there's any specific case study or presentation format expected?\n\nBest,\nSarah",
      time: "10:42 AM",
      unread: true,
      starred: true,
      label: "Interviews",
      labelColor: "var(--forest)",
      labelBg: "var(--sage-light)",
    },
    {
      id: 2,
      folder: "inbox",
      from: "David Park",
      email: "david.park@advisory.com",
      subject: "Updated Executive Resume Attached",
      preview: "Hi Ja, please find my updated resume highlighting the Series B scaling metrics we discussed during the screening call.",
      body: "Hi Ja,\n\nPlease find my updated resume highlighting the scaling metrics we discussed during our screening call.\n\nLet me know if this looks ready for submission to Meridian Consulting.\n\nBest regards,\nDavid",
      time: "9:15 AM",
      unread: true,
      starred: false,
      label: "Candidates",
      labelColor: "var(--clay)",
      labelBg: "var(--clay-light)",
    },
    {
      id: 3,
      folder: "inbox",
      from: "Maria Santos",
      email: "maria.santos@brightpath.agency",
      subject: "Creative Director Opportunity — BrightPath",
      preview: "I'm very interested in the BrightPath leadership role. My availability for a check-in call is open this afternoon at 4 PM.",
      body: "Hi Ja,\n\nI'm very interested in the BrightPath leadership role. My availability for our check-in call is open this afternoon at 4:00 PM EDT.\n\nLooking forward to speaking.\n\nMaria",
      time: "Yesterday",
      unread: false,
      starred: true,
      label: "Candidates",
      labelColor: "var(--clay)",
      labelBg: "var(--clay-light)",
    },
    {
      id: 4,
      folder: "inbox",
      from: "Alex Rivera",
      email: "alex.rivera@meridian.com",
      subject: "Confirming 9:00 AM Screening Call",
      preview: "Just confirming our call at 9:00 AM today. Looking forward to discussing the Operations Manager role.",
      body: "Hi Ja,\n\nJust confirming our screening call at 9:00 AM today. I have reviewed the job spec and am excited to connect.\n\nAlex Rivera",
      time: "Yesterday",
      unread: false,
      starred: false,
      label: "Clients",
      labelColor: "var(--gold)",
      labelBg: "var(--gold-light)",
    },
    {
      id: 5,
      folder: "sent",
      from: "Ja Studio Consulting",
      email: "ja@toptiertalentgroup.com",
      subject: "Candidate Submission — Marcus Chen — Meridian Consulting",
      preview: "Hi team, please find attached the executive profile for Marcus Chen for the Marketing Director search...",
      body: "Hi team,\n\nPlease find attached the executive profile for Marcus Chen for the Marketing Director search.\n\nCompensation Target: $195,000 base\nStart Date / Notice Period: 2 weeks\nReason for Exploring: Seeking larger brand scope\n\nCV attached.",
      time: "Aug 28",
      unread: false,
      starred: false,
      label: "Submissions",
      labelColor: "var(--forest)",
      labelBg: "var(--sage-light)",
    },
  ]);

  const folderNav = [
    { id: "inbox", label: "Inbox", icon: Inbox, count: messages.filter((m) => m.folder === "inbox" && m.unread).length },
    { id: "starred", label: "Starred", icon: Star, count: messages.filter((m) => m.starred).length },
    { id: "sent", label: "Sent", icon: SendIcon, count: messages.filter((m) => m.folder === "sent").length },
    { id: "drafts", label: "Drafts", icon: FileText, count: 1 },
    { id: "archive", label: "Archive", icon: Archive },
    { id: "trash", label: "Trash", icon: Trash2 },
  ];

  const labels = [
    { id: "Candidates", label: "Candidates", color: "var(--clay)", bg: "var(--clay-light)" },
    { id: "Interviews", label: "Interviews", color: "var(--forest)", bg: "var(--sage-light)" },
    { id: "Clients", label: "Clients", color: "var(--gold)", bg: "var(--gold-light)" },
    { id: "Submissions", label: "Submissions", color: "var(--forest)", bg: "var(--sage-light)" },
  ];

  // Filter messages
  const filtered = messages.filter((m) => {
    if (activeLabel) {
      return m.label === activeLabel;
    }
    if (activeFolder === "starred") {
      return m.starred;
    }
    if (activeFolder === "inbox" || activeFolder === "sent") {
      if (m.folder !== activeFolder) return false;
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      return m.from.toLowerCase().includes(q) || m.subject.toLowerCase().includes(q) || m.preview.toLowerCase().includes(q);
    }
    return true;
  });

  const toggleStar = (id, e) => {
    e.stopPropagation();
    setMessages(messages.map((m) => (m.id === id ? { ...m, starred: !m.starred } : m)));
  };

  const handleSendEmail = (e) => {
    e.preventDefault();
    const newMsg = {
      id: Date.now(),
      folder: "sent",
      from: "Ja Studio Consulting",
      email: senderAccount,
      subject: composeSubject,
      preview: composeBody.slice(0, 80) + "...",
      body: composeBody,
      time: "Just now",
      unread: false,
      starred: false,
      label: "Submissions",
      labelColor: "var(--forest)",
      labelBg: "var(--sage-light)",
    };
    setMessages([newMsg, ...messages]);
    setToastMessage(`Message sent from ${senderAccount}`);
    setShowCompose(false);
    setComposeTo("");
    setComposeSubject("");
    setComposeBody("");
    setTimeout(() => setToastMessage(""), 2800);
  };

  const handleSendReply = (e) => {
    e.preventDefault();
    if (!replyText.trim()) return;
    setToastMessage(`Reply sent to ${selectedMessage.from}`);
    setReplyText("");
    setTimeout(() => setToastMessage(""), 2800);
  };

  const toggleTask = (id) => {
    setTasks(tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
  };

  const handleAddTask = (e) => {
    e.preventDefault();
    if (!newTaskText.trim()) return;
    setTasks([{ id: Date.now(), text: newTaskText, done: false, due: "Today" }, ...tasks]);
    setNewTaskText("");
  };

  return (
    <div className="gmail-workspace-container">
      {/* ── 1. LEFT GMAIL SUB-NAV (Folders & Labels) ── */}
      <aside className="gmail-folder-sidebar" aria-label="Mail folders and categories">
        {/* Compose Button */}
        <button className="gmail-compose-trigger" onClick={() => setShowCompose(true)}>
          <Edit3 size={15} />
          <span>Compose</span>
        </button>

        {/* Folders */}
        <nav className="gmail-folder-nav">
          <span className="gmail-nav-header">Mailboxes</span>
          {folderNav.map((folder) => {
            const Icon = folder.icon;
            const isActive = activeFolder === folder.id && !activeLabel;
            return (
              <button
                key={folder.id}
                className={`gmail-folder-btn ${isActive ? "active" : ""}`}
                onClick={() => {
                  setActiveFolder(folder.id);
                  setActiveLabel(null);
                  setSelectedMessage(null);
                }}
              >
                <Icon size={14} />
                <span className="gmail-folder-label">{folder.label}</span>
                {folder.count > 0 && <span className="gmail-folder-badge">{folder.count}</span>}
              </button>
            );
          })}
        </nav>

        {/* Categories / Labels */}
        <div className="gmail-labels-section">
          <div className="gmail-labels-header">
            <span className="gmail-nav-header">Categories & Labels</span>
            <Tag size={12} className="gmail-tag-icon" />
          </div>
          <div className="gmail-labels-list">
            {labels.map((lbl) => {
              const isActive = activeLabel === lbl.id;
              return (
                <button
                  key={lbl.id}
                  className={`gmail-label-btn ${isActive ? "active" : ""}`}
                  onClick={() => {
                    setActiveLabel(isActive ? null : lbl.id);
                    setSelectedMessage(null);
                  }}
                >
                  <span className="gmail-label-dot" style={{ background: lbl.color }} />
                  <span className="gmail-label-name">{lbl.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </aside>

      {/* ── 2. CENTER MAIL STREAM OR THREAD VIEW ── */}
      <main className="gmail-main-stream">
        {/* Search & Actions Bar */}
        <div className="gmail-stream-toolbar">
          <div className="gmail-search-bar">
            <Search size={14} className="gmail-search-icon" />
            <input
              type="search"
              placeholder="Search messages, candidates, or 'label:Interviews'..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="gmail-stream-actions">
            <a
              href="https://meet.google.com/new"
              target="_blank"
              rel="noopener noreferrer"
              className="gmail-quick-tool-btn"
              title="Start Google Meet"
            >
              <Video size={14} />
              <span>Meet</span>
            </a>
          </div>
        </div>

        {toastMessage && (
          <div className="gmail-toast-banner">
            <Check size={14} />
            <span>{toastMessage}</span>
          </div>
        )}

        {/* Email Stream or Selected Thread View */}
        {selectedMessage ? (
          <div className="gmail-reading-pane">
            <div className="reading-pane-header">
              <button className="reading-back-btn" onClick={() => setSelectedMessage(null)}>
                <ArrowLeft size={14} />
                <span>Back to {activeLabel ? activeLabel : activeFolder}</span>
              </button>
              <div className="reading-pane-meta">
                <span className="reading-label-chip" style={{ background: selectedMessage.labelBg, color: selectedMessage.labelColor }}>
                  {selectedMessage.label}
                </span>
                <span className="reading-time">{selectedMessage.time}</span>
              </div>
            </div>

            <article className="reading-message-card">
              <h2 className="reading-subject">{selectedMessage.subject}</h2>
              <div className="reading-sender-box">
                <div className="reading-avatar">{selectedMessage.from[0]}</div>
                <div className="reading-sender-details">
                  <div className="reading-sender-name-row">
                    <span className="reading-from-name">{selectedMessage.from}</span>
                    <span className="reading-from-email">&lt;{selectedMessage.email}&gt;</span>
                  </div>
                  <span className="reading-to-text">to me ({senderAccount})</span>
                </div>
              </div>

              <div className="reading-body-text">
                {selectedMessage.body.split("\n").map((line, idx) => (
                  <p key={idx}>{line || "\u00A0"}</p>
                ))}
              </div>

              {/* Inline Reply Form */}
              <form onSubmit={handleSendReply} className="reading-reply-container">
                <div className="reading-reply-header">
                  <Reply size={13} />
                  <span>Reply to {selectedMessage.from}</span>
                </div>
                <textarea
                  placeholder="Type your reply here..."
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  rows={4}
                  required
                />
                <div className="reading-reply-footer">
                  <button type="submit" className="reading-send-btn">
                    <Send size={13} />
                    <span>Send Reply</span>
                  </button>
                  <button type="button" className="reading-attach-btn" title="Attach resume/file">
                    <Paperclip size={13} />
                  </button>
                </div>
              </form>
            </article>
          </div>
        ) : (
          <div className="gmail-messages-list" role="list">
            {filtered.length === 0 ? (
              <div className="gmail-empty-state">
                <MailIcon size={32} />
                <p>No messages found in this folder or search.</p>
              </div>
            ) : (
              filtered.map((msg) => (
                <article
                  key={msg.id}
                  className={`gmail-message-row ${msg.unread ? "unread" : ""}`}
                  onClick={() => setSelectedMessage(msg)}
                  role="listitem"
                >
                  <div className="msg-row-left">
                    <button
                      className={`msg-star-btn ${msg.starred ? "starred" : ""}`}
                      onClick={(e) => toggleStar(msg.id, e)}
                      aria-label="Star message"
                    >
                      <Star size={13} />
                    </button>
                    <span className={`msg-unread-dot ${msg.unread ? "visible" : ""}`} />
                    <span className="msg-sender">{msg.from}</span>
                  </div>

                  <div className="msg-row-body">
                    <span className="msg-subject">{msg.subject}</span>
                    <span className="msg-snippet"> — {msg.preview}</span>
                  </div>

                  <div className="msg-row-right">
                    {msg.label && (
                      <span className="msg-label-pill" style={{ background: msg.labelBg, color: msg.labelColor }}>
                        {msg.label}
                      </span>
                    )}
                    <span className="msg-time">{msg.time}</span>
                  </div>
                </article>
              ))
            )}
          </div>
        )}
      </main>

      {/* ── 3. RIGHT COMPANION RAIL (Google Calendar, Tasks, Keep Notes) ── */}
      <aside className="gmail-companion-rail" aria-label="Google Workspace Companion Tools">
        <div className="companion-icon-strip">
          <button
            className={`companion-icon-btn ${companionTab === "calendar" ? "active" : ""}`}
            onClick={() => setCompanionTab(companionTab === "calendar" ? null : "calendar")}
            title="Google Calendar"
          >
            <CalendarIcon size={16} />
          </button>
          <button
            className={`companion-icon-btn ${companionTab === "tasks" ? "active" : ""}`}
            onClick={() => setCompanionTab(companionTab === "tasks" ? null : "tasks")}
            title="Google Tasks"
          >
            <CheckSquare size={16} />
          </button>
          <button
            className={`companion-icon-btn ${companionTab === "notes" ? "active" : ""}`}
            onClick={() => setCompanionTab(companionTab === "notes" ? null : "notes")}
            title="Google Keep / Recruiter Notes"
          >
            <StickyNote size={16} />
          </button>
        </div>

        {/* Companion Expanded Panel */}
        {companionTab && (
          <div className="companion-drawer-panel">
            <div className="companion-panel-header">
              <h3>
                {companionTab === "calendar" && "Today's Schedule"}
                {companionTab === "tasks" && "Recruiter Tasks"}
                {companionTab === "notes" && "Keep Notes"}
              </h3>
              <button className="companion-close-btn" onClick={() => setCompanionTab(null)}>
                <X size={13} />
              </button>
            </div>

            {/* Calendar View */}
            {companionTab === "calendar" && (
              <div className="companion-content-box">
                <div className="companion-cal-header">
                  <span className="companion-cal-day">Thursday, Aug 30</span>
                  <a href="https://calendar.google.com" target="_blank" rel="noopener noreferrer" className="companion-ext-link">
                    Open GCal
                  </a>
                </div>
                <div className="companion-events-list">
                  <div className="companion-event-item">
                    <span className="event-time">09:00 AM</span>
                    <span className="event-title">Screening: Alex Rivera</span>
                  </div>
                  <div className="companion-event-item meet">
                    <span className="event-time">11:30 AM</span>
                    <span className="event-title">Client Interview: Sarah Kim</span>
                    <span className="event-meet-tag"><Video size={9} /> Meet</span>
                  </div>
                  <div className="companion-event-item">
                    <span className="event-time">02:00 PM</span>
                    <span className="event-title">Profile Review: James Wu</span>
                  </div>
                </div>
              </div>
            )}

            {/* Tasks View */}
            {companionTab === "tasks" && (
              <div className="companion-content-box">
                <form onSubmit={handleAddTask} className="companion-add-task-form">
                  <input
                    type="text"
                    placeholder="+ Add a task..."
                    value={newTaskText}
                    onChange={(e) => setNewTaskText(e.target.value)}
                  />
                </form>
                <div className="companion-tasks-list">
                  {tasks.map((task) => (
                    <label key={task.id} className={`companion-task-item ${task.done ? "done" : ""}`}>
                      <input
                        type="checkbox"
                        checked={task.done}
                        onChange={() => toggleTask(task.id)}
                      />
                      <div className="task-text-wrap">
                        <span className="task-title">{task.text}</span>
                        <span className="task-due">{task.due}</span>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Notes View */}
            {companionTab === "notes" && (
              <div className="companion-content-box">
                <div className="companion-notes-list">
                  {notes.map((note) => (
                    <div key={note.id} className="companion-note-card">
                      <h4 className="note-card-title">{note.title}</h4>
                      <p className="note-card-text">{note.text}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </aside>

      {/* ── 4. GMAIL COMPOSE DIALOG MODAL ── */}
      {showCompose && (
        <div className="cal-modal-overlay" onClick={() => setShowCompose(false)}>
          <div className="gmail-compose-box" onClick={(e) => e.stopPropagation()}>
            <div className="gmail-compose-header">
              <div className="gmail-compose-title">
                <MailIcon size={14} />
                <span>New Message — Google Workspace</span>
              </div>
              <button className="cal-modal-close" onClick={() => setShowCompose(false)}><X size={15} /></button>
            </div>
            <form onSubmit={handleSendEmail} className="gmail-compose-form">
              <div className="gmail-from-row">
                <span className="gmail-row-label">From:</span>
                <select value={senderAccount} onChange={(e) => setSenderAccount(e.target.value)} className="gmail-account-select">
                  <option value="ja@toptiertalentgroup.com">ja@toptiertalentgroup.com (Work)</option>
                  <option value="maralitjeryl@gmail.com">maralitjeryl@gmail.com (Personal)</option>
                </select>
              </div>
              <div className="gmail-input-row">
                <span className="gmail-row-label">To:</span>
                <input
                  type="email"
                  placeholder="Recipients"
                  value={composeTo}
                  onChange={(e) => setComposeTo(e.target.value)}
                  autoFocus
                  required
                />
              </div>
              <div className="gmail-input-row">
                <span className="gmail-row-label">Subject:</span>
                <input
                  type="text"
                  placeholder="New Candidate Submission - [Role] - [Name] - [Client] - [City], ON"
                  value={composeSubject}
                  onChange={(e) => setComposeSubject(e.target.value)}
                  required
                />
              </div>
              <div className="gmail-body-row">
                <textarea
                  placeholder="Hi team,&#10;&#10;Please review the attached candidate profile...&#10;&#10;CV attached."
                  value={composeBody}
                  onChange={(e) => setComposeBody(e.target.value)}
                  rows={8}
                  required
                />
              </div>
              <div className="gmail-compose-footer">
                <button type="submit" className="gmail-btn-draft">
                  <Send size={13} />
                  <span>Send Message</span>
                </button>
                <div className="gmail-footer-tools">
                  <button type="button" className="gmail-tool-icon" title="Attach candidate CV"><Paperclip size={14} /></button>
                  <a href="https://meet.google.com/new" target="_blank" rel="noopener noreferrer" className="gmail-tool-icon" title="Add Google Meet link"><Video size={14} /></a>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
