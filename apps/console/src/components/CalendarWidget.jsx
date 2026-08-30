import { useState, useCallback } from "react";
import { Calendar as CalendarIcon, Clock, Copy, Check, ChevronLeft, ChevronRight, ExternalLink, Plus, Video, Users, X } from "lucide-react";

/**
 * References:
 * - @shadcn/calendar & @shadcn/dialog (UI component patterns)
 * - Google Calendar API / google/skills workflow (Event creation, Meet link, availability sharing)
 */

export default function CalendarWidget() {
  const [selectedDate, setSelectedDate] = useState(30);
  const [copied, setCopied] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [meetingTitle, setMeetingTitle] = useState("");
  const [meetingTime, setMeetingTime] = useState("10:00 AM");
  const [withMeet, setWithMeet] = useState(true);

  const [timeSlots, setTimeSlots] = useState([
    { id: 1, time: "09:00 AM – 10:00 AM", label: "Screening: Alex Rivera", type: "call", meet: false },
    { id: 2, time: "11:30 AM – 12:30 PM", label: "Client Interview: Sarah Kim", type: "interview", meet: true },
    { id: 3, time: "02:00 PM – 03:00 PM", label: "Profile Review: James Wu", type: "task", meet: false },
    { id: 4, time: "04:00 PM – 04:30 PM", label: "Check-in: Maria Santos", type: "call", meet: true },
  ]);

  const days = [
    { day: "M", date: 27 },
    { day: "T", date: 28 },
    { day: "W", date: 29 },
    { day: "T", date: 30, isToday: true },
    { day: "F", date: 31 },
    { day: "S", date: 1 },
    { day: "S", date: 2 },
  ];

  const handleCopyAvailability = useCallback(() => {
    const text = `Hi, here is my availability for Thursday, Aug 30 (EDT):
• 10:00 AM - 11:30 AM
• 01:00 PM - 02:00 PM
• 03:00 PM - 04:00 PM
• 04:30 PM - 05:30 PM

Google Meet link will be provided. Looking forward to speaking!`;

    navigator.clipboard?.writeText?.(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2400);
  }, []);

  const handleAddMeeting = (e) => {
    e.preventDefault();
    if (!meetingTitle.trim()) return;
    const newSlot = {
      id: Date.now(),
      time: `${meetingTime} – ${meetingTime.replace("00", "45")}`,
      label: meetingTitle,
      type: "interview",
      meet: withMeet,
    };
    setTimeSlots([newSlot, ...timeSlots]);
    setMeetingTitle("");
    setShowAddModal(false);
  };

  return (
    <div className="calendar-widget-card" aria-label="Google Calendar Widget">
      {/* Header with Navigation & Add Meeting */}
      <div className="cal-header">
        <div className="cal-title-wrap">
          <CalendarIcon size={15} className="cal-icon" />
          <span className="cal-title">August 2026</span>
        </div>
        <div className="cal-nav-btns">
          <button
            className="cal-add-meeting-btn"
            onClick={() => setShowAddModal(true)}
            title="Add Google Meet / Interview"
          >
            <Plus size={13} />
            <span>Add meeting</span>
          </button>
          <button className="cal-nav-btn" aria-label="Previous week"><ChevronLeft size={13} /></button>
          <button className="cal-nav-btn" aria-label="Next week"><ChevronRight size={13} /></button>
          <a
            href="https://calendar.google.com"
            target="_blank"
            rel="noopener noreferrer"
            className="cal-gcal-link"
            title="Open in Google Calendar"
          >
            <ExternalLink size={12} />
          </a>
        </div>
      </div>

      {/* Week Day Strip (ref: @shadcn/calendar date row pattern) */}
      <div className="cal-days-strip">
        {days.map((d, i) => (
          <button
            key={i}
            className={`cal-day-pill ${selectedDate === d.date ? "selected" : ""} ${d.isToday ? "today" : ""}`}
            onClick={() => setSelectedDate(d.date)}
          >
            <span className="cal-day-letter">{d.day}</span>
            <span className="cal-day-num">{d.date}</span>
          </button>
        ))}
      </div>

      {/* Schedule Agenda */}
      <div className="cal-agenda">
        <div className="cal-agenda-header">
          <span className="cal-agenda-label">Thursday, Aug 30</span>
          <span className="cal-agenda-count">{timeSlots.length} scheduled</span>
        </div>

        <div className="cal-slots-list">
          {timeSlots.map((slot) => (
            <div key={slot.id} className={`cal-slot-item type-${slot.type}`}>
              <div className="cal-slot-top">
                <span className="cal-slot-time">{slot.time}</span>
                {slot.meet && (
                  <span className="cal-meet-badge" title="Google Meet video call">
                    <Video size={10} /> Meet
                  </span>
                )}
              </div>
              <span className="cal-slot-label">{slot.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Action Footer: Copy Availability */}
      <div className="cal-footer">
        <button
          className={`cal-copy-btn ${copied ? "copied" : ""}`}
          onClick={handleCopyAvailability}
          aria-label="Copy availability to clipboard"
        >
          {copied ? (
            <>
              <Check size={14} />
              <span>Availability Copied!</span>
            </>
          ) : (
            <>
              <Copy size={14} />
              <span>Copy Availability</span>
            </>
          )}
        </button>
      </div>

      {/* Add Meeting Dialog Modal (ref: @shadcn/dialog) */}
      {showAddModal && (
        <div className="cal-modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="cal-modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="cal-modal-header">
              <h3>Schedule Meeting</h3>
              <button className="cal-modal-close" onClick={() => setShowAddModal(false)}><X size={15} /></button>
            </div>
            <form onSubmit={handleAddMeeting} className="cal-modal-form">
              <label>
                <span>Meeting Title / Candidate</span>
                <input
                  type="text"
                  placeholder="e.g. Screening Call — Marcus Chen"
                  value={meetingTitle}
                  onChange={(e) => setMeetingTitle(e.target.value)}
                  autoFocus
                  required
                />
              </label>
              <div className="cal-form-row">
                <label>
                  <span>Time</span>
                  <select value={meetingTime} onChange={(e) => setMeetingTime(e.target.value)}>
                    <option value="09:00 AM">09:00 AM EDT</option>
                    <option value="10:00 AM">10:00 AM EDT</option>
                    <option value="11:30 AM">11:30 AM EDT</option>
                    <option value="02:00 PM">02:00 PM EDT</option>
                    <option value="04:00 PM">04:00 PM EDT</option>
                  </select>
                </label>
                <label className="cal-meet-toggle-label">
                  <span>Google Meet</span>
                  <button
                    type="button"
                    className={`cal-meet-toggle-btn ${withMeet ? "active" : ""}`}
                    onClick={() => setWithMeet(!withMeet)}
                  >
                    <Video size={13} /> {withMeet ? "Attached" : "None"}
                  </button>
                </label>
              </div>
              <div className="cal-modal-actions">
                <button type="button" className="cal-btn-cancel" onClick={() => setShowAddModal(false)}>Cancel</button>
                <button type="submit" className="cal-btn-submit">Add to Calendar</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
