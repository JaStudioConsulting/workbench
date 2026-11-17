// The firm's resume look. Every value is taken from the previous Workbench template
// (apps/console/resume-brander.html at origin/main, the "Exact TTTG build_resume.py
// margins" page rules and the locked styles) unless marked "default".
//
// Fixed elements the generated files add around the candidate's own words:
//   1. The firm logo image (apps/console/public/assets/tttg_logo.png), centred at the top of
//      page 1. Image alt text: "Top Tier Talent Group" (from the previous template's
//      alt attribute; it is not printed).
//   2. A page number (digits only, centred in the bottom margin). DEFAULT: the previous
//      template had no page numbers.
// Nothing else is added: no firm-name line, no header or footer rule, no labels,
// captions, confidentiality lines, dates or contact details.

import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const assets = path.resolve(here, "../../assets");
// The firm logo is the console's approved asset; it is not copied a second time.
const logoFile = path.resolve(here, "../../../console/public/assets/tttg_logo.png");

export const BRAND = Object.freeze({
  firmName: "Top Tier Talent Group", // used for the file name and logo alt text only
  wordFontFamily: "Arial", // previous template font; Word and Google Docs both have it
  pdfFonts: Object.freeze({
    // Arimo is metric-compatible with Arial (same widths, same line breaks), SIL OFL.
    regular: path.join(assets, "fonts/Arimo_400Regular.ttf"),
    bold: path.join(assets, "fonts/Arimo_700Bold.ttf"),
    italic: path.join(assets, "fonts/Arimo_400Regular_Italic.ttf"),
    boldItalic: path.join(assets, "fonts/Arimo_700Bold_Italic.ttf"),
  }),
  logoFile,
  logoWidthPt: 176.25, // 235px in the previous template
  logoSpaceAfterPt: 7.5, // 10px
  logoAltText: "Top Tier Talent Group",
  page: Object.freeze({ widthPt: 612, heightPt: 792 }), // US Letter, as @page size: Letter
  // 1.6cm top/bottom, 1.7cm left/right, as @page margin in the previous template.
  marginsPt: Object.freeze({ top: 45.354, bottom: 45.354, left: 48.189, right: 48.189 }),
  color: "000000", // black text only
  // Sizes in points. Leading is the line height. before/after is paragraph spacing.
  styles: Object.freeze({
    body: Object.freeze({ sizePt: 10.5, leadingPt: 14, beforePt: 0, afterPt: 6 }),
    title: Object.freeze({ sizePt: 17, leadingPt: 22, beforePt: 0, afterPt: 8, bold: true }),
    heading1: Object.freeze({ sizePt: 12.5, leadingPt: 16, beforePt: 12, afterPt: 4.5, bold: true, rule: true }),
    heading2: Object.freeze({ sizePt: 11, leadingPt: 14, beforePt: 10.5, afterPt: 4.5, bold: true, rule: true }),
    heading3: Object.freeze({ sizePt: 10.5, leadingPt: 14, beforePt: 6, afterPt: 3, bold: true }),
    listItem: Object.freeze({ sizePt: 10.5, leadingPt: 14, beforePt: 0, afterPt: 1.5 }),
    pageNumber: Object.freeze({ sizePt: 9, fromBottomPt: 22 }), // DEFAULT
    ruleLine: Object.freeze({ beforePt: 4, afterPt: 4, heightPt: 4, thicknessPt: 0.6 }),
  }),
  headingRule: Object.freeze({ thicknessPt: 0.9, paddingPt: 2.25 }), // 1.2px rule, 3px padding
  list: Object.freeze({ textIndentPt: 20, levelStepPt: 18, hangingPt: 14, bulletChar: "•" }),
});

export function headingStyle(level) {
  return BRAND.styles[`heading${Math.min(Math.max(level, 1), 3)}`];
}

export const FIXED_ELEMENTS = Object.freeze([
  Object.freeze({ element: "Logo image", text: null, source: "previous template (centred, 235px wide)" }),
  Object.freeze({ element: "Page number", text: "digits only, e.g. 1", source: "default, previous template had none" }),
]);
