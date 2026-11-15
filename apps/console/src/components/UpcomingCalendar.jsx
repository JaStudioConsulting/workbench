import { useCallback, useEffect, useState } from "react";
import { CalendarDays, RefreshCw } from "lucide-react";
import { getUpcomingGoogleCalendar, googleConnectionGuidance } from "../google-workspace-client.js";

function formatDateOnly(value) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function formatEventStart(event) {
  if (event.start.kind === "date") return `${formatDateOnly(event.start.value)} · All day`;

  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(event.start.value));
}

export function UpcomingCalendar() {
  const [state, setState] = useState({ phase: "loading", events: [] });
  const [requestId, setRequestId] = useState(0);

  const loadEvents = useCallback(() => setRequestId((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setState({ phase: "loading", events: [] });

    getUpcomingGoogleCalendar({ signal: controller.signal })
      .then((result) => {
        setState({ phase: result.events.length === 0 ? "empty" : "success", events: result.events.slice(0, 10) });
      })
      .catch((error) => {
        if (error?.name !== "AbortError") setState({ phase: "error", events: [], code: error?.code || "GOOGLE_WORKSPACE_REQUEST_FAILED" });
      });

    return () => controller.abort();
  }, [requestId]);

  const recovery = state.phase === "error" ? googleConnectionGuidance(state.code) : null;

  return (
    <section className="google-calendar-preview" aria-labelledby="upcoming-calendar-title">
      <div className="google-calendar-heading">
        <div>
          <span className="eyebrow">READ-ONLY CALENDAR</span>
          <h3 id="upcoming-calendar-title">Upcoming events</h3>
        </div>
        {state.phase === "error" && recovery.retryable ? (
          <button type="button" className="calendar-retry" onClick={loadEvents}>
            <RefreshCw size={15} aria-hidden="true" /> Retry
          </button>
        ) : null}
      </div>

      <div aria-live="polite">
        {state.phase === "loading" ? <p className="calendar-state">Loading upcoming events…</p> : null}
        {state.phase === "empty" ? <p className="calendar-state">No upcoming events.</p> : null}
        {state.phase === "error" ? <p className="calendar-state">{recovery.message}</p> : null}
        {state.phase === "success" ? (
          <ol className="calendar-event-list">
            {state.events.map((event, index) => (
              <li key={`${event.start.value}-${event.end.value}-${event.title ?? "untitled"}-${index}`}>
                <CalendarDays size={17} aria-hidden="true" />
                <span className="calendar-event-title">{event.title ?? "No title"}</span>
                <time dateTime={event.start.value}>{formatEventStart(event)}</time>
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    </section>
  );
}
