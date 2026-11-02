// Spatial coordinates, Haversine distance, and multi-location splitting utilities
// Ported natively from Job Map & Proximity Radar for Top Tier Talent Group

export const CITY_COORDINATES = Object.freeze({
  // Ontario
  "windsor, on": [42.3149, -83.0364],
  "windsor, ontario": [42.3149, -83.0364],
  "belleville, on": [44.1628, -77.3832],
  "belleville, ontario": [44.1628, -77.3832],
  "mississauga, on": [43.5890, -79.6441],
  "mississauga, ontario": [43.5890, -79.6441],
  "toronto, on": [43.6532, -79.3832],
  "toronto, ontario": [43.6532, -79.3832],
  "hamilton, on": [43.2557, -79.8711],
  "hamilton, ontario": [43.2557, -79.8711],
  "london, on": [42.9849, -81.2453],
  "london, ontario": [42.9849, -81.2453],
  "kitchener, on": [43.4516, -80.4925],
  "waterloo, on": [43.4643, -80.5204],
  "cambridge, on": [43.3616, -80.3144],
  "guelph, on": [43.5448, -80.2482],
  "markham, on": [43.8561, -79.3370],
  "vaughan, on": [43.8563, -79.5085],
  "brampton, on": [43.7315, -79.7624],
  "oakville, on": [43.4675, -79.6877],
  "burlington, on": [43.3255, -79.7990],
  "barrie, on": [44.3894, -79.6903],
  "oshawa, on": [43.8971, -78.8658],
  "kingston, on": [44.2312, -76.4860],
  "trenton, on": [44.1000, -77.5833],
  "leamington, on": [42.0532, -82.5998],
  "leamington": [42.0532, -82.5998],
  "chatham, on": [42.4048, -82.1910],
  "chatham-kent, on": [42.4048, -82.1910],
  "sarnia, on": [42.9745, -82.4066],
  "stratford, on": [43.3700, -80.9822],
  "woodstock, on": [43.1315, -80.7472],
  "brantford, on": [43.1394, -80.2644],
  "st. thomas, on": [42.7788, -81.1934],
  "peterborough, on": [44.3091, -78.3197],
  "sudbury, on": [46.4917, -80.9930],
  "sault ste. marie, on": [46.5136, -84.3358],
  "ottawa, on": [45.4215, -75.6972],

  // USA & Metros
  "anaheim, ca": [33.8366, -117.9143],
  "anaheim, california": [33.8366, -117.9143],
  "detroit, mi": [42.3314, -83.0458],
  "detroit, michigan": [42.3314, -83.0458],
  "los angeles, ca": [34.0522, -118.2437],
  "irvine, ca": [33.6846, -117.8265],
  "huntington beach, ca": [33.6595, -117.9988],
  "la mirada, ca": [33.9136, -118.0123],
  "san francisco, ca": [37.7749, -122.4194],
  "chicago, il": [41.8781, -87.6298],
  "dallas, tx": [32.7767, -96.7970],
  "houston, tx": [29.7604, -95.3698],
  "austin, tx": [30.2672, -97.7431],
  "new york, ny": [40.7128, -74.0060],
  "atlanta, ga": [33.7490, -84.3880],
  "boston, ma": [42.3601, -71.0589],
  "seattle, wa": [47.6062, -122.3321],
  "troy, mi": [42.5797, -83.1499],
  "warren, mi": [42.4775, -83.0277],
  "grand rapids, mi": [42.9634, -85.6681],
  "montreal, qc": [45.5017, -73.5673],

  // Greater Golden Horseshoe & Regional Hubs
  "greater toronto area, on": [43.6532, -79.3832],
  "greater toronto area": [43.6532, -79.3832],
  "gta, on": [43.6532, -79.3832],
  "etobicoke, on": [43.6205, -79.5132],
  "scarborough, on": [43.7764, -79.2318],
  "scarborough, ontario": [43.7764, -79.2318],
  "stouffville, on": [43.9708, -79.2483],
  "st. catharines, on": [43.1594, -79.2469],
  "ancaster, on": [43.2275, -79.9902],
  "newmarket, on": [44.0592, -79.4613],
  "smiths falls, on": [44.9029, -76.0206],
  "kitchener/cambridge, on": [43.4000, -80.4000],
  "wardsville, on": [42.6568, -81.7547],
  "sauble beach, on": [44.6833, -81.2667],
  "newtonville, on": [43.9500, -78.5000],
  "milton, on": [43.5183, -79.8774],
  "whitby, on": [43.8975, -78.9429],
  "ajax, on": [43.8509, -79.0204],
  "pickering, on": [43.8384, -79.0868],
  "richmond hill, on": [43.8828, -79.4403],
  "calgary, ab": [51.0447, -114.0719],
  "edmonton, ab": [53.5461, -113.4938],
  "vancouver, bc": [49.2827, -123.1207],
});

/**
 * Calculates straight-line distance between two coordinates using Haversine formula
 */
