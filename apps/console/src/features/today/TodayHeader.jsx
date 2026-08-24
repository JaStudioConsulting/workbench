import { Calendar, Clock, Sparkles } from 'lucide-react';

const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function TodayHeader({ attentionCount, caseCount }) {
  const now = new Date();
  const dateStr = `${dayNames[now.getDay()]}, ${monthNames[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`;

  return (
    <header className="today-header">
      <div className="today-header-left">
        <span className="eyebrow">JA STUDIO CONSULTING</span>
        <h1>Today</h1>
        <div className="today-meta">
          <span className="today-date"><Calendar size={14} /> {dateStr}</span>
          <span className="today-summary">
            {caseCount} active case{caseCount !== 1 ? 's' : ''} · {attentionCount} need{attentionCount !== 1 ? '' : 's'} attention
          </span>
        </div>
      </div>
      <div className="today-header-right">
        <span className="safe-badge"><Sparkles size={14} /> Draft only — no external actions</span>
        <span className="today-time"><Clock size={14} /> {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
    </header>
  );
}
