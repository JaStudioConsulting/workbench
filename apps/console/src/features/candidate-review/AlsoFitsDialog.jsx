import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog.tsx";
import { Badge } from "../../components/ui/badge.tsx";
import { TableProperties, CheckCircle2 } from "lucide-react";

export default function AlsoFitsDialog({ fit, open, onOpenChange }) {
  if (!fit) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-card text-foreground" data-testid="also-fits-dialog">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[11px] font-mono">
              Tracker Fit Evidence
            </Badge>
          </div>
          <DialogTitle className="text-base font-bold mt-1 text-foreground">
            {fit.jobTitle}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {fit.company} · {fit.location}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 py-2 text-xs">
          {/* Tracker Row Reference */}
          <div className="rounded-lg border bg-muted/20 p-3">
            <div className="flex items-center gap-1.5 font-bold text-muted-foreground uppercase tracking-wider text-[10px] mb-2">
              <TableProperties size={13} />
              <span>Source Tracker Row</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-muted-foreground">Source Sheet:</span>
                <p className="font-semibold text-foreground">{fit.trackerRow.sheet}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Row Number:</span>
                <p className="font-semibold text-foreground">Row {fit.trackerRow.rowNumber}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Date Added:</span>
                <p className="font-semibold text-foreground">{fit.trackerRow.dateAdded}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Added By:</span>
                <p className="font-semibold text-foreground">{fit.trackerRow.addedBy}</p>
              </div>
            </div>
            {fit.trackerRow.notes && (
              <div className="mt-2.5 pt-2 border-t text-xs">
                <span className="text-muted-foreground">Tracker Notes:</span>
                <p className="mt-0.5 font-medium text-foreground">{fit.trackerRow.notes}</p>
              </div>
            )}
          </div>

          {/* Matching Resume Lines Highlighted */}
          <div className="rounded-lg border bg-background p-3">
            <div className="flex items-center gap-1.5 font-bold text-muted-foreground uppercase tracking-wider text-[10px] mb-2">
              <CheckCircle2 size={13} className="text-emerald-600" />
              <span>Matching Resume Lines</span>
            </div>
            <div className="space-y-1.5">
              {fit.matchingResumeLines && fit.matchingResumeLines.length > 0 ? (
                fit.matchingResumeLines.map((line, idx) => (
                  <div
                    key={idx}
                    className="rounded border border-amber-300 bg-amber-50/70 p-2 text-xs leading-relaxed text-amber-950 font-medium"
                  >
                    "{line}"
                  </div>
                ))
              ) : (
                <p className="text-xs text-muted-foreground">No specific line citations mapped.</p>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