export function calculateDistance(lat1, lon1, lat2, lon2, unit = "km") {
  if (typeof lat1 !== "number" || typeof lon1 !== "number" || typeof lat2 !== "number" || typeof lon2 !== "number") {
    return null;
  }
  const R = unit === "mi" ? 3958.8 : 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
}

/**
 * Splits multi-location strings by standard delimiters (/, ;, |, newlines, &, and)
 */
export function splitLocationString(rawLoc) {
  if (!rawLoc || typeof rawLoc !== "string") return [];
  const text = rawLoc.trim();
  if (!text) return [];

  let parts = [];
  if (/[\/;|\n\r]+/.test(text)) {
    parts = text.split(/[\/;|\n\r]+/).map((s) => s.trim()).filter(Boolean);
  } else if (/\s+and\s+|\s+&\s+/i.test(text) && (text.includes(",") || text.includes("ON") || text.includes("CA") || text.includes("MI"))) {
    parts = text.split(/\s+and\s+|\s+&\s+/i).map((s) => s.trim()).filter(Boolean);
  } else {
    const provinceMatches = text.match(/(?:[A-Za-z0-9\s.-]+,\s*(?:ON|Ontario|BC|AB|QC|MB|SK|NS|NB|NL|PE|CA|California|MI|Michigan|OH|NY|TX|FL|[A-Z]{2}))/gi);
    if (provinceMatches && provinceMatches.length > 1) {
      parts = provinceMatches.map((s) => s.trim()).filter(Boolean);
    } else {
      parts = [text];
    }
  }
  return parts.length > 0 ? parts : [text];
}

/**
 * Resolves coordinates for a location string against the dictionary or cache
 */
export function resolveCoordinates(locationStr, jobDescription = "") {
  let target = locationStr;
  if (!target || target.trim() === "") {
    const match = (jobDescription || "").match(/Location:\s*([^\r\n,]+(?:,\s*[^\r\n]+)?)/i);
    if (match && match[1]) target = match[1].trim();
  }
  if (!target) return null;

  const cleaned = target.toLowerCase().replace(/[^\w\s,]/g, "").trim();

  // 1. Exact match in city coordinates
  if (CITY_COORDINATES[cleaned]) {
    return { latLng: CITY_COORDINATES[cleaned], resolvedName: target };
  }

  // 2. Substring match (e.g. "4500 Rhodes Dr, Windsor, ON")
  for (const [key, coords] of Object.entries(CITY_COORDINATES)) {
    if (cleaned.includes(key) || key.includes(cleaned)) {
      return { latLng: coords, resolvedName: target };
    }
  }

  return null;
}

/**
 * Expands multi-location jobs into distinct branch entries with independent coordinates
 */
export function expandAndEnrichJobs(rawJobs) {
  const enriched = [];
  (rawJobs || []).forEach((job, idx) => {
    let rawLoc = (job["Location"] || job.location || "").trim();
    if (!rawLoc) {
      const match = (job["Job Description"] || job.description || "").match(/Location:\s*([^\r\n,]+(?:,\s*[^\r\n]+)?)/i);
      if (match && match[1]) rawLoc = match[1].trim();
    }
    if (!rawLoc) rawLoc = "Location on request";

    const locations = splitLocationString(rawLoc);
    const desc = job["Job Description"] || job.description || "";
    const jobId = job["Job ID"] || job.jobId || job.id || `job_${idx}`;

    if (locations.length <= 1) {
      const singleLoc = locations[0] || rawLoc;
      const coordData = resolveCoordinates(singleLoc, desc);
      enriched.push({
        ...job,
        id: String(jobId),
        originalJobId: String(jobId),
        title: job["Job Title"] || job.title || "Untitled Role",
        company: job["Company"] || job.company || "Confidential Client",
        compensation: job["Compensation"] || job.compensation || "",
        owners: job["Owners"] || job.owners || "Unassigned",
        status: job["Status"] || job.status || "Active",
        description: desc,
        coords: coordData ? coordData.latLng : null,
        displayLocation: singleLoc,
        rawLocation: rawLoc,
        isMultiLocation: false,
        allLocations: [singleLoc],
      });
    } else {
      locations.forEach((branchLoc, branchIdx) => {
        const coordData = resolveCoordinates(branchLoc, desc);
        enriched.push({
          ...job,
          id: `${jobId}_b${branchIdx + 1}`,
          originalJobId: String(jobId),
          title: job["Job Title"] || job.title || "Untitled Role",
          company: job["Company"] || job.company || "Confidential Client",
          compensation: job["Compensation"] || job.compensation || "",
          owners: job["Owners"] || job.owners || "Unassigned",
          status: job["Status"] || job.status || "Active",
          description: desc,
          coords: coordData ? coordData.latLng : null,
          displayLocation: branchLoc,
          rawLocation: rawLoc,
          isMultiLocation: true,
          locationIndex: branchIdx + 1,
          totalLocations: locations.length,
          allLocations: locations,
        });
      });
    }
  });

  return enriched;
}
