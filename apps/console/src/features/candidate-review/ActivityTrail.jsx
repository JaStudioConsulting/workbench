import { Clock, AlertTriangle, User, HelpCircle } from "lucide-react";
import { Badge } from "../../components/ui/badge.tsx";

export default function ActivityTrail({ candidate }) {
  const events = candidate.activityTrail || [];
  const otherContacts = events.filter(
    (ev) => !ev.isJa && ev.actor && !ev.actorUnknown
  );

  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-card p-3" data-testid="candidate-activity-trail">
      <div className="flex items-center justify-between gap-2 border-b pb-2">
        <div className="flex items-center gap-1.5">
          <Clock size={14} className="text-muted-foreground" />
          <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Activity Trail ({events.length})
          </h4>
        </div>

        {otherContacts.length > 0 && (
          <Badge
            variant="outline"
            className="border-amber-400 bg-amber-50 text-amber-900 text-[10.5px] font-semibold flex items-center gap-1 py-0.5 px-2"
          >
            <AlertTriangle size={11} className="text-amber-700" />
            {otherContacts.length} other contact{otherContacts.length > 1 ? "s" : ""} on record
          </Badge>
        )}
      </div>

      {events.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2 text-center">
          No recorded activity for this candidate.
        </p>
      ) : (
        <div className="flex flex-col gap-2 max-h-56 overflow-y-auto pr-1">
          {events.map((ev, index) => {
            const isOther = !ev.isJa && ev.actor && !ev.actorUnknown;
            const isUnknownActor = ev.actorUnknown || !ev.actor;

            return (
              <div
                key={ev.id || index}
                className={`rounded-md border p-2 text-xs transition-colors ${
                  isOther
                    ? "border-amber-300 bg-amber-50/60 text-amber-950"
                    : "border-border bg-background/60 text-foreground"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-bold leading-tight">{ev.type}</span>
                    {ev.status === "Waiting for Loxo" && (
                      <Badge variant="outline" className="text-[10px] py-0 px-1.5 border-dashed border-amber-500 text-amber-700 bg-amber-50">
                        Waiting for Loxo
                      </Badge>
                    )}
                  </div>
                  <span className="shrink-0 text-[11px] text-muted-foreground font-mono">
                    {ev.date}
                  </span>
                </div>

                <div className="mt-1 flex items-center gap-1.5 text-[11px]">
                  {isOther ? (
                    <span className="flex items-center gap-1 font-semibold text-amber-800">
                      <User size={11} />
                      Done by {ev.actor} (other contact)
                    </span>
                  ) : isUnknownActor ? (
                    <span className="flex items-center gap-1 text-muted-foreground italic">
                      <HelpCircle size={11} />
                      Author not verified by Loxo
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-muted-foreground font-medium">
                      <User size={11} />
                      {ev.actor}
                    </span>
                  )}
                </div>

                {ev.note && (
                  <p className="mt-1.5 whitespace-pre-wrap text-[11.5px] leading-relaxed border-t pt-1 border-border/40">
                    {ev.note}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

