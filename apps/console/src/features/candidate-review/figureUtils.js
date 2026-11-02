// Figure extraction and regex for bolding metrics in verbatim text
export const FIGURE_REGEX = /(\b\$?\d[\d,]*(?:\.\d+)?%?(?:\+)?(?:\s*(?:yr|yrs|year|years|mo|mos|month|months|min|sec|seconds|hour|hours|hr|operators|technicians|cells|loads|arms|lines|facilities|ton|percent))?\b)/gi;

export function extractFigures(text) {
  if (!text) return [];
  const matches = [];
  let m;
  const regex = new RegExp(FIGURE_REGEX.source, "gi");
  while ((m = regex.exec(text)) !== null) {
    matches.push(m[0]);
  }
  return matches;
}

export const MAX_VISIBLE_DOTS = 5;

export function getWindowedIndices(total, current, maxVisible = MAX_VISIBLE_DOTS) {
  if (total <= maxVisible) {
    return Array.from({ length: total }, (_, i) => i);
  }
  const half = Math.floor(maxVisible / 2);
  let start = current - half;
  let end = current + half + 1;
  if (start < 0) {
    start = 0;
    end = maxVisible;
  } else if (end > total) {
    end = total;
    start = total - maxVisible;
  }
  return Array.from({ length: end - start }, (_, i) => start + i);
}
