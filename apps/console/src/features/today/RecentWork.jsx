import { Clock, Play, FileText, Eye, MessageSquare, XCircle, Search, Info } from 'lucide-react';

const typeIcons = {
  'workflow-started': Play,
  'draft-generated': FileText,
  'draft-reviewed': Eye,
  'changes-requested': MessageSquare,
  'workflow-failed': XCircle,
  'sourcing-complete': Search,
  'info-requested': Info,
};

export function RecentWork({ activity }) {
  if (!activity || activity.length === 0) {
    return (
      <section className="today-card recent-work">
        <h2 className="card-title"><Clock size={18} /> Recent Work</h2>
        <div className="empty-inline">No recent activity.</div>
      </section>
    );
  }

  return (
    <section className="today-card recent-work">
      <div className="card-header">
        <h2 className="card-title"><Clock size={18} /> Recent Work</h2>
      </div>
      <ul className="activity-feed" role="list">
        {activity.map((item) => {
          const Icon = typeIcons[item.type] || Clock;
          const isFailed = item.type === 'workflow-failed';
          return (
            <li key={item.id} className={`activity-item ${isFailed ? 'activity-failed' : ''}`}>
              <div className={`activity-icon ${isFailed ? 'icon-error' : ''}`}><Icon size={14} /></div>
              <div className="activity-content">
                <span className="activity-desc">{item.description}</span>
                <span className="activity-time">
                  {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
