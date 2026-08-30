import { X, Mail, Phone, Calendar, MoreHorizontal, MapPin, Briefcase, ChevronRight, FileText, Send, Check } from "lucide-react";
import { useState } from "react";

export default function CandidateWorkspace({ candidate, onClose }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [draftToast, setDraftToast] = useState(false);

  if (!candidate) return null;

  const handleCreateGmailDraft = () => {
    setDraftToast(true);
    setTimeout(() => setDraftToast(false), 2400);
  };

  return (
    <>
      <div className="workspace-overlay" onClick={onClose} aria-hidden="true" />
      <aside className="candidate-workspace" role="dialog" aria-label={`${candidate.name} inspector sheet`}>
        {/* Header */}
        <div className="ws-header">
          <div className="ws-header-info">
            <div className="ws-avatar">{candidate.name.split(" ").map((n) => n[0]).join("")}</div>
            <div>
              <h2 className="ws-name">{candidate.name}</h2>
              <span className="ws-title">{candidate.title}</span>
              <span className="ws-location"><MapPin size={11} /> {candidate.location}</span>
            </div>
          </div>
          <button className="ws-close" onClick={onClose} aria-label="Close workspace"><X size={16} /></button>
        </div>

        {/* Action Bar — Apple-tier buttons */}
        <div className="ws-actions">
          <button className="ws-action-btn primary-action" onClick={handleCreateGmailDraft}>
            <Mail size={14} /> Gmail Draft
          </button>
          <a
            href="https://calendar.google.com"
            target="_blank"
            rel="noopener noreferrer"
            className="ws-action-btn"
          >
            <Calendar size={14} /> GCal
          </a>
          <button className="ws-action-btn">
            <Phone size={14} /> Call
          </button>
          <div className="ws-more-wrap">
            <button className="ws-action-btn" onClick={() => setMoreOpen(!moreOpen)}>
              <MoreHorizontal size={14} />
            </button>
            {moreOpen && (
              <div className="ws-more-menu">
                <button onClick={() => setMoreOpen(false)}>Add note to GDrive</button>
                <button onClick={() => setMoreOpen(false)}>Export branded PDF</button>
                <button onClick={() => setMoreOpen(false)}>Move pipeline stage</button>
                <button onClick={() => setMoreOpen(false)}>Archive record</button>
              </div>
            )}
          </div>
        </div>

        {draftToast && (
          <div className="ws-toast">
            <Check size={13} />
            <span>Gmail draft created in maralitjeryl@gmail.com</span>
          </div>
        )}

        {/* Status */}
        <div className="ws-section">
          <div className="ws-status-row">
            <span className="ws-status-badge">{candidate.status}</span>
            <span className="ws-next-action"><ChevronRight size={12} /> {candidate.nextAction}</span>
          </div>
        </div>

        {/* Related Job */}
        <div className="ws-section">
          <h4 className="ws-section-title">Active Search</h4>
          <div className="ws-related-job">
            <Briefcase size={14} />
            <div>
              <span className="ws-job-title">{candidate.relatedJob.title}</span>
              <span className="ws-job-company">{candidate.relatedJob.company}</span>
            </div>
          </div>
        </div>

        {/* Recent Messages */}
        <div className="ws-section">
          <h4 className="ws-section-title">Recent Activity & Emails</h4>
          {candidate.recentMessages.map((msg, i) => (
            <div key={i} className="ws-message">
              <span className="ws-msg-date">{msg.date}</span>
              <span className="ws-msg-preview">{msg.preview}</span>
            </div>
          ))}
        </div>

        {/* Notes */}
        <div className="ws-section">
          <h4 className="ws-section-title">Candidate Fit & Notes</h4>
          <p className="ws-notes">{candidate.notes}</p>
        </div>

        {/* History */}
        <div className="ws-section">
          <h4 className="ws-section-title">Timeline</h4>
          <ul className="ws-history" role="list">
            {candidate.history.map((entry, i) => (
              <li key={i} className="ws-history-item">
                <span className="ws-history-date">{entry.date}</span>
                <span className="ws-history-dot" />
                <span className="ws-history-action">{entry.action}</span>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </>
  );
}
