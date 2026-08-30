import { useState } from "react";
import {
  AlertCircle, Phone, Clock, CheckSquare, ChevronRight, Zap,
  SlidersHorizontal, User, Building2, Briefcase, Network, X,
  Mail, Calendar, Video, ExternalLink, ChevronLeft, Check, FileText
} from "lucide-react";
import CalendarWidget from "./CalendarWidget.jsx";
import { needsActionItems, todaySchedule, priorityJobs, hiringNowCompanies, sampleCandidate } from "../data/placeholders.js";

/**
 * CITED REFERENCES:
 * 1. Top Section & Inset Right Inspector:
 *    - @shadcn/sidebar-15 (Left main area + right inset inspector pane)
 *    - Obsidian Knowledge Graph visual canvas pattern
 *    - Google Workspace Draft/Meet actions (google/skills & _JA-RULES.md)
 * 2. Bottom Section:
 *    - @shadcn/tabs (Pill tab headers switching master stream views)
 *    - @shadcn/card (Silk-white elevated card containers)
 *    - Google Calendar Agenda Widget with Add Meeting & Copy Availability
 */

export default function HomeWidgets({ onNavigate }) {
  const [activeTab, setActiveTab] = useState("action");
  const [selectedNode, setSelectedNode] = useState({
    id: "c1",
    type: "candidate",
    label: "Marcus Chen",
    sub: "Marketing Director",
    notes: "15 years in brand strategy. Led team of 40 at previous firm. Prefers hybrid. Targeting $185–210k base.",
    related: "Meridian Consulting — Marketing Director Search",
    lastContact: "Aug 25 via Gmail",
    email: "marcus.chen@email.com",
  });
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [draftToast, setDraftToast] = useState(false);

  const nodes = [
    { id: "c1", type: "candidate", label: "Marcus Chen", sub: "Marketing Director", x: 28, y: 35, icon: User, color: "var(--forest)", bg: "var(--sage-light)", notes: "15 years in brand strategy. Led team of 40. Targeting $185–210k base.", related: "Meridian Consulting — Marketing Director", email: "marcus.chen@email.com", lastContact: "Aug 25 via Gmail" },
    { id: "co1", type: "company", label: "Meridian Consulting", sub: "3 Open Searches", x: 50, y: 20, icon: Building2, color: "var(--clay)", bg: "var(--clay-light)", notes: "Executive search retainer. C-suite rebuilding phase.", related: "3 Roles: Marketing Dir, Ops Mgr, Partner", email: "hiring@meridianconsulting.com", lastContact: "Yesterday" },
    { id: "j1", type: "job", label: "VP of Marketing", sub: "Cascade Partners", x: 72, y: 42, icon: Briefcase, color: "var(--gold)", bg: "var(--gold-light)", notes: "High priority executive search. 4 active candidate submissions.", related: "Cascade Partners — Client Lead: Sarah Kim", email: "contact@cascadepartners.com", lastContact: "Aug 22" },
    { id: "c2", type: "candidate", label: "Sarah Kim", sub: "Interview Confirmed", x: 58, y: 74, icon: User, color: "var(--forest)", bg: "var(--sage-light)", notes: "VP candidate. Confirmed client interview for 11:30 AM today.", related: "Cascade Partners — VP of Marketing", email: "sarah.kim@email.com", lastContact: "Today 10:42 AM" },
    { id: "co2", type: "company", label: "BrightPath Agency", sub: "Hiring Signal", x: 30, y: 76, icon: Building2, color: "var(--clay)", bg: "var(--clay-light)", notes: "New funding round. Expanding creative leadership.", related: "Creative Director search active", email: "talent@brightpath.agency", lastContact: "Aug 20" },
  ];

  const tabs = [
    { id: "action", label: "Needs Action", count: needsActionItems.length, icon: AlertCircle },
    { id: "jobs", label: "Priority Jobs", count: priorityJobs.length, icon: Briefcase },
    { id: "hiring", label: "Hiring Signals", count: hiringNowCompanies.length, icon: Zap },
    { id: "candidates", label: "Active Profiles", count: 4, icon: User },
  ];

  const handleNodeClick = (node) => {
    setSelectedNode(node);
    setInspectorOpen(true);
  };

  const handleCreateGmailDraft = () => {
    setDraftToast(true);
    setTimeout(() => setDraftToast(false), 2400);
  };

  return (
    <div className="home-dashboard-layout">
      {/* ══════════════════════════════════════════════════════════════
          TOP SECTION: Graph on Left + Right Inspector Pane (Bounded Inside Top)
          (Ref: @shadcn/sidebar-15 + Obsidian Graph Pattern)
          ══════════════════════════════════════════════════════════════ */}
      <section className={`dashboard-top-section ${inspectorOpen ? "with-inspector" : ""}`} aria-label="Knowledge Graph Canvas">
        {/* Left Area: Obsidian Interactive Graph */}
        <div className="canvas-main-area">
          <div className="canvas-header-bar">
            <div className="canvas-badge">
              <Network size={13} />
              <span>Obsidian Knowledge Canvas</span>
            </div>
            <div className="canvas-header-right">
              <span className="canvas-hint">Click any node to inspect note data</span>
              {!inspectorOpen && (
                <button className="canvas-toggle-inspector-btn" onClick={() => setInspectorOpen(true)} title="Open note inspector">
                  <ChevronLeft size={14} />
                  <span>Inspect Note</span>
                </button>
              )}
            </div>
          </div>

          {/* SVG Relationship Graph Lines */}
          <div className="canvas-interactive-viewport">
            <svg className="canvas-network-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
              <line x1="28" y1="35" x2="50" y2="20" stroke="var(--border-strong)" strokeWidth="0.4" strokeDasharray="1.5 1" opacity="0.6" />
              <line x1="50" y1="20" x2="72" y2="42" stroke="var(--border-strong)" strokeWidth="0.4" strokeDasharray="1.5 1" opacity="0.6" />
              <line x1="72" y1="42" x2="58" y2="74" stroke="var(--border-strong)" strokeWidth="0.4" strokeDasharray="1.5 1" opacity="0.6" />
              <line x1="58" y1="74" x2="30" y2="76" stroke="var(--border-strong)" strokeWidth="0.4" strokeDasharray="1.5 1" opacity="0.6" />
              <line x1="30" y1="76" x2="28" y2="35" stroke="var(--border-strong)" strokeWidth="0.4" strokeDasharray="1.5 1" opacity="0.6" />
            </svg>

            {/* Interactive Floating Node Chips */}
            {nodes.map((node) => {
              const Icon = node.icon;
              const isSelected = selectedNode?.id === node.id;
              return (
                <button
                  key={node.id}
                  className={`canvas-node-pill ${isSelected ? "selected" : ""}`}
                  style={{ left: `${node.x}%`, top: `${node.y}%` }}
                  onClick={() => handleNodeClick(node)}
                  aria-label={`Inspect ${node.label}`}
                >
                  <div className="node-icon-circle" style={{ background: node.bg, color: node.color }}>
                    <Icon size={12} />
                  </div>
                  <div className="node-text">
                    <span className="node-title">{node.label}</span>
                    <span className="node-sub">{node.sub}</span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Quick Links Footer Bar */}
          <div className="canvas-quick-links-bar">
            <span className="quick-links-label">Quick Links:</span>
            {nodes.slice(0, 3).map((node) => {
              const Icon = node.icon;
              return (
                <button key={node.id} className="quick-link-chip" onClick={() => handleNodeClick(node)}>
                  <Icon size={11} />
                  <span>{node.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right Area: Inset Inspector Panel (STRICTLY Bounded in Top Section) */}
        {inspectorOpen && (
          <aside className="top-inspector-pane" aria-label="Node Note Inspector">
            <div className="inspector-header">
              <div className="inspector-title-wrap">
                <div className="inspector-avatar">
                  {selectedNode?.label.split(" ").map((n) => n[0]).join("")}
                </div>
                <div>
                  <h3 className="inspector-name">{selectedNode?.label}</h3>
                  <span className="inspector-sub">{selectedNode?.sub}</span>
                </div>
              </div>
              <button className="inspector-close-btn" onClick={() => setInspectorOpen(false)} title="Close inspector">
                <X size={14} />
              </button>
            </div>

            {/* Google Workspace Action Bar (ref: google/skills & _JA-RULES.md) */}
            <div className="inspector-actions-bar">
              <button className="inspector-action-btn primary" onClick={handleCreateGmailDraft}>
                <Mail size={13} />
                <span>Gmail Draft</span>
              </button>
              <a
                href="https://meet.google.com/new"
                target="_blank"
                rel="noopener noreferrer"
                className="inspector-action-btn"
                title="Start Google Meet"
              >
                <Video size={13} />
                <span>Meet</span>
              </a>
              <a
                href="https://calendar.google.com"
                target="_blank"
                rel="noopener noreferrer"
                className="inspector-action-btn"
                title="Open Google Calendar"
              >
                <Calendar size={13} />
                <span>GCal</span>
              </a>
            </div>

            {draftToast && (
              <div className="inspector-toast">
                <Check size={12} />
                <span>Gmail draft prepared in Ja's account</span>
              </div>
            )}

            {/* Note Details & Context */}
            <div className="inspector-body">
              <div className="inspector-section">
                <span className="inspector-section-tag">Context / Related</span>
                <p className="inspector-detail-text">{selectedNode?.related}</p>
              </div>

              <div className="inspector-section">
                <span className="inspector-section-tag">Note & Profile Data</span>
                <p className="inspector-notes-text">{selectedNode?.notes}</p>
              </div>

              <div className="inspector-section">
                <span className="inspector-section-tag">Recent Activity</span>
                <div className="inspector-activity-row">
                  <Mail size={12} />
                  <span>{selectedNode?.lastContact}</span>
                </div>
              </div>
            </div>
          </aside>
        )}
      </section>

      {/* ══════════════════════════════════════════════════════════════
          DIVIDER
          ══════════════════════════════════════════════════════════════ */}
      <div className="dashboard-section-divider">
        <div className="divider-line" />
        <span className="divider-tag">WORKSPACE STREAM</span>
        <div className="divider-line" />
      </div>

      {/* ══════════════════════════════════════════════════════════════
          BOTTOM SECTION: 4 Pill Headers + Master List & Dedicated Calendar
          (Ref: @shadcn/tabs + @shadcn/card)
          ══════════════════════════════════════════════════════════════ */}
      <section className="dashboard-bottom-section">
        {/* Left: Master List Card with 4 Tabs */}
        <div className="dashboard-list-card">
          {/* 4 Header Tabs Bar */}
          <div className="list-tabs-bar" role="tablist" aria-label="Workspace tabs">
            <div className="tabs-pill-group">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    className={`list-tab-pill ${isActive ? "active" : ""}`}
                    onClick={() => setActiveTab(tab.id)}
                    role="tab"
                    aria-selected={isActive}
                  >
                    <Icon size={13} />
                    <span>{tab.label}</span>
                    <span className="tab-pill-badge">{tab.count}</span>
                  </button>
                );
              })}
            </div>
            <button className="tab-customize-btn" title="Customize active columns and filters">
              <SlidersHorizontal size={13} />
              <span>Customize</span>
            </button>
          </div>

          {/* Master List Dynamic Rows */}
          <div className="list-body-container">
            {activeTab === "action" && (
              <div className="action-stream-list">
                {needsActionItems.map((item) => (
                  <article
                    key={item.id}
                    className="stream-row-item"
                    onClick={() => {
                      setSelectedNode({
                        id: `action-${item.id}`,
                        type: "candidate",
                        label: item.label.replace("Follow up with ", "").replace("Missing resume — ", "").replace("Stalled submission — ", ""),
                        sub: item.detail,
                        notes: item.detail,
                        related: "Recruiting Pipeline Search",
                        lastContact: "5 days ago",
                        email: "candidate@search.com"
                      });
                      setInspectorOpen(true);
                    }}
                  >
                    <div className={`priority-indicator priority-${item.priority}`} />
                    <div className="stream-row-main">
                      <h3 className="stream-row-title">{item.label}</h3>
                      <p className="stream-row-desc">{item.detail}</p>
                    </div>
                    <span className={`stream-priority-tag tag-${item.priority}`}>{item.priority}</span>
                    <ChevronRight size={14} className="stream-row-arrow" />
                  </article>
                ))}
              </div>
            )}

            {activeTab === "jobs" && (
              <div className="action-stream-list">
                {priorityJobs.map((job) => (
                  <article key={job.id} className="stream-row-item" onClick={() => onNavigate("jobs")}>
                    <div className="job-row-icon"><Briefcase size={15} /></div>
                    <div className="stream-row-main">
                      <h3 className="stream-row-title">{job.title}</h3>
                      <p className="stream-row-desc">{job.company} • {job.candidates} candidates in pipeline</p>
                    </div>
                    <span className={`stream-priority-tag tag-${job.urgency}`}>{job.urgency}</span>
                    <span className="stream-stat-badge">{job.daysOpen}d active</span>
                  </article>
                ))}
              </div>
            )}

            {activeTab === "hiring" && (
              <div className="action-stream-list">
                {hiringNowCompanies.map((co) => (
                  <article key={co.id} className="stream-row-item" onClick={() => onNavigate("companies", { filter: "hiring-now" })}>
                    <div className="company-row-icon"><Zap size={15} /></div>
                    <div className="stream-row-main">
                      <h3 className="stream-row-title">{co.name}</h3>
                      <p className="stream-row-desc">{co.sector} — {co.signal}</p>
                    </div>
                    <span className="stream-priority-tag tag-signal">Signal</span>
                    <ChevronRight size={14} className="stream-row-arrow" />
                  </article>
                ))}
              </div>
            )}

            {activeTab === "candidates" && (
              <div className="action-stream-list">
                {nodes.filter((n) => n.type === "candidate").map((cand) => (
                  <article key={cand.id} className="stream-row-item" onClick={() => handleNodeClick(cand)}>
                    <div className="candidate-row-avatar">{cand.label.split(" ").map((n) => n[0]).join("")}</div>
                    <div className="stream-row-main">
                      <h3 className="stream-row-title">{cand.label}</h3>
                      <p className="stream-row-desc">{cand.sub} • {cand.related}</p>
                    </div>
                    <span className="stream-priority-tag tag-active">Active</span>
                    <ChevronRight size={14} className="stream-row-arrow" />
                  </article>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: Dedicated Interactive Calendar Widget with Add Meeting */}
        <div className="dashboard-calendar-card">
          <CalendarWidget />
        </div>
      </section>
    </div>
  );
}
