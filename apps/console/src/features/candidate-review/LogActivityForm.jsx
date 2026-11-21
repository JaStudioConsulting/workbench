import { useId, useState } from "react";
import { LOXO_LOGGABLE_ACTIVITIES } from "./constants.js";
import { Button } from "../../components/ui/button.tsx";
import { Textarea } from "../../components/ui/textarea.tsx";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select.tsx";
import { Badge } from "../../components/ui/badge.tsx";
import { ArrowRight, Clock, PlusCircle, AlertCircle } from "lucide-react";

const ACTIVITY_TYPE_ITEMS = LOXO_LOGGABLE_ACTIVITIES.map((activity) => ({
  value: activity.name,
  label: activity.name,
}));

export default function LogActivityForm({ candidateId, onLogActivity }) {
  const typeId = useId();
  const noteId = useId();
  const [selectedType, setSelectedType] = useState(LOXO_LOGGABLE_ACTIVITIES[0].name);
  const [note, setNote] = useState("");
  const [justLogged, setJustLogged] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [pendingIdempotencyKey, setPendingIdempotencyKey] = useState(
    () => `activity-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );

  const currentActivityConfig = LOXO_LOGGABLE_ACTIVITIES.find(
    (act) => act.name === selectedType
  ) || LOXO_LOGGABLE_ACTIVITIES[0];

  const handleSubmit = async (e) => {
    e?.preventDefault();
    if (!onLogActivity) return;

    setIsSubmitting(true);
    setErrorMessage("");

    try {
      const res = await onLogActivity(candidateId, {
        type: currentActivityConfig.name,
        note: note.trim(),
        targetStage: currentActivityConfig.trigger,
        idempotencyKey: pendingIdempotencyKey,
      });

      if (res && res.ok === false) {
        throw new Error(res.error || "Failed to queue activity in local outbox");
      }

      // Preserve note rule: only clear note on verified write success
      setNote("");
      setJustLogged(true);
      setPendingIdempotencyKey(
        `activity-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      );
      setTimeout(() => {
        setJustLogged(false);
      }, 4000);
    } catch (err) {
      // Preserve activity note when logging fails
      setErrorMessage(err.message || "Failed to record activity. Note preserved for retry.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 rounded-lg border bg-card p-3" data-testid="log-activity-form">
      <div className="flex items-center justify-between gap-2 border-b pb-1.5">
        <div className="flex items-center gap-1.5">
          <PlusCircle size={14} className="text-muted-foreground" />
          <h4 className="text-sm font-semibold">
            Log activity
          </h4>
        </div>
        {justLogged && (
          <Badge variant="outline" className="text-xs border-amber-400 bg-amber-50 text-amber-900 flex items-center gap-1">
            <Clock size={11} className="text-amber-700 animate-pulse" />
            Waiting for Loxo
          </Badge>
        )}
      </div>

      {errorMessage && (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive flex items-center justify-between gap-2"
        >
          <span className="flex items-center gap-1.5">
            <AlertCircle size={13} className="shrink-0" />
            {errorMessage}
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={handleSubmit}
            className="h-6 px-2 text-xs underline"
          >
            Retry
          </Button>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <div>
          <label htmlFor={typeId} className="text-xs font-semibold text-muted-foreground block mb-1">
            Activity type
          </label>
          <Select items={ACTIVITY_TYPE_ITEMS} value={selectedType} onValueChange={setSelectedType} disabled={isSubmitting}>
            <SelectTrigger id={typeId} className="w-full text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {LOXO_LOGGABLE_ACTIVITIES.map((act) => (
                  <SelectItem key={act.name} value={act.name} className="text-xs">
                    {act.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>

        {/* Stage Trigger Feedback */}
        <div className="rounded-md border bg-muted/30 p-2 text-xs flex items-center justify-between gap-2">
          <span className="text-muted-foreground">Loxo stage trigger:</span>
          {currentActivityConfig.trigger === "No automatic stage change" ? (
            <span className="font-medium text-muted-foreground">No automatic stage change</span>
          ) : (
            <span className="font-semibold text-foreground flex items-center gap-1">
              Moves to <ArrowRight size={11} /> {currentActivityConfig.trigger}
            </span>
          )}
        </div>

        <div>
          <label htmlFor={noteId} className="text-xs font-semibold text-muted-foreground block mb-1">
            Note
          </label>
          <Textarea
            id={noteId}
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={isSubmitting}
            placeholder="Call summary, compensation notes, or next steps..."
            className="text-xs resize-none"
          />
        </div>

        <div className="flex items-center justify-between gap-2 pt-1">
          <p className="text-xs text-muted-foreground">
            Saved here. Waiting for Loxo.
          </p>
          <Button
            type="submit"
            size="sm"
            disabled={isSubmitting}
            className="text-xs font-semibold px-3 h-8"
          >
            {isSubmitting ? "Saving..." : "Log activity"}
          </Button>
        </div>
      </div>
    </form>
  );
}
