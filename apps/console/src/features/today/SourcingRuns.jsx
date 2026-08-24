import { Search, CheckCircle, HelpCircle, XCircle, Copy, Loader, ChevronRight } from 'lucide-react';

const statusIcons = {
  'Complete': CheckCircle,
  'Running': Loader,
  'Blocked': XCircle,
};

export function SourcingRuns({ runs }) {
  if (!runs || runs.length === 0) {
    return (
      <section className="today-card sourcing-runs">
        <h2 className="card-title"><Search size={18} /> Sourcing Runs</h2>
        <div className="empty-inline">No sourcing runs. Start a search from a job or candidate profile.</div>
      </section>
    );
  }

  return (
    <section className="today-card sourcing-runs">
      <div className="card-header">
        <h2 className="card-title"><Search size={18} /> Sourcing Runs</h2>
        <span className="count-badge">{runs.length}</span>
      </div>
      <div className="sourcing-list">
        {runs.map((run) => {
          const StatusIcon = statusIcons[run.status] || HelpCircle;
          return (
            <article key={run.id} className="sourcing-row">
              <div className="sourcing-top">
                <strong>{run.job.title}</strong>
                <span className="sourcing-client">· {run.job.client}</span>
                <span className={`sourcing-status status-${run.status.toLowerCase()}`}>
                  <StatusIcon size={14} /> {run.status}
                </span>
              </div>
              <p className="sourcing-criteria">{run.criteria}</p>
              <div className="sourcing-counts">
                <span className="sc-found">{run.found} found</span>
                <span className="sc-verified"><CheckCircle size={12} /> {run.verified} verified</span>
                <span className="sc-possible"><HelpCircle size={12} /> {run.possible} possible</span>
                <span className="sc-rejected"><XCircle size={12} /> {run.rejected} rejected</span>
                <span className="sc-dupes"><Copy size={12} /> {run.duplicates} dupes</span>
              </div>
              {run.blockedReason && <div className="sourcing-blocked"><XCircle size={12} /> {run.blockedReason}</div>}
              <div className="sourcing-next">
                <span>{run.nextAction}</span>
                <ChevronRight size={14} />
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
