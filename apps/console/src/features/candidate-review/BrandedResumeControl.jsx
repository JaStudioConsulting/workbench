import { useId, useState } from "react";
import { AlertCircle, FileText, Loader2 } from "lucide-react";
import { Button } from "../../components/ui/button.tsx";
import { requestBrandedResume, saveBlobAsFile } from "./brandedResumeClient.js";

const FORMATS = [
  { id: "pdf", label: "PDF", busy: "Making PDF…" },
  { id: "docx", label: "Word", busy: "Making Word file…" },
];

// "Branded resume" with PDF and Word choices. `text` is the saved resume text, sent as is.
export default function BrandedResumeControl({ text, candidateName, className = "", compact = false }) {
  const [busyFormat, setBusyFormat] = useState(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const messageId = useId();
  const height = compact ? "h-8" : "h-10";

  const make = async (format) => {
    setError("");
    setDone("");
    setBusyFormat(format.id);
    try {
      const file = await requestBrandedResume({ text, candidateName, format: format.id });
      saveBlobAsFile(file);
      setDone(`${format.label} file saved as ${file.fileName}`);
    } catch (failure) {
      setError(failure?.message || `The ${format.label} file could not be made. Try again, or use the other format.`);
    } finally {
      setBusyFormat(null);
    }
  };

  return (
    <div className={`flex min-w-0 flex-wrap items-center gap-1.5 ${className}`} role="group" aria-label="Branded resume" aria-describedby={error || done ? messageId : undefined} data-testid="branded-resume-control">
      <span className="inline-flex items-center text-xs font-semibold"><FileText size={compact ? 13 : 15} className="mr-1.5 shrink-0" aria-hidden="true" />Branded resume</span>
      {FORMATS.map((format) => (
        <Button
          key={format.id}
          type="button"
          variant="outline"
          size={compact ? "sm" : "default"}
          className={`${height} text-xs font-semibold`}
          disabled={Boolean(busyFormat)}
          aria-label={busyFormat === format.id ? format.busy : `Download branded resume as ${format.label}`}
          onClick={() => make(format)}
          data-testid={`branded-resume-${format.id}`}
        >
          {busyFormat === format.id ? <><Loader2 size={13} className="mr-1 animate-spin" aria-hidden="true" />{format.busy}</> : format.label}
        </Button>
      ))}
      <div id={messageId} className="w-full text-xs" aria-live="polite">
        {error ? <p role="alert" className="flex items-start gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-destructive"><AlertCircle size={14} className="mt-0.5 shrink-0" aria-hidden="true" /><span className="min-w-0 break-words">{error}</span></p> : null}
        {done ? <p className="min-w-0 break-words text-muted-foreground">{done}</p> : null}
      </div>
    </div>
  );
}
