function cleanTitle(title) {
  return String(title || "")
    .replace(/\.pdf$/i, "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function printBrandedResume({ title } = {}) {
  const nextTitle = cleanTitle(title);
  if (nextTitle) document.title = nextTitle;

  document.body.classList.add("pdf-exporting");
  window.print();
  window.setTimeout(() => document.body.classList.remove("pdf-exporting"), 1500);
  return { printed: true, title: document.title };
}

if (typeof window !== "undefined") {
  window.printBrandedResume = printBrandedResume;
}
