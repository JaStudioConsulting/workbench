import { Calendar, Search, Sparkles } from 'lucide-react';

const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function TodayHeader({ attentionCount, caseCount }) {
  const now = new Date();
  const dateStr = `${dayNames[now.getDay()]}, ${monthNames[now.getMonth()]} ${now.getDate()}`;

  return (
    <header className="today-header">
      <div className="today-header-left">
        <h1>Hi, Ja! 👋</h1>
        <div className="today-meta">
          <span>Let's take a look at your recruiting pipeline today</span>
          <span>·</span>
          <span className="today-date"><Calendar size={14} /> {dateStr}</span>
          <span>·</span>
          <span className="today-summary">
            <strong>{caseCount}</strong> active cases · <strong>{attentionCount}</strong> need attention
          </span>
        </div>
      </div>
      <div className="today-header-right">
        <div className="header-search">
          <Search size={16} />
          <span>Search cases, candidates, jobs...</span>
        </div>
        <span className="safe-badge"><Sparkles size={14} /> Draft Only</span>
      </div>
    </header>
  );
}
