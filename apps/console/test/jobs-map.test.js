import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CITY_COORDINATES,
  calculateDistance,
  expandAndEnrichJobs,
  resolveCoordinates,
  splitLocationString,
} from "../src/features/jobs-map/geo-utils.js";
import { createJobMarkerHtml, createSearchCandidateMarkerHtml } from "../src/features/jobs-map/map-markers.js";
import { generateJobPitch } from "../src/features/jobs-map/pitch-formatter.js";
import { INITIAL_JOBS_DATA } from "../src/features/jobs-map/sample-jobs.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const featureRoot = path.resolve(here, "../src/features/jobs-map");

test("Jobs Map location and filter controls have keyboard access and accessible names", () => {
  const source = fs.readFileSync(path.join(featureRoot, "JobsMapView.jsx"), "utf8");
  assert.match(source, /aria-label="Candidate city or address"/);
  assert.match(source, /aria-label="Clear candidate location"/);
  assert.match(source, /<button[\s\S]*?onClick=\{\(\) => handleSelectSuggestion\(item\)\}/);
  assert.match(source, /aria-label="Filter title or skill"/);
  assert.match(source, /aria-label="Filter jobs by recruiter owner"/);
  assert.match(source, /aria-label="Filter jobs by distance"/);
  assert.match(source, /aria-label="Filter jobs by region"/);
  assert.match(source, /aria-pressed=\{mobileTab === "list"\}/);
  assert.match(source, /aria-pressed=\{unit === "km"\}/);
});

test("CITY_COORDINATES resolves Ontario hubs and North American metropolitan areas", () => {
  assert.ok(CITY_COORDINATES["toronto, on"]);
  assert.ok(CITY_COORDINATES["windsor, on"]);
  assert.ok(CITY_COORDINATES["mississauga, on"]);
  assert.ok(CITY_COORDINATES["belleville, on"]);
  assert.ok(CITY_COORDINATES["anaheim, ca"]);

  const toronto = resolveCoordinates("Toronto, ON");
  assert.deepEqual(toronto.latLng, [43.6532, -79.3832]);

  // Substring match on street address
  const streetAddress = resolveCoordinates("4500 Rhodes Dr, Windsor, ON");
  assert.deepEqual(streetAddress.latLng, [42.3149, -83.0364]);

  // Null on unrecognized address
  assert.equal(resolveCoordinates(""), null);
  assert.equal(resolveCoordinates("Unknown Nonexistent City"), null);
});

test("splitLocationString correctly parses multi-site delimiter patterns", () => {
  assert.deepEqual(splitLocationString("Windsor, ON / Detroit, MI"), ["Windsor, ON", "Detroit, MI"]);
  assert.deepEqual(splitLocationString("Toronto, ON | Montreal, QC"), ["Toronto, ON", "Montreal, QC"]);
  assert.deepEqual(splitLocationString("Mississauga, ON; Brampton, ON"), ["Mississauga, ON", "Brampton, ON"]);
  assert.deepEqual(splitLocationString("Single Location, ON"), ["Single Location, ON"]);
  assert.deepEqual(splitLocationString(""), []);
});

test("calculateDistance computes accurate Haversine distance in km and mi", () => {
  // Toronto to Mississauga ~ 24 km
  const distKm = calculateDistance(43.6532, -79.3832, 43.5890, -79.6441, "km");
  assert.ok(distKm >= 20 && distKm <= 26, `Expected ~22-25 km, got ${distKm}`);

  const distMi = calculateDistance(43.6532, -79.3832, 43.5890, -79.6441, "mi");
  assert.ok(distMi >= 12 && distMi <= 17, `Expected ~13-16 mi, got ${distMi}`);

  // Invalid coordinates return null
  assert.equal(calculateDistance(null, null, 43.5, -79.5), null);
});

