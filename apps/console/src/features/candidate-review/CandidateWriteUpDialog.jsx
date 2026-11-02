import { useMemo, useState } from "react";
import { Check, Clipboard, FileWarning, Loader2 } from "lucide-react";
import { Badge } from "../../components/ui/badge.tsx";
import { Button } from "../../components/ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog.tsx";
import { buildCandidateWriteUp } from "./brandResume.js";
import { createCandidateDraft } from "./candidateReviewService.js";

export default function CandidateWriteUpDialog({ candidate, currentJob, open, onOpenChange }) {
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const writeUp = useMemo(() => buildCandidateWriteUp(candidate), [candidate]);

  const copyWriteUp = async () => {
    setSaving(true);
    setError("");
    try {
      await createCandidateDraft({ job: currentJob, candidate, kind: "write_up", body: writeUp.text });
      await navigator.clipboard.writeText(writeUp.text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch (caught) {
      setError(caught.message || "The write-up could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" data-testid="candidate-write-up-dialog">
        <DialogHeader>
          <DialogTitle>Source-backed write-up</DialogTitle>
          <DialogDescription>
            Uses available candidate facts. Missing sources stay missing.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-2" data-testid="source-coverage">
          {writeUp.coverage.sources.map((source) => (
            <Badge key={source.key} variant="outline">
              {source.present ? <Check size={12} /> : <FileWarning size={12} />}
              {source.label}: {source.present ? "present" : "missing"}
            </Badge>
          ))}
        </div>

        <pre className="max-h-[52vh] overflow-auto whitespace-pre-wrap rounded-md border bg-muted/20 p-4 text-sm leading-relaxed">
          {writeUp.text}
        </pre>

        {error ? <p role="alert" className="text-sm font-semibold text-rose-700">{error}</p> : null}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button type="button" onClick={copyWriteUp} disabled={saving}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : copied ? <Check size={14} /> : <Clipboard size={14} />}
            {saving ? "Saving" : copied ? "Saved and copied" : "Save and copy"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
