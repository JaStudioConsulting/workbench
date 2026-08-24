import { ClipboardList, Eye, MessageSquare, Check, AlertCircle, Clock } from 'lucide-react';

const statusClass = {
  'Needs Review': 'status-review',
  'Changes Requested': 'status-changes',
  'Approved': 'status-approved',
  'Blocked': 'status-blocked',
  'Completed': 'status-completed',
};

const statusIcon = {
  'Needs Review': Eye,
  'Changes Requested': MessageSquare,
  'Approved': Check,
  'Blocked': AlertCircle,
  'Completed': Check,
};

export function ReviewQueue({ items, onReview, onRequestChanges, onApprove }) {
  if (!items || items.length === 0) {
    return (
      <section className="today-card review-queue">
        <h2 className="card-title"><ClipboardList size={18} /> Review Queue</h2>
        <div className="empty-inline">No drafts awaiting review.</div>
      </section>
    );
  }

  return (
    <section className="today-card review-queue">
      <div className="card-header">
        <h2 className="card-title"><ClipboardList size={18} /> Review Queue</h2>
        <span className="count-badge">{items.filter((i) => i.status === 'Needs Review' || i.status === 'Changes Requested').length}</span>
      </div>
      <div className="review-table-wrap">
        <table className="review-table" role="table">
          <thead>
            <tr>
              <th>Candidate</th>
              <th>Type</th>
              <th>Status</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const StatusIcon = statusIcon[item.status] || Eye;
              return (
                <tr key={item.id} className={statusClass[item.status] || ''}>
                  <td className="review-candidate">{item.candidate}</td>
                  <td>{item.type}</td>
                  <td>
                    <span className={`review-status ${statusClass[item.status] || ''}`}>
                      <StatusIcon size={12} /> {item.status}
                    </span>
                  </td>
                  <td className="review-time">
                    <Clock size={12} /> {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td className="review-actions">
                    {(item.status === 'Needs Review' || item.status === 'Changes Requested') && (
                      <>
                        <button className="review-btn" onClick={() => onReview?.(item)} aria-label={`Review ${item.type}`}>Review</button>
                        <button className="review-btn secondary" onClick={() => onRequestChanges?.(item)} aria-label={`Request changes for ${item.type}`}>Changes</button>
                        <button className="review-btn approve" onClick={() => onApprove?.(item)} aria-label={`Approve ${item.type}`}>Approve</button>
                      </>
                    )}
                    {item.status === 'Approved' && <span className="review-done">Approved</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
