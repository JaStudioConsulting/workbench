import { useMemo } from "react";
import { Badge } from "../../components/ui/badge.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover.tsx";
import { scoreFit } from "./fitScore.js";

const LABELS = { strong: "Strong", possible: "Possible", weak: "Weak", unknown: "Unknown" };
const TONES = {
  strong: "border-emerald-700/30 bg-emerald-50 text-emerald-900",
  possible: "border-amber-700/30 bg-amber-50 text-amber-900",
  weak: "border-clay/30 bg-muted text-foreground",
  unknown: "border-border bg-background text-muted-foreground",
};

function EvidenceList({ title, items, empty }) {
  return <section><p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
    {items?.length ? <ul className="list-disc space-y-1 pl-4 text-sm">{items.map((item) => <li key={item}>{item}</li>)}</ul>
      : <p className="text-sm text-muted-foreground">{empty}</p>}
  </section>;
}

export default function FitBadge({ job, candidate }) {
  const result = useMemo(() => scoreFit(job, candidate), [job, candidate]);

  return <Popover>
    <PopoverTrigger render={<button type="button" className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" aria-label={`${LABELS[result.level] || "Unknown"} fit. Show evidence.`} />}>
      <Badge variant="outline" className={TONES[result.level] || TONES.unknown}>{LABELS[result.level] || "Unknown"}</Badge>
    </PopoverTrigger>
    <PopoverContent className="w-80 gap-3" align="start">
      <div><p className="font-semibold">Rules check</p><p className="text-xs text-muted-foreground">{LABELS[result.level] || "Unknown"} fit</p></div>
      <EvidenceList title="Strengths" items={result.strengths} empty="No clear strengths found in source." />
      <EvidenceList title="Gaps" items={result.gaps} empty="No clear gaps found in source." />
    </PopoverContent>
  </Popover>;
}
