import { Calendar, Phone, Users, Clock, CornerDownRight } from 'lucide-react';

const typeIcons = {
  'candidate-call': Phone,
  'client-call': Users,
  'interview': Calendar,
  'follow-up': CornerDownRight,
};

const typeLabels = {
  'candidate-call': 'Candidate Call',
  'client-call': 'Client Call',
  'interview': 'Interview',
  'follow-up': 'Follow-up',
};

export function TodayCalendar({ items }) {
  const now = new Date();
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  if (!items || items.length === 0) {
    return (
      <section className="today-card today-calendar">
        <h2 className="card-title"><Calendar size={18} /> Today's Schedule</h2>
        <div className="empty-inline">No calls or interviews today.</div>
      </section>
    );
  }

  return (
    <section className="today-card today-calendar">
      <div className="card-header">
        <h2 className="card-title"><Calendar size={18} /> Today's Schedule</h2>
        <span className="calendar-date">{dayNames[now.getDay()]}, {monthNames[now.getMonth()]} {now.getDate()}</span>
      </div>
      <div className="calendar-timeline">
        {items.map((item) => {
          const Icon = typeIcons[item.type] || Calendar;
          const time = new Date(item.time);
          const isPast = time < now;
          return (
            <div key={item.id} className={`calendar-item ${isPast ? 'past' : ''}`}>
              <div className="calendar-time">
                <Clock size={12} />
                <span>{time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                <span className="calendar-dur">{item.duration}m</span>
              </div>
              <div className="calendar-dot" />
              <div className="calendar-detail">
                <div className="calendar-type"><Icon size={14} /> {typeLabels[item.type]}</div>
                <strong>{item.title}</strong>
                {item.note && <p className="calendar-note">{item.note}</p>}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
