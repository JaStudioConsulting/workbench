import { GitBranch } from 'lucide-react';

export function GraphViewPlaceholder() {
  return (
    <section className="today-card graph-placeholder">
      <div className="graph-inner">
        <div className="card-title" style={{ color: '#1A1C1E', fontSize: '1.25rem' }}>
          <GitBranch size={22} style={{ color: '#222525' }} />
          Your Recruiting Network Topology
        </div>
        <p style={{ color: '#565C58', fontSize: '0.88rem', marginTop: '4px' }}>
          Graph View — Cases, candidates, and job relationships visualised live.
        </p>
      </div>

      <div className="graph-visual">
        <div className="graph-bubble bubble-yellow" />
        <div className="graph-bubble bubble-pink" />
        <div className="graph-bubble bubble-dark">
          <span>2.3k</span>
          <span style={{ fontSize: '0.65rem', fontWeight: 'normal', opacity: 0.8 }}>nodes</span>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 2 }}>
        <div style={{ display: 'flex', gap: '14px', fontSize: '0.78rem', fontWeight: '700', color: '#565C58' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#FFC82C' }} /> Active Cases
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#FF5A5A' }} /> Candidates
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#222525' }} /> Connected Jobs
          </span>
        </div>
        <span className="graph-tag">Future Release</span>
      </div>
    </section>
  );
}
