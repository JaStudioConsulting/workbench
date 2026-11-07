// Experience timeline helpers (A4). Pure, no fit scoring in here.

const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
  january: 0, february: 1, march: 2, april: 3, june: 5, july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};
const SHORT_STINT_MONTHS = 12;
const DASH_CLASS = String.fromCharCode(0x2013, 0x2014);
const RANGE_SPLIT = new RegExp("\\s+(?:to|until)\\s+|\\s*[" + DASH_CLASS + "]\\s*|\\s+-\\s+|(?<=\\d)-(?=\\D|\\d{4})", "i");

function parsePoint(text, isEnd, now) {
  const value = String(text || "").trim().toLowerCase().replace(/\./g, "");
  if (!value) return null;
  if (/^(present|current|now|today|ongoing)$/.test(value)) {
    return { index: now.getFullYear() * 12 + now.getMonth(), ongoing: true, approx: false };
  }
  const year = value.match(/\b(19|20)\d{2}\b/);
  if (!year) return null;
  const monthWord = value.match(/[a-z]+/);
  const month = monthWord ? MONTHS[monthWord[0]] : undefined;
  const numericMonth = value.match(/^(\d{1,2})[\/-](?:19|20)\d{2}$/);
  const y = Number(year[0]);
  if (month !== undefined) return { index: y * 12 + month, ongoing: false, approx: false };
  if (numericMonth && Number(numericMonth[1]) >= 1 && Number(numericMonth[1]) <= 12) {
    return { index: y * 12 + Number(numericMonth[1]) - 1, ongoing: false, approx: false };
  }
  // Year only: approximate.
  return { index: y * 12 + (isEnd ? 11 : 0), ongoing: false, approx: true };
}

export function parseDateRange(dates, now = new Date()) {
  const raw = String(dates || "").trim();
  if (!raw) return null;
  const parts = raw.split(RANGE_SPLIT).filter(Boolean);
  if (parts.length === 1 && /^\s*(19|20)\d{2}\s*$/.test(parts[0])) return null;
  if (parts.length !== 2) return null;
  const start = parsePoint(parts[0], false, now);
  const end = parsePoint(parts[1], true, now);
  if (!start || !end || end.index < start.index) return null;
  return {
    start: start.index,
    end: end.index,
    months: end.index - start.index + 1,
    ongoing: end.ongoing,
    approx: start.approx || end.approx,
  };
}

export function formatDuration(months) {
  const total = Math.max(0, Math.round(months));
  const years = Math.floor(total / 12);
  const rest = total % 12;
  const y = years ? `${years} ${years === 1 ? "yr" : "yrs"}` : "";
  const m = rest ? `${rest} ${rest === 1 ? "mo" : "mos"}` : "";
  return [y, m].filter(Boolean).join(" ") || "0 mos";
}

export function buildTimeline(workHistory, roleMatches = [], now = new Date()) {
  const roles = Array.isArray(workHistory) ? workHistory : [];
  const whyByIndex = new Map();
  for (const match of Array.isArray(roleMatches) ? roleMatches : []) {
    if (Number.isInteger(match?.index) && match.why) whyByIndex.set(match.index, String(match.why));
  }
  const rows = roles.map((role, index) => {
    const range = parseDateRange(role.dates, now);
    return {
      key: role.id || `role-${index}`,
      title: role.title || "Title not recorded",
      company: role.company || "",
      dates: role.dates || "",
      range,
      duration: range ? formatDuration(range.months) : "",
      shortStint: Boolean(range && !range.ongoing && !range.approx && range.months < SHORT_STINT_MONTHS),
      why: whyByIndex.get(index) || "",
    };
  });
  // Total merges overlapping roles so it never double counts.
  const spans = rows.filter((row) => row.range).map((row) => [row.range.start, row.range.end]).sort((a, b) => a[0] - b[0]);
  let totalMonths = 0;
  let cursor = null;
  for (const [start, end] of spans) {
    if (cursor === null || start > cursor) {
      totalMonths += end - start + 1;
      cursor = end;
    } else if (end > cursor) {
      totalMonths += end - cursor;
      cursor = end;
    }
  }
  return {
    rows,
    totalMonths,
    totalLabel: spans.length ? formatDuration(totalMonths) : "",
    parsedCount: spans.length,
  };
}
