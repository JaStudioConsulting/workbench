import { UserRound, X } from "lucide-react";

export default function CandidateWorkspace({ onClose }) {
  return (
    <aside className="profile-inspector" aria-label="Selected profile">
      <div className="profile-inspector-header">
        <div className="profile-inspector-title">
          <UserRound size={18} aria-hidden="true" />
          <h2>Profile</h2>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Close profile">
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      <div className="empty-state compact">
        <UserRound size={24} aria-hidden="true" />
        <h3>No profile data</h3>
        <p>This node is not connected to a profile yet.</p>
      </div>
    </aside>
  );
}
