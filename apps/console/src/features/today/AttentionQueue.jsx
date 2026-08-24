import { AlertTriangle, FileX, PhoneOff, ShieldAlert, Clock, ChevronRight, WifiOff } from 'lucide-react';

const iconMap = {
  'missing-jd': FileX,
  'missing-transcript': PhoneOff,
  'unverified-facts': ShieldAlert,
  'draft-review': Clock,
  'integration-error': WifiOff,
  'missing-resume': FileX,
  'overdue-followup': Clock,
  'failed-automation': AlertTriangle,
};

const urgencyClass = { high: 'urgency-high', medium: 'urgency-medium', low: 'urgency-low' };

export function AttentionQueue({ items, onNavigate }) {
  if (!items || items.length === 0) {
    return (
      <section className="today-card attention-queue">
        <h2 className="card-title"><AlertTriangle size={18} /> Needs Attention</h2>
        <div className="empty-inline">No blockers right now. All clear.</div>
      </section>
    );
  }

  return (
    <section className="today-card attention-queue">
      <div className="card-header">
        <h2 className="card-title"><AlertTriangle size={18} /> Needs Attention</h2>
        <span className="count-badge">{items.length}</span>
      </div>
      <ul className="attention-list" role="list">
        {items.map((item) => {
          const Icon = iconMap[item.type] || AlertTriangle;
          return (
            <li key={item.id} className={`attention-item ${urgencyClass[item.urgency] || ''}`}>
              <div className="attention-icon"><Icon size={16} /></div>
              <div className="attention-content">
                <div className="attention-top">
                  <strong>{item.candidate || item.reason}</strong>
                  {item.job && <span className="attention-job">{item.job}</span>}
                  {item.client && <span className="attention-client">· {item.client}</span>}
                </div>
                <p className="attention-reason">{item.reason}</p>
                {item.dueTime && (
                  <span className="attention-due">
                    <Clock size={12} /> {new Date(item.dueTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </div>
              <button
                className="attention-action"
                onClick={() => onNavigate?.(item)}
                aria-label={`${item.nextAction} for ${item.candidate || 'integration'}`}
              >
                {item.nextAction} <ChevronRight size={14} />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
