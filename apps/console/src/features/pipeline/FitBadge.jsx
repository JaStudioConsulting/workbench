import { useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import { Badge } from "../../components/ui/badge.tsx";
import { Button } from "../../components/ui/button.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover.tsx";
import { evaluateFit } from "./aiClient.js";
import { scoreFit } from "./fitScore.js";

const fitCache = new Map();
const LABELS = { strong: "Strong", possible: "Possible", weak: "Weak", unknown: "Unknown" };
const TONES = {
  strong: "border-emerald-700/30 bg-emerald-50 text-emerald-900",
  possible: "border-amber-700/30 bg-amber-50 text-amber-900",
  weak: "border-clay/30 bg-muted text-foreground",
  unknown: "border-border bg-background text-muted-foreground",
};

function cacheKey(job, candidate) {
  return `${job?.id || job?.jobId || "job"}::${candidate?.id || candidate?.candidateId || "candidate"}`;
}

function EvidenceList({ title, items, empty }) {
  return <section><p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
    {items?.length ? <ul className="list-disc space-y-1 pl-4 text-sm">{items.map((item) => <li key={item}>{item}</li>)}</ul>
      : <p className="text-sm text-muted-foreground">{empty}</p>}
  </section>;
}

export default function FitBadge({ job, candidate }) {
  const rulesResult = useMemo(() => scoreFit(job, candidate), [job, candidate]);
  const key = cacheKey(job, candidate);
  const [aiResult, setAiResult] = useState(() => fitCache.get(key) || null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const result = aiResult || rulesResult;

  const runAiCheck = async () => {
    setChecking(true);
    setError("");
    const response = await evaluateFit(job, candidate);
    if (response.ok) {
      fitCache.set(key, response.result);
      setAiResult(response.result);
    } else {
      setError(response.error || (response.available ? "AI check failed" : "AI check not set up"));
    }
    setChecking(false);
  };

  return <Popover>
    <PopoverTrigger render={<button type="button" className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" aria-label={`${LABELS[result.level] || "Unknown"} fit. Show evidence.`} />}>
      <Badge variant="outline" className={TONES[result.level] || TONES.unknown}>{LABELS[result.level] || "Unknown"}</Badge>
    </PopoverTrigger>
    <PopoverContent className="w-80 gap-3" align="start">
      <div><p className="font-semibold">{aiResult ? "AI check" : "Rules check"}</p><p className="text-xs text-muted-foreground">{LABELS[result.level] || "Unknown"} fit</p></div>
      <EvidenceList title="Strengths" items={result.strengths} empty="No clear strengths found in source." />
      <EvidenceList title="Gaps" items={result.gaps} empty="No clear gaps found in source." />
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <Button size="sm" variant="outline" onClick={runAiCheck} disabled={checking}>
        <Sparkles size={14} /> {checking ? "Checking..." : "Deep check with AI"}
      </Button>
    </PopoverContent>
  </Popover>;
}

export { fitCache as _fitCacheForTesting };
