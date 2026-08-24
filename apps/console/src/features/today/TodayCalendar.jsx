import { Calendar, Phone, Users, Clock, CornerDownRight, ChevronDown } from 'lucide-react';

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
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  return (
    <section className="today-card today-calendar">
      <div className="card-header" style={{ marginBottom: '16px' }}>
        <h2 className="card-title">
          <Calendar size={18} /> Schedule
        </h2>
        <span style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.7)', display: 'flex', alignItems: 'center', gap: '4px', background: 'rgba(255,255,255,0.1)', padding: '4px 12px', borderRadius: '99px' }}>
          {monthNames[now.getMonth()]} <ChevronDown size={14} />
        </span>
      </div>

      <div className="calendar-timeline">
        {(!items || items.length === 0) ? (
          <div style={{ color: 'rgba(255,255,255,0.5)', padding: '20px 0', textAlign: 'center', fontSize: '0.85rem' }}>
            No calls or interviews today.
          </div>
        ) : (
          items.map((item) => {
            const Icon = typeIcons[item.type] || Calendar;
            const time = new Date(item.time);
            const isPast = time < now;
            return (
              <div key={item.id} className={`calendar-item ${isPast ? 'past' : ''}`}>
                <div className="calendar-dot" />
                <div className="calendar-detail" style={{ flex: 1 }}>
                  <div className="calendar-type">
                    <Icon size={12} /> {typeLabels[item.type]}
                  </div>
                  <strong>{item.title}</strong>
                </div>
                <div className="calendar-time">
                  {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div style={{ display: 'flex', gap: '12px', marginTop: '18px', paddingTop: '14px', borderTop: '1px solid rgba(255,255,255,0.1)', fontSize: '0.75rem', color: 'rgba(255,255,255,0.6)' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#FFC82C' }} /> Active
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#5A674E' }} /> Done
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'rgba(255,255,255,0.3)' }} /> Scheduled
        </span>
      </div>
    </section>
  );
}
