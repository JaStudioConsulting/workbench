const PROVINCES = [
  { name: "Alberta", abbreviations: ["AB"], cities: ["Calgary", "Edmonton", "Red Deer", "Lethbridge"] },
  { name: "British Columbia", abbreviations: ["BC", "B.C."], cities: ["Vancouver", "Victoria", "Surrey", "Burnaby", "Richmond", "Kelowna", "Abbotsford"] },
  { name: "Manitoba", abbreviations: ["MB"], cities: ["Winnipeg", "Brandon"] },
  { name: "New Brunswick", abbreviations: ["NB", "N.B."], cities: ["Moncton", "Saint John", "Fredericton"] },
  { name: "Newfoundland and Labrador", abbreviations: ["NL", "N.L."], cities: ["St. John's", "Saint John's", "Corner Brook"] },
  { name: "Nova Scotia", abbreviations: ["NS", "N.S."], cities: ["Halifax", "Sydney"] },
  { name: "Ontario", abbreviations: ["ON", "Ont."], cities: ["Toronto", "Ottawa", "Mississauga", "Brampton", "Hamilton", "London", "Markham", "Vaughan", "Kitchener", "Waterloo", "Windsor", "Oshawa", "Barrie", "Guelph", "Cambridge"] },
  { name: "Prince Edward Island", abbreviations: ["PE", "PEI", "P.E.I."], cities: ["Charlottetown", "Summerside"] },
  { name: "Quebec", abbreviations: ["QC", "PQ", "Que."], cities: ["Montreal", "Montréal", "Quebec City", "Québec City", "Laval", "Gatineau", "Longueuil", "Sherbrooke"] },
  { name: "Saskatchewan", abbreviations: ["SK", "Sask."], cities: ["Saskatoon", "Regina", "Prince Albert"] },
  { name: "Northwest Territories", abbreviations: ["NT", "NWT", "N.W.T."], cities: ["Yellowknife"] },
  { name: "Nunavut", abbreviations: ["NU"], cities: ["Iqaluit"] },
  { name: "Yukon", abbreviations: ["YT"], cities: ["Whitehorse"] },
];
const EXPLICIT_FOREIGN_LOCATIONS = ["United Kingdom", "UK", "United States", "USA", "Australia", "New Zealand"];

function normalizedTokens(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function containsTokenPhrase(haystack, needle) {
  const cleanNeedle = normalizedTokens(needle);
  return Boolean(cleanNeedle) && (` ${haystack} `).includes(` ${cleanNeedle} `);
}

function matchedProvince(location) {
  const normalized = normalizedTokens(location);
  if (!normalized) return null;
  for (const entry of PROVINCES) {
    if ([entry.name, ...entry.abbreviations].some((term) => containsTokenPhrase(normalized, term))) return entry;
  }
  if (EXPLICIT_FOREIGN_LOCATIONS.some((term) => containsTokenPhrase(normalized, term))) return null;
  return PROVINCES.find(({ cities }) => cities.some((term) => containsTokenPhrase(normalized, term))) || null;
}

export function province(location) {
  return matchedProvince(location)?.name || "";
}

export function canadianCity(location) {
  const normalized = normalizedTokens(location);
  if (!normalized) return "";
  const entry = matchedProvince(location);
  if (!entry) return "";
  return entry.cities.find((city) => containsTokenPhrase(normalized, city)) || "";
}

export function isInCanada(location) {
  const normalized = normalizedTokens(location);
  if (!normalized) return false;
  return containsTokenPhrase(normalized, "Canada") || Boolean(matchedProvince(location));
}

