import { BriefcaseBusiness, GripVertical, ChevronDown, Clock, FileText, Check, X, AlertCircle } from 'lucide-react';
import { STAGES } from '../../data/synthetic-today.js';

const sourceIcons = { resume: '📄', jobDescription: '📋', transcript: '🎙️', callNotes: '📝', candidateFacts: '✓', candidateProfile: '👤' };

function SourceReadiness({ sources }) {
  return (
    <div className="source-readiness" aria-label="Source readiness">
      {Object.entries(sources).map(([key, ready]) => (
        <span key={key} className={`source-dot ${ready ? 'ready' : 'missing'}`} title={`${key}: ${ready ? 'available' : 'missing'}`}>
          {sourceIcons[key] || '?'} {ready ? <Check size={10} /> : <X size={10} />}
        </span>
      ))}
    </div>
  );
}

function StageBadge({ stage }) {
  const cls = stage.toLowerCase().replace(/\s+/g, '-');
  return <span className={`stage-badge stage-${cls}`}>{stage}</span>;
}

export function ActiveCases({ cases, onDragStart, onDragEnd, onActionMenu, onStageChange }) {
  if (!cases || cases.length === 0) {
    return (
      <section className="today-card active-cases">
        <h2 className="card-title"><BriefcaseBusiness size={18} /> Active Cases</h2>
        <div className="empty-inline">No active cases. Create a case to get started.</div>
      </section>
    );
  }

  return (
    <section className="today-card active-cases">
      <div className="card-header">
        <h2 className="card-title"><BriefcaseBusiness size={18} /> Active Cases</h2>
        <span className="count-badge">{cases.length}</span>
      </div>
      <div className="cases-list" role="list">
        {cases.map((c) => (
          <article
            key={c.id}
            className="case-row"
            draggable="true"
            onDragStart={(e) => onDragStart?.(e, c)}
            onDragEnd={onDragEnd}
            role="listitem"
            aria-label={`Case: ${c.candidate.name}`}
          >
            <div className="case-grip" aria-hidden="true"><GripVertical size={14} /></div>
            <div className="case-main">
              <div className="case-top">
                <strong className="case-name">{c.candidate.name}</strong>
                <span className="case-title">{c.candidate.title}</span>
                <span className="case-location">{c.candidate.location}</span>
              </div>
              <div className="case-meta">
                <span className="case-job"><FileText size={12} /> {c.job.title}</span>
                <span className="case-client">· {c.job.client}</span>
                <StageBadge stage={c.stage} />
                <span className="case-workflow">{c.workflow}</span>
              </div>
              <SourceReadiness sources={c.sources} />
              {c.blocker && <div className="case-blocker"><AlertCircle size={12} /> {c.blocker}</div>}
            </div>
            <div className="case-right">
              <div className="case-due"><Clock size={12} /> {new Date(c.dueTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
              {c.draftCount > 0 && <span className="draft-count">{c.draftCount} draft{c.draftCount > 1 ? 's' : ''}</span>}
              <div className="case-next">{c.nextAction}</div>
              <div className="case-actions-row">
                <button className="case-action-btn" onClick={() => onActionMenu?.(c)} aria-label={`Actions for ${c.candidate.name}`}>
                  Actions <ChevronDown size={12} />
                </button>
                <select
                  className="stage-select"
                  value={c.stage}
                  onChange={(e) => onStageChange?.(c.id, e.target.value)}
                  aria-label={`Change stage for ${c.candidate.name}`}
                >
                  {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
