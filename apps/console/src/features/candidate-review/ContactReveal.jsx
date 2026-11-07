import { useState } from "react";
import { Check, Copy, Mail, Phone } from "lucide-react";
import { Button } from "../../components/ui/button.tsx";
import { copyText } from "./clipboard.js";

function RevealField({ label, value, icon: Icon, mono }) {
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  const clean = String(value || "").trim();

  if (!clean) {
    return (
      <span className="flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs text-muted-foreground">
        <Icon size={12} /> {label}: Not on file
      </span>
    );
  }
  if (!shown) {
    return (
      <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShown(true)}>
        <Icon size={12} /> Show {label.toLowerCase()}
      </Button>
    );
  }
  const copy = async () => {
    if (await copyText(clean)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }
  };
  return (
    <span className="flex items-center gap-1 rounded-md border bg-background px-2 py-0.5 text-xs">
      <Icon size={12} className="text-muted-foreground" />
      <span className={mono ? "font-mono" : ""}>{clean}</span>
      <Button type="button" size="icon-xs" variant="ghost" onClick={copy} aria-label={`Copy ${label.toLowerCase()}`}>
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </Button>
    </span>
  );
}

export default function ContactReveal({ candidate }) {
  const phone = String(candidate?.phone || "").trim();
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="contact-reveal">
      <RevealField label="Email" value={candidate?.email} icon={Mail} />
      <RevealField label="Number" value={phone} icon={Phone} mono />
      {phone ? (
        <a
          href={`tel:${phone.replace(/\s/g, "")}`}
          className="inline-flex h-7 items-center rounded-md border bg-background px-2.5 text-xs font-semibold hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Phone size={12} className="mr-1" /> Call
        </a>
      ) : null}
    </div>
  );
}
