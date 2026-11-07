import { useMemo, useState } from "react";
import { Bot, Check, Copy } from "lucide-react";
import { Button } from "../../components/ui/button.tsx";
import { Checkbox } from "../../components/ui/checkbox.tsx";
import { AI_MODULES, buildAiHandoff } from "./aiHandoff.js";
import { copyText } from "./clipboard.js";

export default function ForYourAiBox({ candidate, job, ticked, onToggle }) {
  const [copied, setCopied] = useState(false);
  const text = useMemo(() => buildAiHandoff({ candidate, job, ticked }), [candidate, job, ticked]);

  const copy = async () => {
    if (await copyText(text)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <section className="rounded-lg border bg-card p-3" aria-label="For your AI" data-testid="for-your-ai">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          <Bot size={12} /> For your AI
        </h3>
        <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={copy}>
          {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1">
        {AI_MODULES.map((module) => (
          <label key={module.id} className="flex cursor-pointer items-center gap-1.5 text-xs">
            <Checkbox
              checked={ticked.has(module.id)}
              onCheckedChange={() => onToggle(module.id)}
              aria-label={module.label}
            />
            {module.label}
          </label>
        ))}
      </div>
      <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/20 p-2 text-[11px] leading-relaxed">{text}</pre>
    </section>
  );
}
