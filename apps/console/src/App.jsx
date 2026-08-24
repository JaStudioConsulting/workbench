import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BriefcaseBusiness,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  FlaskConical,
  LockKeyhole,
  Mail,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  UserRound,
} from "lucide-react";
import { authClient } from "./auth-client.js";
import { runSyntheticRecruiter, syntheticCase } from "./synthetic-case.js";

const gateway = import.meta.env.VITE_GATEWAY_URL || "";
const sandboxMode = import.meta.env.VITE_SANDBOX_MODE === "true";

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

function ConnectedApp() {
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

const demoStages = ["Source audit", "Recruiter routing", "Draft preparation", "Review gate"];
const outputTabs = [
  ["audit", "Source audit"],
  ["resume", "Resume"],
  ["submission", "Submission"],
  ["email", "Email"],
  ["loxo", "Loxo notes"],
];

function SandboxApp() {
  const [stage, setStage] = useState(0);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [activeTab, setActiveTab] = useState("audit");
  const sources = useMemo(() => [
    ["Resume", syntheticCase.sources.resume],
    ["Transcript", syntheticCase.sources.transcript],
    ["Job description", syntheticCase.sources.jobDescription],
    ["Call notes", syntheticCase.sources.callNotes],
  ], []);

  const runDemo = async () => {
    setRunning(true);
    setResult(null);
    setActiveTab("audit");
    for (let next = 1; next <= demoStages.length; next += 1) {
      setStage(next);
      await new Promise((resolve) => window.setTimeout(resolve, 260));
    }
    setResult(runSyntheticRecruiter());
    setRunning(false);
  };

  const resetDemo = () => {
    setStage(0);
    setRunning(false);
    setResult(null);
    setActiveTab("audit");
  };

  return <div className="sandbox-shell">
    <header className="sandbox-header">
      <div className="sandbox-brand"><span className="brand-mark"><Sparkles /></span><div><span className="eyebrow">JA STUDIO CONSULTING</span><h1>Recruiting Workbench</h1></div></div>
      <span className="sandbox-badge"><FlaskConical /> Synthetic sandbox</span>
    </header>
    <main className="sandbox-main">
      <section className="sandbox-safety"><ShieldCheck /><div><strong>Safe test mode</strong><span>Fixed fake person. No uploads, storage, login, Gmail, Loxo, Neo4j, sends, or submissions.</span></div></section>
      <section className="sandbox-case-head">
        <div><span className="eyebrow">SAMPLE CASE</span><h2>{syntheticCase.candidate.name}</h2><p>{syntheticCase.candidate.role}</p></div>
        <div className="sandbox-actions">
          <button className="secondary" onClick={resetDemo} disabled={!stage && !result}><RotateCcw /> Reset</button>
          <button className="primary run-button" onClick={runDemo} disabled={running}><Play /> {running ? "Running recruiter..." : result ? "Run again" : "Run synthetic test"}</button>
        </div>
      </section>
      <section className="source-grid" aria-label="Synthetic source material">
        {sources.map(([label, source]) => <article className="source-panel" key={label}><span>{label}</span><p>{source}</p></article>)}
      </section>
      <section className="run-panel" aria-live="polite">
        <div className="stage-list">
          {demoStages.map((label, index) => {
            const complete = stage > index;
            const current = running && stage === index + 1;
            return <div className={`stage-row ${complete ? "complete" : ""} ${current ? "current" : ""}`} key={label}>
              <span className="stage-icon">{complete ? <CheckCircle2 /> : <span>{index + 1}</span>}</span>
              <div><strong>{label}</strong><small>{complete ? "Passed" : "Waiting"}</small></div>
            </div>;
          })}
        </div>
        <div className="result-panel">
          {!result ? <div className="result-empty"><ClipboardCheck /><h3>Ready for safe test</h3><p>Click “Run synthetic test.” Workbench will ground every claim, route through <code>$recruiter</code>, prepare four drafts, and stop at human review.</p></div> : <>
            <div className="result-head"><div><span className="eyebrow">RECRUITER RESULT</span><h3>Four drafts ready for review</h3></div><span className="review-chip"><LockKeyhole /> No external action</span></div>
            <nav className="output-tabs" aria-label="Synthetic outputs">{outputTabs.map(([id, label]) => <button className={activeTab === id ? "active" : ""} onClick={() => setActiveTab(id)} key={id}>{label}</button>)}</nav>
            <OutputView result={result} tab={activeTab} />
          </>}
        </div>
      </section>
    </main>
  </div>;
}

function OutputView({ result, tab }) {
  if (tab === "audit") return <div className="audit-list">{result.audit.supportedClaims.map((fact) => <article key={fact.label}><CheckCircle2 /><div><strong>{fact.label}</strong><span>{fact.value}</span><small>{fact.source.replace("_", " ")} evidence: “{fact.evidence}”</small></div></article>)}</div>;
  if (tab === "resume") return <pre className="draft-copy">{result.brandedResume.content}</pre>;
  if (tab === "submission") return <dl className="submission-fields">{Object.entries(result.submission.fields).map(([label, value]) => <div key={label}><dt>{label.replace(/([A-Z])/g, " $1")}</dt><dd>{Array.isArray(value) ? <ul>{value.map((item) => <li key={item}>{item}</li>)}</ul> : value}</dd></div>)}</dl>;
  if (tab === "email") return <div className="email-draft"><strong>{result.presentationEmail.subject}</strong><pre>{result.presentationEmail.body}</pre></div>;
  return <ul className="loxo-list">{result.loxoDraft.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul>;
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

function App() { return sandboxMode ? <SandboxApp /> : <ConnectedApp />; }

export default App;
