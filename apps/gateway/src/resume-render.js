function claimText(claim) { return claim.text; }

export function renderResume(resume) {
  const sections = [
    resume.name.value ? `Name\n${resume.name.value}` : "",
    resume.title.value ? `Title\n${resume.title.value}` : "",
    `Professional Summary${resume.summary.length ? `\n${resume.summary.map(claimText).join("\n")}` : ""}`,
    `Core Competencies & Skills${resume.skills.length ? `\n${resume.skills.map((skill) => `• ${claimText(skill)}`).join("\n")}` : ""}`,
    `Professional Experience${resume.experience.length ? `\n${resume.experience.map((role) => {
      const header = [role.title.value, role.dates.value].filter(Boolean).join(" | ");
      const company = [role.company.value, role.location.value].filter(Boolean).join(" | ");
      return [header, company, ...role.bullets.map((bullet) => `• ${claimText(bullet)}`)].filter(Boolean).join("\n");
    }).join("\n\n")}` : ""}`,
    `Education${resume.education.length ? `\n${resume.education.map(claimText).join("\n")}` : ""}`,
    `Certifications${resume.certifications.length ? `\n${resume.certifications.map(claimText).join("\n")}` : ""}`,
    `Additional Information${resume.additionalInformation.length ? `\n${resume.additionalInformation.map(claimText).join("\n")}` : ""}`,
  ];
  return sections.filter(Boolean).join("\n\n");
}
