export default function HomeWidgets() {
  return (
    <section className="workspace-section" aria-labelledby="workspace-title">
      <div className="section-heading">
        <h2 id="workspace-title">Workspace</h2>
      </div>
      <div className="empty-state">
        <h3>No workbench data</h3>
        <p>Nothing has been connected or added here yet.</p>
      </div>
    </section>
  );
}
