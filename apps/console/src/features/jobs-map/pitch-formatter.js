// Role pitch generator and clipboard helper
// Ported directly from Job Map & Proximity Radar

export function generateJobPitch(job) {
  if (!job) return "";
  const otherSites =
    job.isMultiLocation && job.allLocations && job.allLocations.length > 1
      ? ` (Site ${job.locationIndex} of ${job.totalLocations} - Other sites: ${job.allLocations
          .filter((l) => l !== job.displayLocation)
          .join(", ")})`
      : "";

  const role = job.title || job["Job Title"] || "Open Role";
  const company = job.company || job["Company"] || "Confidential Client";
  const loc = (job.displayLocation || job["Location"] || "Ontario") + otherSites;
  const comp = job.compensation || job["Compensation"] || "Competitive";
  const owners = job.owners || job["Owners"] || "Unassigned";
  const desc = (job.description || job["Job Description"] || "").slice(0, 350);

  return `📌 Role: ${role}
🏢 Company: ${company}
📍 Location: ${loc}
💰 Comp: ${comp}
👤 Recruiter: ${owners}

Overview:
${desc}${desc.length >= 350 ? "..." : ""}`;
}

export async function copyJobPitchToClipboard(job) {
  const pitch = generateJobPitch(job);
  if (!pitch) return false;
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(pitch);
      return true;
    }
  } catch (err) {
    console.warn("Clipboard write failed:", err);
  }
  return false;
}
