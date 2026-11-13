import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Clipboard, ExternalLink, FilePlus2, Mail, RefreshCw } from "lucide-react";
import { Button } from "../../components/ui/button.tsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card.tsx";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog.tsx";
import { Label } from "../../components/ui/label.tsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table.tsx";
import { Textarea } from "../../components/ui/textarea.tsx";
import { followUpsDue } from "../home/homeService.js";
import { getProfile } from "../profile/profileService.js";
import { getMailStatus, listMailReplies, listOutreach, logOutreach, saveGmailDraft } from "./mailClient.js";
import { buildFollowUp, channelLabel, mailtoUrl, repliedAtFor } from "./mailPageService.js";

function formatDate(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(date)
    : "Date not on file";
}

function statusCopy(status) {
  if (status.error) return "Gmail status could not be checked. Retry to see which actions are available.";
  if (!status.connected) return "Gmail is not connected. Copy and Open in Mail are available.";
  if (!status.canDraft) return status.canRead
    ? "Gmail reply checking is connected. Gmail draft access is not approved."
    : "Gmail is connected without mail access.";
  return status.canRead ? "Gmail reply checking and draft saving are available." : "Gmail draft saving is available. Reply checking is not approved.";
}

function FollowUpDialog({ outreach, profile, canDraft, onClose, onLogged }) {
  const initial = useMemo(() => buildFollowUp(profile), [profile]);
  const [body, setBody] = useState(initial.body);
  const [working, setWorking] = useState("");
  const [message, setMessage] = useState("");
  const [pendingLog, setPendingLog] = useState(null);

  useEffect(() => { setBody(initial.body); setMessage(""); setPendingLog(null); }, [initial, outreach]);

  const activity = { jobId: outreach.jobId, personId: outreach.personId, candidateEmail: outreach.candidateEmail, subject: initial.subject, body };
  const record = async (channel, sourceActivity = activity) => {
    const entry = { ...sourceActivity, channel };
    try {
      const logged = await logOutreach(entry);
      onLogged(logged);
      setPendingLog(null);
      return true;
    } catch {
      setPendingLog(entry);
      return false;
    }
  };
  const retryLog = async () => {
    if (!pendingLog) return;
    setWorking("history");
    const saved = await record(pendingLog.channel, pendingLog);
    setMessage(saved ? "Outreach history saved." : "Outreach history still could not be saved. Your draft remains here; try again.");
    setWorking("");
  };
  const copy = async () => {
    setWorking("copy"); setMessage("");
    try {
      if (!globalThis.navigator?.clipboard?.writeText) throw new Error("Copy is unavailable in this browser");
      await globalThis.navigator.clipboard.writeText(`${initial.subject}\n\n${body}`);
      const saved = await record("copy");
      setMessage(saved ? "Follow-up copied and saved to outreach history." : "Follow-up copied. Outreach history was not saved; retry below.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Follow-up could not be copied.");
    } finally { setWorking(""); }
  };
  const openMail = async () => {
    setWorking("mailto"); setMessage("");
    try {
      const logged = await record("mailto");
      globalThis.location.href = mailtoUrl({ to: outreach.candidateEmail, subject: initial.subject, body });
      setMessage(logged ? "Opening your mail app. Outreach history saved." : "Opening your mail app. Outreach history was not saved; retry below.");
    } catch {
      setMessage("The mail draft could not be opened.");
    } finally { setWorking(""); }
  };
  const gmailDraft = async () => {
    setWorking("gmail"); setMessage("");
    try {
      const result = await saveGmailDraft({ to: outreach.candidateEmail, subject: initial.subject, body });
      if (!result.ok) {
        setMessage(result.reason === "no_scope" ? "Gmail draft access is not approved." : "Gmail draft could not be saved.");
        return;
      }
      const logged = await record("gmail_draft");
      setMessage(logged ? "Gmail draft saved. Review it in Gmail before sending." : "Gmail draft saved, but outreach history was not saved. Review the draft in Gmail and retry history below.");
    } catch {
      setMessage("Gmail draft could not be saved.");
    } finally { setWorking(""); }
  };

  return (
    <Dialog open={Boolean(outreach)} onOpenChange={(open) => { if (!open && !working) onClose(); }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader><DialogTitle>Draft follow-up</DialogTitle><DialogDescription>Review the draft before copying it or opening it in mail.</DialogDescription></DialogHeader>
        <div className="grid gap-4 py-2">
          <div><p className="text-xs text-muted-foreground">To</p><p className="text-sm font-medium">{outreach.candidateEmail || "Email not on file"}</p></div>
          <div><p className="text-xs text-muted-foreground">Subject</p><p className="text-sm font-medium">{initial.subject}</p></div>
          <div className="grid gap-2"><Label htmlFor="follow-up-body">Body</Label><Textarea id="follow-up-body" rows={9} value={body} onChange={(event) => setBody(event.target.value)} /></div>
          {message ? <p className="text-sm" role="status">{message}</p> : null}
          {pendingLog ? <Button type="button" variant="outline" onClick={retryLog} disabled={Boolean(working)}>{working === "history" ? "Saving history…" : "Retry save to outreach history"}</Button> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={copy} disabled={Boolean(working) || !body.trim()}><Clipboard />{working === "copy" ? "Copying..." : "Copy"}</Button>
          <Button type="button" variant="outline" onClick={openMail} disabled={Boolean(working) || !body.trim() || !outreach.candidateEmail}><ExternalLink />Open in Mail</Button>
          {canDraft ? <Button type="button" onClick={gmailDraft} disabled={Boolean(working) || !body.trim() || !outreach.candidateEmail}><FilePlus2 />{working === "gmail" ? "Saving..." : "Save Gmail draft"}</Button> : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function MailPage() {
  const [requestId, setRequestId] = useState(0);
  const [state, setState] = useState({ phase: "loading", outreach: [], replies: { available: false, latestByEmail: {} }, status: { connected: false, canRead: false, canDraft: false }, profile: {}, error: "" });
  const [selected, setSelected] = useState(null);
  const retry = useCallback(() => setRequestId((value) => value + 1), []);

  useEffect(() => {
    let active = true;
    setState((current) => ({ ...current, phase: "loading", error: "" }));
    Promise.all([listOutreach(), getMailStatus(), getProfile()])
      .then(async ([outreach, status, profile]) => {
        const emails = [...new Set(outreach.map((entry) => entry.candidateEmail).filter(Boolean))];
        const replies = await listMailReplies(emails);
        if (active) setState({ phase: "ready", outreach, replies, status, profile, error: "" });
      })
      .catch(() => { if (active) setState((current) => ({ ...current, phase: "error", error: "Mail activity could not be loaded." })); });
    return () => { active = false; };
  }, [requestId]);

  const due = state.phase === "ready" ? followUpsDue(state.outreach, state.replies) : [];
  const dueIds = new Set(due.map((entry) => entry.id));
  const addLogged = (logged) => setState((current) => ({ ...current, outreach: [logged, ...current.outreach] }));

  if (state.phase === "loading") return <section className="rounded-xl border p-6" role="status">Loading mail activity...</section>;
  if (state.phase === "error") return <section className="rounded-xl border p-6" role="alert"><p>{state.error}</p><Button className="mt-4" variant="outline" onClick={retry}><RefreshCw /> Retry</Button></section>;

  return (
    <div className="flex flex-col gap-5" data-testid="mail-page">
      <Card><CardHeader><div className="flex flex-wrap items-center justify-between gap-2"><CardTitle className="flex items-center gap-2 text-base"><Mail size={17} aria-hidden="true" />Mail status</CardTitle>{state.status.error ? <Button size="sm" variant="outline" onClick={retry}><RefreshCw />Retry</Button> : null}</div><CardDescription>{statusCopy(state.status)}</CardDescription></CardHeader></Card>
      <section aria-labelledby="follow-ups-title">
        <div className="mb-3"><h2 id="follow-ups-title" className="text-lg font-semibold">Follow-ups due</h2><p className="text-sm text-muted-foreground">{state.replies.available ? "Outreach older than three business days without a detected reply." : "Gmail reply status is unavailable."}</p></div>
        {due.length ? <div className="grid gap-3 md:grid-cols-2">{due.map((entry) => <Card key={entry.id}><CardHeader><CardTitle className="text-base">{entry.subject || "Outreach"}</CardTitle><CardDescription>{entry.candidateEmail || "Email not on file"}</CardDescription></CardHeader><CardContent><Button size="sm" onClick={() => setSelected(entry)}>Draft follow-up</Button></CardContent></Card>)}</div> : <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">{state.replies.available ? "No follow-ups are due." : "Reply checking is not available."}</div>}
      </section>
      <section aria-labelledby="outreach-log-title">
        <div className="mb-3"><h2 id="outreach-log-title" className="text-lg font-semibold">Outreach log</h2><p className="text-sm text-muted-foreground">Copied, mailto and Gmail draft activity.</p></div>
        {state.outreach.length === 0 ? <div className="rounded-xl border border-dashed p-8 text-center"><p className="font-medium">No outreach logged</p><p className="mt-1 text-sm text-muted-foreground">Outreach appears here after you copy or save a draft.</p></div> : (
          <div className="max-w-full overflow-x-auto rounded-xl border"><Table><TableHeader><TableRow><TableHead>Recipient</TableHead><TableHead>Subject</TableHead><TableHead>Channel</TableHead><TableHead>Date</TableHead><TableHead>Reply</TableHead><TableHead><span className="sr-only">Action</span></TableHead></TableRow></TableHeader><TableBody>{state.outreach.map((entry) => { const repliedAt = repliedAtFor(entry, state.replies); return <TableRow key={entry.id}><TableCell>{entry.candidateEmail || "Not on file"}</TableCell><TableCell>{entry.subject || "Not on file"}</TableCell><TableCell>{channelLabel(entry.channel)}</TableCell><TableCell>{formatDate(entry.createdAt)}</TableCell><TableCell>{repliedAt ? <span className="inline-flex items-center gap-1"><Check size={14} aria-hidden="true" />Replied</span> : state.replies.available ? "No reply detected" : "Unavailable"}</TableCell><TableCell><Button variant={dueIds.has(entry.id) ? "default" : "outline"} size="sm" onClick={() => setSelected(entry)}>Draft follow-up</Button></TableCell></TableRow>; })}</TableBody></Table></div>
        )}
      </section>
      {selected ? <FollowUpDialog outreach={selected} profile={state.profile} canDraft={state.status.canDraft} onClose={() => setSelected(null)} onLogged={addLogged} /> : null}
    </div>
  );
}

export { MailPage };
