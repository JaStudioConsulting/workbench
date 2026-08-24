import { Activity, CheckCircle, AlertTriangle, XCircle, Lock, WifiOff } from 'lucide-react';

const statusConfig = {
  'Connected': { icon: CheckCircle, cls: 'int-connected' },
  'Read Only': { icon: Lock, cls: 'int-readonly' },
  'Draft Only': { icon: Lock, cls: 'int-draftonly' },
  'Disabled': { icon: WifiOff, cls: 'int-disabled' },
  'Error': { icon: XCircle, cls: 'int-error' },
};

export function AutomationHealth({ integrations: items }) {
  if (!items || items.length === 0) {
    return (
      <section className="today-card automation-health">
        <h2 className="card-title"><Activity size={18} /> Integrations</h2>
        <div className="empty-inline">No integrations configured.</div>
      </section>
    );
  }

  const hasIssue = items.some((i) => i.status === 'Error' || i.status === 'Disabled');

  return (
    <section className="today-card automation-health">
      <div className="card-header">
        <h2 className="card-title">
          {hasIssue ? <AlertTriangle size={18} /> : <Activity size={18} />}
          Integrations
        </h2>
      </div>
      <div className="integration-grid">
        {items.map((item) => {
          const config = statusConfig[item.status] || statusConfig['Disabled'];
          const Icon = config.icon;
          return (
            <div key={item.id} className={`integration-item ${config.cls}`}>
              <div className="int-row">
                <Icon size={14} />
                <strong>{item.name}</strong>
                <span className="int-status">{item.status}</span>
              </div>
              {item.note && <p className="int-note">{item.note}</p>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
