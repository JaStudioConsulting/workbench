import { GitBranch, TrendingUp } from 'lucide-react';

export function GraphViewPlaceholder() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* 4 Metric Cards matching Image 2 Top Row */}
      <div className="metrics-row">
        <div className="metric-card dark">
          <span className="metric-label">Active Placements</span>
          <span className="metric-value">21,480</span>
          <span className="metric-sub"><TrendingUp size={14} /> + 8.6% vs last month</span>
        </div>
        <div className="metric-card">
          <span className="metric-label">Active Candidates</span>
          <span className="metric-value">14,320</span>
          <span className="metric-sub"><TrendingUp size={14} /> + 11.4% vs last month</span>
        </div>
        <div className="metric-card">
          <span className="metric-label">New Intakes</span>
          <span className="metric-value">1,289</span>
          <span className="metric-sub"><TrendingUp size={14} /> + 3.7% vs last month</span>
        </div>
        <div className="metric-card">
          <span className="metric-label">Active Mentors</span>
          <span className="metric-value">1,876</span>
          <span className="metric-sub"><TrendingUp size={14} /> + 1.2% vs last month</span>
        </div>
      </div>

      {/* Main Bar Chart & Topology Card matching Image 2 "Évolution" Chart */}
      <section className="graph-placeholder">
        <div className="card-header" style={{ marginBottom: '8px' }}>
          <h2 className="card-title">
            <GitBranch size={18} /> Candidate Pipeline Evolution & Graph Topology
          </h2>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600 }}>Monthly overview</span>
        </div>

        <div className="bar-chart-mock">
          <div className="bar-col">
            <div className="bar-fill" style={{ height: '70%' }} />
            <span className="bar-label">Mar</span>
          </div>
          <div className="bar-col">
            <div className="bar-fill" style={{ height: '50%' }} />
            <span className="bar-label">Apr</span>
          </div>
          <div className="bar-col">
            <div className="bar-fill light" style={{ height: '100%' }} />
            <span className="bar-label">May</span>
          </div>
          <div className="bar-col">
            <div className="bar-fill" style={{ height: '60%' }} />
            <span className="bar-label">Jun</span>
          </div>
          <div className="bar-col">
            <div className="bar-fill" style={{ height: '85%' }} />
            <span className="bar-label">Jul</span>
          </div>
          <div className="bar-col">
            <div className="bar-fill sage" style={{ height: '40%' }} />
            <span className="bar-label">Aug</span>
          </div>
        </div>
      </section>
    </div>
  );
}
