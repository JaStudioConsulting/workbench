import { useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import { Button } from "../../components/ui/button.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover.tsx";
import { REJECT_REASONS } from "./rejectReasons.js";

// Pass button that asks for a reason first. Works with Tab, Enter, Space and the arrow keys.
export default function RejectMenu({ onReject, disabled, open, onOpenChange }) {
  const [internalOpen, setInternalOpen] = useState(false);
  const listRef = useRef(null);
  const isOpen = open ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;

  const moveFocus = (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const items = Array.from(listRef.current?.querySelectorAll("button") || []);
    if (!items.length) return;
    event.preventDefault();
    const at = items.indexOf(document.activeElement);
    const next = event.key === "ArrowDown" ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
    items[next].focus();
  };

  const choose = (reason) => {
    setOpen(false);
    onReject(reason);
  };

  return (
    <Popover open={isOpen} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            aria-label="Pass on this candidate, pick a reason"
            className="h-10 max-w-[200px] flex-1 border-rose-300 text-xs font-bold text-rose-800 hover:border-rose-400 hover:bg-rose-50"
            data-testid="reject-menu-trigger"
          />
        }
      >
        {disabled ? <Loader2 size={15} className="mr-1.5 animate-spin" /> : <X size={15} className="mr-1.5" />} Pass
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-72 gap-1">
        <p className="px-1 text-xs font-semibold text-muted-foreground">Why are you passing?</p>
        <div ref={listRef} role="group" aria-label="Reason for passing" onKeyDown={moveFocus} className="flex flex-col gap-1">
          {REJECT_REASONS.map((reason) => (
            <button
              key={reason}
              type="button"
              onClick={() => choose(reason)}
              className="rounded-md px-2 py-1.5 text-left text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {reason}
            </button>
          ))}
        </div>
        <p className="px-1 text-[11px] text-muted-foreground">The note waits for Loxo. Nothing is written there yet.</p>
      </PopoverContent>
    </Popover>
  );
}
