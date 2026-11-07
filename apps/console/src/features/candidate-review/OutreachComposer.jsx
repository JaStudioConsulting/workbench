import { useEffect, useMemo, useState } from "react";
import { Check, Clipboard, ExternalLink, Loader2, Mail, Sparkles } from "lucide-react";
import { Button } from "../../components/ui/button.tsx";
import { Input } from "../../components/ui/input.tsx";
import { Textarea } from "../../components/ui/textarea.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog.tsx";
import {
  OUTREACH_TEMPLATES,
  buildMailto,
  canSaveGmailDraft,
  pickRoleOptions,
  renderOutreach,
  stripDashes,
} from "./outreachTemplates.js";
import { copyText } from "./clipboard.js";
import { getMailStatus, getProfile, logOutreach, personalizeOutreach, province, saveGmailDraft } from "./externals.js";

// Outreach is always a draft. Copy, open in Mail, or save a Gmail draft. Ja sends it himself.
export default function OutreachComposer({ open, onOpenChange, candidate, currentJob, jobs, onDrafted }) {
  const [templateId, setTemplateId] = useState(OUTREACH_TEMPLATES[0].id);
  const [roleId, setRoleId] = useState(currentJob ? String(currentJob.id) : "");
  const [signature, setSignature] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [draftAllowed, setDraftAllowed] = useState(true);

  const roles = useMemo(() => pickRoleOptions(currentJob, jobs, province), [currentJob, jobs]);
  const role = roles.find((item) => String(item.id) === String(roleId)) || currentJob || null;
  const template = OUTREACH_TEMPLATES.find((item) => item.id === templateId) || OUTREACH_TEMPLATES[0];
  const email = String(candidate?.email || "").trim();

  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    setNotice("");
    setError("");
    Promise.resolve()
      .then(() => getProfile())
      .then((profile) => active && setSignature(String(profile?.signature || "")))
      .catch(() => active && setSignature(""));
    Promise.resolve()
      .then(() => getMailStatus())
      .then((status) => active && setDraftAllowed(canSaveGmailDraft(status)))
      .catch(() => active && setDraftAllowed(false));
    return () => {
      active = false;
    };
  }, [open]);

  useEffect(() => {
    if (open && currentJob) setRoleId(String(currentJob.id));
  }, [open, currentJob]);

  useEffect(() => {
    if (!open) return;
    const next = renderOutreach({ template, candidate, job: role, signature });
    setSubject(next.subject);
    setBody(next.body);
    // Rebuild only when the inputs change by identity, so edits survive a background refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, templateId, candidate?.id, role?.id, signature]);

  const record = async (channel) => {
    onDrafted?.();
    try {
      await logOutreach({
        jobId: role?.id ?? null,
        personId: candidate.id,
        candidateEmail: email,
        subject,
        body,
        channel,
      });
      return true;
    } catch {
      setError("The draft worked, but the outreach log did not save.");
      return false;
    }
  };

  const copy = async () => {
    setError("");
    if (!(await copyText(`Subject: ${subject}\n\n${body}`))) {
      setError("Copy did not work in this browser.");
      return;
    }
    setNotice("Copied. Nothing was sent.");
    await record("copy");
  };

  const openInMail = async () => {
    setError("");
    window.location.href = buildMailto({ to: email, subject, body });
    setNotice("Opened your mail app as a draft. Nothing was sent.");
    await record("mailto");
  };

  const personalize = async () => {
    setError("");
    setNotice("");
    setBusy("ai");
    try {
      const result = await personalizeOutreach({ job: role, candidate, template, body });
      if (result?.available === false) {
        setNotice("AI not set up");
      } else if (!result?.ok || !result.result?.body) {
        setError(result?.error || "AI could not personalize this draft. Your text is unchanged.");
      } else {
        setBody(stripDashes(result.result.body));
        if (result.result.subject) setSubject(stripDashes(result.result.subject));
        setNotice("Personalized with AI. Read it before you use it.");
      }
    } catch (caught) {
      setError(caught?.message || "AI could not personalize this draft.");
    } finally {
      setBusy("");
    }
  };

  const saveDraft = async () => {
    setError("");
    setNotice("");
    setBusy("gmail");
    try {
      const result = await saveGmailDraft({ to: email, subject, body });
      if (result?.ok) {
        setNotice("Saved as a Gmail draft. Nothing was sent.");
        await record("gmail_draft");
      } else if (result?.reason === "no_scope") {
        setDraftAllowed(false);
      } else {
        setError("Gmail draft was not saved. Use Copy or Open in Mail instead.");
      }
    } catch (caught) {
      setError(caught?.message || "Gmail draft was not saved.");
    } finally {
      setBusy("");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" data-testid="outreach-composer">
        <DialogHeader>
          <DialogTitle>Outreach to {candidate?.name}</DialogTitle>
          <DialogDescription>Draft only. You send it yourself.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs font-semibold">
            Template
            <select
              value={templateId}
              onChange={(event) => setTemplateId(event.target.value)}
              className="h-9 rounded-md border bg-background px-2 text-xs font-normal"
            >
              {OUTREACH_TEMPLATES.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold">
            Role
            <select
              value={String(role?.id ?? "")}
              onChange={(event) => setRoleId(event.target.value)}
              className="h-9 rounded-md border bg-background px-2 text-xs font-normal"
              disabled={roles.length === 0}
            >
              {roles.length === 0 ? <option value="">No role selected</option> : null}
              {roles.map((item) => (
                <option key={item.id} value={String(item.id)}>
                  {item.title}{item.company ? ` at ${item.company}` : ""}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="flex flex-col gap-1 text-xs font-semibold">
          Subject
          <Input value={subject} onChange={(event) => setSubject(event.target.value)} className="text-sm font-normal" />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold">
          Message
          <Textarea value={body} onChange={(event) => setBody(event.target.value)} rows={11} className="text-sm font-normal" />
        </label>

        {!email ? <p className="text-xs text-muted-foreground">Email: Not on file. Copy still works.</p> : null}
        {notice ? <p role="status" className="flex items-center gap-1 text-xs font-semibold text-emerald-800"><Check size={13} /> {notice}</p> : null}
        {error ? <p role="alert" className="text-xs font-semibold text-rose-700">{error}</p> : null}

        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={personalize} disabled={busy === "ai" || !body.trim()}>
            {busy === "ai" ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Personalize with AI
          </Button>
          <Button type="button" variant="outline" onClick={copy} disabled={!body.trim()}>
            <Clipboard size={14} /> Copy
          </Button>
          <Button type="button" variant="outline" onClick={openInMail} disabled={!email || !body.trim()}>
            <ExternalLink size={14} /> Open in Mail
          </Button>
          {draftAllowed ? (
            <Button type="button" onClick={saveDraft} disabled={busy === "gmail" || !email || !body.trim()}>
              {busy === "gmail" ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />} Save as Gmail draft
            </Button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
