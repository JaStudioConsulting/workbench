import { useEffect, useRef, useState } from "react";
import { loadMeetingTranscriptPreview } from "./meetingTranscriptPreview.js";

export default function MeetingTranscriptPreview({ originKey, candidateId }) {
  const [preview, setPreview] = useState({ status: "loading", transcript: null });
  const refreshRef = useRef(() => {});

  useEffect(() => {
    let active = true;
    let generation = 0;
    const load = async () => {
      const request = ++generation;
      if (active) setPreview({ status: "loading", transcript: null });
      try {
        const result = await loadMeetingTranscriptPreview({ originKey, candidateId });
        if (active && request === generation) setPreview(result);
      } catch {
        if (active && request === generation) setPreview({ status: "unavailable", transcript: null });
      }
    };
    refreshRef.current = load;
    void load();
    const timer = window.setInterval(() => { void load(); }, 60_000);
    const onFocus = () => { void load(); };
    window.addEventListener("focus", onFocus);
    return () => {
      active = false;
      generation += 1;
      refreshRef.current = () => {};
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [originKey, candidateId]);

  return (
    <section className="rounded-md border bg-muted/20 p-3" aria-label="Meeting transcript">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">Meeting transcript</h4>
        <button type="button" className="text-xs underline" onClick={() => { void refreshRef.current(); }}>Refresh</button>
      </div>
      {preview.status === "loading" ? <p role="status" className="mt-2 text-xs text-muted-foreground">Loading current transcript…</p> : null}
      {preview.status === "available" ? <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-sm">{preview.transcript}</pre> : null}
      {preview.status === "unavailable" ? <p className="mt-2 text-xs text-muted-foreground">Transcript unavailable or expired.</p> : null}
    </section>
  );
}
