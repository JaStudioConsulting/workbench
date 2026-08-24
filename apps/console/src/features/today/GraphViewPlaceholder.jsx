import { GitBranch } from 'lucide-react';

export function GraphViewPlaceholder() {
  return (
    <section className="today-card graph-placeholder">
      <div className="graph-inner">
        <div className="graph-pulse" aria-hidden="true" />
        <GitBranch size={36} />
        <h2>Graph View</h2>
        <p>Relationship graph coming soon. Cases, candidates, jobs, and connections will be visualized here.</p>
        <span className="graph-tag">Future Release</span>
      </div>
    </section>
  );
}
