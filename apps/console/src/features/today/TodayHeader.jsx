import { Calendar, Search, Sparkles, ChevronDown, User } from 'lucide-react';

export function TodayHeader({ attentionCount, caseCount }) {
  return (
    <header className="today-header">
      <div className="today-header-left">
        <h1>Recruiting Workbench</h1>
        <div className="today-meta">
          <span>Command Centre</span>
          <span>·</span>
          <span><strong>{caseCount}</strong> active cases</span>
          <span>·</span>
          <span><strong>{attentionCount}</strong> need attention</span>
        </div>
      </div>

      <div className="header-controls">
        {/* Time Pills (Jour, Semaine, Mois, Année from Image 2) */}
        <div className="time-pill-group">
          <button className="time-pill">Day</button>
          <button className="time-pill">Week</button>
          <button className="time-pill active">Month</button>
          <button className="time-pill">Year</button>
        </div>

        {/* Date Selector Pill (1 sept. 2024 - 30 sept. 2024 from Image 2) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--bg-sidebar)', padding: '8px 16px', borderRadius: 'var(--radius-pill)', border: '1px solid var(--border-subtle)', fontSize: '0.85rem', fontWeight: 600 }}>
          <Calendar size={14} style={{ color: 'var(--text-muted)' }} />
          <span>1 Sept 2024 - 30 Sept 2024</span>
          <ChevronDown size={14} style={{ color: 'var(--text-muted)' }} />
        </div>

        {/* Safe Badge */}
        <span className="safe-badge"><Sparkles size={14} /> Draft Only</span>
      </div>
    </header>
  );
}
