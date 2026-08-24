import { Calendar, ChevronLeft, ChevronRight, Phone, Users, Clock, CornerDownRight } from 'lucide-react';

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
  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  return (
    <section className="today-card today-calendar">
      {/* Calendar Month Selector (Matching Image 2 Calendar Header) */}
      <div className="calendar-grid-header">
        <ChevronLeft size={16} style={{ cursor: 'pointer', color: 'var(--text-muted)' }} />
        <span>September 2024</span>
        <ChevronRight size={16} style={{ cursor: 'pointer', color: 'var(--text-muted)' }} />
      </div>

      {/* Week Days Row */}
      <div className="calendar-days-row">
        {dayNames.map((d) => <span key={d}>{d}</span>)}
      </div>

      {/* Dates Row with Selected Pill (Matching Image 2 Date "19") */}
      <div className="calendar-dates-row" style={{ marginBottom: '20px' }}>
        <span className="cal-date-cell">16</span>
        <span className="cal-date-cell">17</span>
        <span className="cal-date-cell">18</span>
        <span className="cal-date-cell selected">19</span>
        <span className="cal-date-cell">20</span>
        <span className="cal-date-cell">21</span>
        <span className="cal-date-cell">22</span>
      </div>

      {/* Scheduled Events List */}
      <div className="card-header" style={{ marginBottom: '10px' }}>
        <h3 style={{ fontSize: '0.9rem', fontWeight: 800, margin: 0, color: 'var(--text-dark)' }}>
          Today's Scheduled Events
        </h3>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {(!items || items.length === 0) ? (
          <div style={{ color: 'var(--text-muted)', padding: '10px 0', fontSize: '0.82rem' }}>
            No calls or interviews today.
          </div>
        ) : (
          items.map((item) => {
            const Icon = typeIcons[item.type] || Calendar;
            const time = new Date(item.time);
            return (
              <div key={item.id} style={{ display: 'flex', alignItems: 'center', justifyBetween: 'space-between', padding: '10px 12px', background: 'var(--bg-sidebar)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ width: '28px', height: '28px', borderRadius: '8px', background: 'var(--color-sage-light)', color: 'var(--color-olive-dark)', display: 'grid', placeItems: 'center' }}>
                    <Icon size={14} />
                  </div>
                  <div>
                    <strong style={{ fontSize: '0.85rem', color: 'var(--text-dark)', display: 'block' }}>{item.title}</strong>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{typeLabels[item.type]}</span>
                  </div>
                </div>
                <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--color-olive-dark)', marginLeft: 'auto' }}>
                  {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            );
          })
        )}
      </div>

      {/* Image 2 Bottom Gauge Indicator ("Croissance - 62%") */}
      <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyBetween: 'space-between' }}>
        <div>
          <strong style={{ fontSize: '0.85rem', display: 'block', color: 'var(--text-dark)' }}>Pipeline Health</strong>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>^ 0,8 % vs last month</span>
        </div>
        <div style={{ width: '42px', height: '42px', borderRadius: '50%', border: '3px solid var(--color-olive-dark)', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: '0.78rem', color: 'var(--color-olive-dark)' }}>
          62%
        </div>
      </div>
    </section>
  );
}
