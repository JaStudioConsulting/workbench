import { useState } from "react";
import { Sparkles, Network, ExternalLink, User, Building2, Briefcase, Zap, Info } from "lucide-react";

export default function KnowledgeCanvas({ onOpenCandidate, onOpenCompany, onSelectNode }) {
  const [activeNode, setActiveNode] = useState(null);

  const nodes = [
    { id: "c1", type: "candidate", label: "Marcus Chen", sub: "Marketing Director", x: 26, y: 38, icon: User, color: "var(--forest)", bg: "var(--sage-light)" },
    { id: "co1", type: "company", label: "Meridian Consulting", sub: "3 Open Searches", x: 48, y: 22, icon: Building2, color: "var(--clay)", bg: "var(--clay-light)" },
    { id: "j1", type: "job", label: "VP of Marketing", sub: "Cascade Partners", x: 74, y: 44, icon: Briefcase, color: "var(--gold)", bg: "var(--gold-light)" },
    { id: "c2", type: "candidate", label: "Sarah Kim", sub: "Interview Ready", x: 62, y: 72, icon: User, color: "var(--forest)", bg: "var(--sage-light)" },
    { id: "co2", type: "company", label: "BrightPath Agency", sub: "Hiring Signal", x: 32, y: 78, icon: Building2, color: "var(--clay)", bg: "var(--clay-light)" },
  ];

  const handleNodeClick = (node) => {
    setActiveNode(node.id);
    onSelectNode?.(node);
  };

  return (
    <div className="knowledge-canvas-wrap">
      <div className="canvas-badge-bar">
        <div className="canvas-badge">
          <Network size={13} />
          <span>Obsidian Knowledge Graph</span>
        </div>
        <span className="canvas-sub-label">Interactive nodes • Click any entity to inspect on the right</span>
      </div>

      {/* SVG Network Lines */}
      <svg className="canvas-network-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
        <line x1="26" y1="38" x2="48" y2="22" stroke="var(--border-strong)" strokeWidth="0.4" strokeDasharray="1.5 1" opacity="0.6" />
        <line x1="48" y1="22" x2="74" y2="44" stroke="var(--border-strong)" strokeWidth="0.4" strokeDasharray="1.5 1" opacity="0.6" />
        <line x1="74" y1="44" x2="62" y2="72" stroke="var(--border-strong)" strokeWidth="0.4" strokeDasharray="1.5 1" opacity="0.6" />
        <line x1="62" y1="72" x2="32" y2="78" stroke="var(--border-strong)" strokeWidth="0.4" strokeDasharray="1.5 1" opacity="0.6" />
        <line x1="32" y1="78" x2="26" y2="38" stroke="var(--border-strong)" strokeWidth="0.4" strokeDasharray="1.5 1" opacity="0.6" />
      </svg>

      {/* Interactive Floating Nodes */}
      <div className="canvas-nodes-container">
        {nodes.map((node) => {
          const Icon = node.icon;
          const isSelected = activeNode === node.id;
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

      {/* Quick Links Bar */}
      <div className="canvas-quick-links">
        <span className="quick-links-label">Quick Links:</span>
        <button className="quick-link-chip" onClick={() => onOpenCandidate?.({ id: 1, name: "Marcus Chen", title: "Marketing Director" })}>
          <User size={12} /> Marcus Chen
        </button>
        <button className="quick-link-chip" onClick={() => onOpenCompany?.("Meridian Consulting")}>
          <Building2 size={12} /> Meridian Consulting
        </button>
        <button className="quick-link-chip" onClick={() => onOpenCandidate?.({ id: 2, name: "Sarah Kim", title: "VP of Marketing" })}>
          <User size={12} /> Sarah Kim
        </button>
      </div>
    </div>
  );
}
