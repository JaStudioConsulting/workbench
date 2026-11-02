// Inline SVG map marker factories for Leaflet
// Fully compliant with Workbench privacy checks (zero external binary/image assets)

export function createJobMarkerHtml(job, isSelected = false) {
  const isBranch = Boolean(job.isMultiLocation);
  const strokeColor = isSelected ? "#000000" : "#2B2723";
  const fillColor = isSelected ? "#1C1916" : "#2B2723";
  const badgeColor = isBranch ? "#0284C7" : "#059669";
  const ringHtml = isSelected
    ? `<div style="position:absolute;inset:-6px;border-radius:9999px;border:2px solid #1C1916;animation:ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite;opacity:0.35;"></div>`
    : "";

  return `
    <div style="position:relative;display:flex;flex-direction:column;align-items:center;cursor:pointer;user-select:none;transition:transform 0.15s ease;">
      ${ringHtml}
      <div style="width:32px;height:32px;background:${fillColor};border:2px solid #FFFFFF;border-radius:50%;box-shadow:0 4px 10px rgba(0,0,0,0.28);display:flex;align-items:center;justify-content:center;color:#FFFFFF;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <rect width="20" height="14" x="2" y="7" rx="2" ry="2"/>
          <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
        </svg>
      </div>
      ${
        isBranch
          ? `<span style="position:absolute;top:-4px;right:-4px;background:${badgeColor};color:#FFFFFF;font-size:9px;font-weight:700;font-family:monospace;padding:1px 4px;border-radius:9999px;border:1px solid #FFFFFF;line-height:1;">${job.locationIndex}/${job.totalLocations}</span>`
          : ""
      }
      <div style="width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:6px solid ${strokeColor};margin-top:-1px;"></div>
    </div>
  `;
}

export function createSearchCandidateMarkerHtml(label = "") {
  return `
    <div style="position:relative;display:flex;flex-direction:column;align-items:center;cursor:pointer;user-select:none;">
      <div style="position:absolute;inset:-8px;border-radius:9999px;background:rgba(37,99,235,0.25);animation:ping 2s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>
      <div style="width:34px;height:34px;background:#1E40AF;border:2.5px solid #FFFFFF;border-radius:50%;box-shadow:0 4px 12px rgba(30,64,175,0.45);display:flex;align-items:center;justify-content:center;color:#FFFFFF;z-index:10;">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/>
          <circle cx="12" cy="10" r="3"/>
        </svg>
      </div>
      <div style="width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:6px solid #1E40AF;margin-top:-1px;z-index:10;"></div>
    </div>
  `;
}
