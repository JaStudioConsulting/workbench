import pdfMake from "pdfmake/build/pdfmake";
import pdfFonts from "pdfmake/build/vfs_fonts";

pdfMake.vfs = pdfFonts;

function safeFilename(value) {
  const base = String(value || "Candidate Resume")
    .replace(/\.pdf$/i, "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `${base || "Candidate Resume"}.pdf`;
}

function richText(value) {
  const parts = String(value || "").split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map((part) => part.startsWith("**") && part.endsWith("**")
    ? { text: part.slice(2, -2), bold: true }
    : { text: part });
}

function sectionHeading(text) {
  return {
    table: {
      widths: ["*"],
      body: [[{ text: String(text || "").toUpperCase(), style: "sectionHeading" }]],
    },
    layout: {
      hLineWidth: (index) => index === 1 ? 1 : 0,
      vLineWidth: () => 0,
      hLineColor: () => "#111111",
      paddingLeft: () => 0,
      paddingRight: () => 0,
      paddingTop: () => 0,
      paddingBottom: () => 2,
    },
    margin: [0, 8, 0, 5],
  };
}

function skillsBlock(skills) {
  const clean = skills.filter(Boolean);
  if (!clean.length) return null;
  const midpoint = Math.ceil(clean.length / 2);
  const column = (items) => ({
    width: "50%",
    ul: items.map((item) => ({ text: richText(item) })),
    margin: [0, 0, 8, 0],
  });
  return { columns: [column(clean.slice(0, midpoint)), column(clean.slice(midpoint))], columnGap: 16 };
}

function experienceBlock(role) {
  const title = String(role.title || "").trim();
  const dates = String(role.dates || "").trim();
  const company = String(role.company || "").trim();
  const location = String(role.location || "").trim();
  const bullets = Array.isArray(role.bullets) ? role.bullets.filter(Boolean) : [];
  const stack = [];

  if (title || dates) {
    stack.push({
      columns: [
        { text: title, bold: true, width: "*" },
        { text: dates, alignment: "right", width: "auto" },
      ],
    });
  }
  if (company || location) {
    stack.push({
      columns: [
        { text: company, italics: true, width: "*" },
        { text: location, alignment: "right", width: "auto" },
      ],
    });
  }
  if (bullets.length) {
    stack.push({ ul: bullets.map((bullet) => ({ text: richText(bullet), alignment: "justify" })), margin: [0, 3, 0, 0] });
  }
  return { stack, margin: [0, 0, 0, 7] };
}

function buildDocument(data) {
  const content = [
    { text: "TOP TIER TALENT GROUP", style: "wordmark" },
  ];

  if (data.name) content.push({ text: data.name, style: "candidateName" });
  if (data.headline) content.push({ text: data.headline, style: "headline" });
  if (data.summary) {
    content.push(sectionHeading("Summary"));
    content.push({ text: richText(data.summary), alignment: "justify" });
  }

  const skills = Array.isArray(data.skills) ? data.skills : [];
  const skillColumns = skillsBlock(skills);
  if (skillColumns) {
    content.push(sectionHeading("Core Competencies & Skills"));
    content.push(skillColumns);
  }

  const experience = Array.isArray(data.experience) ? data.experience : [];
  if (experience.length) {
    content.push(sectionHeading("Professional Experience"));
    content.push(...experience.map(experienceBlock));
  }

  const education = Array.isArray(data.education) ? data.education.filter(Boolean) : [];
  if (education.length) {
    content.push(sectionHeading(data.education_heading || "Education & Certifications"));
    content.push(...education.map((item) => ({ text: richText(item), margin: [0, 0, 0, 2] })));
  }

  const sections = Array.isArray(data.sections) ? data.sections : [];
  sections.forEach((section) => {
    const items = Array.isArray(section.items) ? section.items.filter(Boolean) : [];
    if (!items.length) return;
    content.push(sectionHeading(section.heading || "Additional Information"));
    content.push(...items.map((item) => ({ text: richText(item), margin: [0, 0, 0, 2] })));
  });

  return {
    pageSize: "LETTER",
    pageMargins: [48, 45, 48, 45],
    info: {
      title: `${data.name || "Candidate"} - Top Tier Talent Group`,
      author: "Top Tier Talent Group",
      subject: "Branded candidate resume",
    },
    content,
    defaultStyle: { font: "Roboto", fontSize: 10.5, lineHeight: 1.18, color: "#111111" },
    styles: {
      wordmark: { fontSize: 17, bold: true, alignment: "center", margin: [0, 0, 0, 8] },
      candidateName: { fontSize: 17, bold: true, alignment: "center", margin: [0, 0, 0, 2] },
      headline: { fontSize: 11.5, bold: true, alignment: "center", margin: [0, 0, 0, 5] },
      sectionHeading: { fontSize: 11, bold: true, characterSpacing: 0.3 },
    },
  };
}

window.downloadBrandedResumePdf = async ({ data, filename }) => {
  const hasContent = data && typeof data === "object" && [
    data.name,
    data.headline,
    data.summary,
    ...(Array.isArray(data.skills) ? data.skills : []),
    ...(Array.isArray(data.experience) ? data.experience : []),
    ...(Array.isArray(data.education) ? data.education : []),
    ...(Array.isArray(data.sections) ? data.sections : []),
  ].some(Boolean);
  if (!hasContent) {
    throw new Error("Not enough data to build a resume");
  }
  pdfMake.createPdf(buildDocument(data)).download(safeFilename(filename));
};
