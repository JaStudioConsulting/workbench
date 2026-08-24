import { useEffect, useState } from "react";
import { AlertTriangle, BriefcaseBusiness, CheckCircle2, FileText, LockKeyhole, Mail, RefreshCw, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import { authClient } from "./auth-client.js";

const gateway = import.meta.env.VITE_GATEWAY_URL || "";

const sections = [
  ["Case intake", "Source material and missing facts", FileText],
  ["Review queue", "Nothing awaiting approval", CheckCircle2],
  ["Drafts", "No stored drafts", Mail],
];

function StatusCard({ safety, reload }) {
  if (safety.state === "loading") return <section className="state-card"><RefreshCw className="spin" /> Checking safe service configuration...</section>;
  if (safety.state === "error") return <section className="state-card error"><AlertTriangle /> Gateway unavailable. This console will not fall back to local storage.<button onClick={reload}>Retry</button></section>;
  return <section className="state-card"><ShieldCheck /><div><strong>Review mode</strong><span>Auth: {safety.auth}. Gmail: draft only. External writes: disabled.</span></div></section>;
}

function App() {
  const [safety, setSafety] = useState({ state: "loading" });
  const [view, setView] = useState("case");
  const { data: session, isPending: sessionLoading } = authClient.useSession();
  const loadSafety = async () => {
    setSafety({ state: "loading" });
    try {
      const response = await fetch(`${gateway}/api/safety`);
      if (!response.ok) throw new Error("service unavailable");
      setSafety({ state: "ready", ...(await response.json()) });
    } catch { setSafety({ state: "error" }); }
  };
  useEffect(() => { loadSafety(); }, []);
  return <div className="app-shell">
    <aside className="rail" aria-label="Workbench navigation">
      <div className="mark"><Sparkles /></div>
      <button className={view === "case" ? "rail-button active" : "rail-button"} onClick={() => setView("case")} aria-label="Case intake"><BriefcaseBusiness /></button>
      <button className={view === "queue" ? "rail-button active" : "rail-button"} onClick={() => setView("queue")} aria-label="Review queue"><CheckCircle2 /></button>
      <button className={view === "settings" ? "rail-button active lower" : "rail-button lower"} onClick={() => setView("settings")} aria-label="Safety settings"><LockKeyhole /></button>
    </aside>
    <main>
      <header><div><span className="eyebrow">JA STUDIO CONSULTING</span><h1>Recruiting Workbench</h1></div><SessionControl safety={safety} session={session} loading={sessionLoading} /></header>
      <StatusCard safety={safety} reload={loadSafety} />
      {view === "case" && <CaseIntake />}
      {view === "queue" && <EmptyState title="Review queue is clear" note="Approval-ready resumes, submissions, and email drafts will appear here once a durable service is configured." icon={CheckCircle2} />}
      {view === "settings" && <Settings safety={safety} />}
    </main>
  </div>;
}

function SessionControl({ safety, session, loading }) {
  if (safety.state === "loading" || loading) return <div className="session"><RefreshCw className="spin" /> Checking session</div>;
  if (safety.state !== "ready" || safety.auth !== "configured") return <div className="session"><UserRound /> Authentication is unavailable</div>;
  if (session?.user) return <div className="session"><UserRound /> Signed in<button onClick={() => authClient.signOut()}>Sign out</button></div>;
  return <div className="session"><UserRound /> Signed out<button onClick={() => authClient.signIn.social({ provider: "google", callbackURL: window.location.origin })}>Sign in with Google</button></div>;
}

function CaseIntake() {
  return <>
    <section className="hero"><div><span className="eyebrow">AFTER-CALL WORKFLOW</span><h2>Bring the facts together before drafting.</h2><p>Resume, transcript, job description, and call notes stay in one reviewable case. The Workbench prepares drafts; a recruiter approves every external action.</p></div><button className="primary" disabled title="Durable case storage is not configured">Create case</button></section>
    <section className="case-grid">
      {sections.map(([title, note, Icon]) => <article className="glass-card" key={title}><Icon /><h3>{title}</h3><p>{note}</p><span className="muted">Unavailable until a hosted service is configured.</span></article>)}
    </section>
    <section className="workflow"><div className="workflow-head"><div><span className="eyebrow">CONTROLLED OUTPUTS</span><h2>One intake, four human-reviewed drafts.</h2></div><span className="locked"><LockKeyhole /> No sends or submissions</span></div><div className="steps"><span>01 - Source audit</span><span>02 - Branded resume</span><span>03 - Submission and email</span><span>04 - Loxo update draft</span></div></section>
  </>;
}

function EmptyState({ title, note, icon: Icon }) { return <section className="empty-state"><Icon /><h2>{title}</h2><p>{note}</p></section>; }

function Settings({ safety }) { return <section className="settings"><span className="eyebrow">SAFETY STATE</span><h2>Production configuration is intentionally incomplete.</h2><p>This app does not save cases locally. Configure hosted PostgreSQL and Better Auth to enable login; configure durable case storage separately. Google integration remains draft-only.</p><dl><dt>Authentication</dt><dd>{safety.auth || "unavailable"}</dd><dt>Storage</dt><dd>{safety.storage || "unavailable"}</dd><dt>Neo4j</dt><dd>{safety.neo4j || "disabled"} / read-only</dd></dl></section>; }

export default App;
