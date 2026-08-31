import { useState } from "react";
import CandidateWorkspace from "./CandidateWorkspace.jsx";

const NODE_POSITIONS = [
  [18, 38],
  [34, 66],
  [47, 25],
  [61, 57],
  [77, 34],
  [84, 72],
];

const CONNECTIONS = [
  [18, 38, 47, 25],
  [18, 38, 34, 66],
  [34, 66, 61, 57],
  [47, 25, 61, 57],
  [47, 25, 77, 34],
  [61, 57, 84, 72],
  [77, 34, 84, 72],
];

export default function HomeWidgets() {
  const [selectedNode, setSelectedNode] = useState(null);

  return (
    <div className="home-layout">
      <section className={`graph-section ${selectedNode !== null ? "with-profile" : ""}`} aria-label="Profile connections">
        <div className="graph-canvas">
          <svg className="graph-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {CONNECTIONS.map(([x1, y1, x2, y2], index) => (
              <line key={index} x1={x1} y1={y1} x2={x2} y2={y2} />
            ))}
          </svg>
          {NODE_POSITIONS.map(([x, y], index) => (
            <button
              key={index}
              className={`graph-node ${selectedNode === index ? "selected" : ""}`}
              style={{ left: `${x}%`, top: `${y}%` }}
              onClick={() => setSelectedNode(index)}
              aria-label="Open profile"
              aria-pressed={selectedNode === index}
            />
          ))}
        </div>
        {selectedNode !== null && <CandidateWorkspace onClose={() => setSelectedNode(null)} />}
      </section>

      <section className="workspace-section" aria-labelledby="workspace-title">
        <div className="section-heading">
          <h2 id="workspace-title">Workspace</h2>
        </div>
        <div className="empty-state">
          <h3>No workbench data</h3>
          <p>Nothing has been connected or added here yet.</p>
        </div>
      </section>
    </div>
  );
}