test("expandAndEnrichJobs expands multi-site roles into independent branches", () => {
  const multiSite = [
    {
      "Job ID": "MULTI-101",
      "Job Title": "Mobile Field Technician",
      Company: "Atlas Transport",
      Location: "Windsor, ON / London, ON",
      Compensation: "$38/hr",
      Owners: "Ja",
      Status: "Active",
      "Job Description": "Field service across sites.",
    },
  ];

  const enriched = expandAndEnrichJobs(multiSite);
  assert.equal(enriched.length, 2);

  assert.equal(enriched[0].id, "MULTI-101_b1");
  assert.equal(enriched[0].isMultiLocation, true);
  assert.equal(enriched[0].locationIndex, 1);
  assert.equal(enriched[0].totalLocations, 2);
  assert.equal(enriched[0].displayLocation, "Windsor, ON");
  assert.deepEqual(enriched[0].coords, [42.3149, -83.0364]);

  assert.equal(enriched[1].id, "MULTI-101_b2");
  assert.equal(enriched[1].isMultiLocation, true);
  assert.equal(enriched[1].locationIndex, 2);
  assert.equal(enriched[1].totalLocations, 2);
  assert.equal(enriched[1].displayLocation, "London, ON");
  assert.deepEqual(enriched[1].coords, [42.9849, -81.2453]);
});

test("generateJobPitch formats structured role overview for candidates", () => {
  const job = {
    title: "CNC Machinist",
    company: "Tycos Tool & Die",
    displayLocation: "Windsor, ON",
    compensation: "$39/hr",
    owners: "Ja, Sarah",
    description: "Mould Maker, Field Service.",
    isMultiLocation: false,
  };

  const pitch = generateJobPitch(job);
  assert.match(pitch, /Role: CNC Machinist/);
  assert.match(pitch, /Company: Tycos Tool & Die/);
  assert.match(pitch, /Location: Windsor, ON/);
  assert.match(pitch, /Comp: \$39\/hr/);
  assert.match(pitch, /Recruiter: Ja, Sarah/);
  assert.match(pitch, /Overview:\nMould Maker, Field Service\./);
});

test("map markers use pure SVG HTML with zero external binary or PNG image assets", () => {
  const job = { isMultiLocation: true, locationIndex: 1, totalLocations: 2 };
  const jobHtml = createJobMarkerHtml(job, false);
  assert.match(jobHtml, /<svg/);
  assert.doesNotMatch(jobHtml, /\.png|\.jpg|\.webp/i);

  const searchHtml = createSearchCandidateMarkerHtml("Toronto");
  assert.match(searchHtml, /<svg/);
  assert.doesNotMatch(searchHtml, /\.png|\.jpg|\.webp/i);
});

test("jobs-map feature codebase adheres to security, privacy, and zero-persistence rules", () => {
  const files = [
    path.join(featureRoot, "geo-utils.js"),
    path.join(featureRoot, "map-markers.js"),
    path.join(featureRoot, "pitch-formatter.js"),
    path.join(featureRoot, "sample-jobs.js"),
    path.join(featureRoot, "JobsMapView.jsx"),
  ];

  const source = files.map((f) => fs.readFileSync(f, "utf8")).join("\n");

  // Zero client-side passcodes or secret keys
  assert.doesNotMatch(source, /TTTG2026/);
  assert.doesNotMatch(source, /ACCESS_PASSCODE/);
  assert.doesNotMatch(source, /client_secret/i);

  // Zero localStorage or sessionStorage (per Workbench zero local persistence standard)
  assert.doesNotMatch(source, /localStorage/);
  assert.doesNotMatch(source, /sessionStorage/);

  // Zero unauthenticated public sheet URLs or jsonp script injection
  assert.doesNotMatch(source, /docs\.google\.com\/spreadsheets\/d\/.*\/gviz/);
  assert.doesNotMatch(source, /jsonp/i);

  // Initial jobs data is non-empty and non-confidential
  assert.ok(INITIAL_JOBS_DATA.length >= 5);
  for (const item of INITIAL_JOBS_DATA) {
    assert.ok(item["Job ID"]);
    assert.ok(item["Job Title"]);
    assert.ok(item["Location"]);
  }
});

test("radius filtering excludes jobs without resolvable coordinates", () => {
  const source = fs.readFileSync(path.join(featureRoot, "JobsMapView.jsx"), "utf8");
  assert.match(source, /if \(job\.distance === null\) return false;/);
  assert.match(source, /no resolvable location/);
  assert.match(source, /excluded from the radius filter/);
});

test("job details expose a direct fit-review entry point", () => {
  const source = fs.readFileSync(path.join(featureRoot, "JobsMapView.jsx"), "utf8");
  assert.match(source, /onOpenJobReview/);
  assert.match(source, /Review fit/);
  assert.match(source, /aria-label="Close job details"/);
});
