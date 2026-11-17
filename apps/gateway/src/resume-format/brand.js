// The firm's resume look. Every value is taken from the previous Workbench template
// (apps/console/resume-brander.html at origin/main, the "Exact TTTG build_resume.py
// margins" page rules and the locked styles) unless marked "default".
//
// Fixed elements the generated files add around the candidate's own words:
//   1. The firm logo image (apps/console/public/assets/tttg_logo.png), centred at the top of
//      page 1. Image alt text: "Top Tier Talent Group" (from the previous template's
//      alt attribute; it is not printed).
// Nothing else is added: no page numbers (the previous template had none), no firm-name
// line, no header or footer, no labels, captions, confidentiality lines, dates or
// contact details.
//
// Capitals: the previous template showed exactly one element in capitals, the section
// heading (h2.sec-heading: text-transform uppercase, letter-spacing 0.4px; build_resume.py
// h2 and its reportlab .upper()). The name (h1.cand-name) and the headline were not
// capitalised. So `caps: true` is set only on the two section-heading styles. Capitals
// are formatting: Word stores the text as typed and uses the all-caps property; the PDF
// draws the heading in upper case.

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
    heading1: Object.freeze({ sizePt: 12.5, leadingPt: 16, beforePt: 12, afterPt: 4.5, bold: true, rule: true, caps: true, letterSpacingPt: 0.3 }),
    heading2: Object.freeze({ sizePt: 11, leadingPt: 14, beforePt: 10.5, afterPt: 4.5, bold: true, rule: true, caps: true, letterSpacingPt: 0.3 }), // 0.4px = 0.3pt
    heading3: Object.freeze({ sizePt: 10.5, leadingPt: 14, beforePt: 6, afterPt: 3, bold: true }),
    listItem: Object.freeze({ sizePt: 10.5, leadingPt: 14, beforePt: 0, afterPt: 1.5 }),
    ruleLine: Object.freeze({ beforePt: 4, afterPt: 4, heightPt: 4, thicknessPt: 0.6 }),
  }),
  headingRule: Object.freeze({ thicknessPt: 0.9, paddingPt: 2.25 }), // 1.2px rule, 3px padding
  list: Object.freeze({ textIndentPt: 20, levelStepPt: 18, hangingPt: 14, numberHangingPt: 16, bulletChar: "•" }),
});

export function headingStyle(level) {
  return BRAND.styles[`heading${Math.min(Math.max(level, 1), 3)}`];
}

// Upper-case for display (formatting only). A character with no single-character upper
// form (for example the German sharp s) is kept as typed.
export function upperForDisplay(text) {
  let result = "";
  for (const ch of text) {
    const upper = ch.toUpperCase();
    result += [...upper].length === 1 ? upper : ch;
  }
  return result;
}

export const FIXED_ELEMENTS = Object.freeze([
  Object.freeze({ element: "Logo image", text: null, source: "previous template (centred, 235px wide)" }),
]);
