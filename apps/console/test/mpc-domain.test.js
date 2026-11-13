import assert from "node:assert/strict";
import test from "node:test";
import {
  assessMpcEvidence,
  buildMpcBlindExport,
  buildMpcCaseReferences,
  buildMpcReview,
  deduplicateMpcContacts,
  deduplicateMpcTargets,
} from "../src/features/operator-cases/mpcDomain.js";

const now = new Date("2026-11-13T12:00:00.000Z");

test("MPC cases bind to one exact source-linked candidate", () => {
  const refs = buildMpcCaseReferences("sourcing:17");
  assert.equal(refs.caseKey, "mpc:sourcing:17:candidate-marketing");
  assert.equal(refs.source.source_id, "sourcing:17");
  assert.throws(() => buildMpcCaseReferences("Candidate Name"), /source-linked candidate/i);
});

test("contacts deduplicate only stable external ID, verified LinkedIn, or verified email", () => {
  const result = deduplicateMpcContacts([
    { name: "Taylor Reed", companyName: "Northstar", email: "TAYLOR@example.invalid", emailVerified: true },
    { name: "T Reed", companyName: "Northstar", email: "taylor@example.invalid", emailVerified: true },
    { name: "Taylor Reed", companyName: "Northstar", linkedinUrl: "https://www.linkedin.com/in/taylor-reed?trk=abc", linkedinVerified: true },
    { name: "Taylor Reed", companyName: "Northstar", linkedinUrl: "https://linkedin.com/in/taylor-reed/", linkedinVerified: true },
    { name: "Taylor Reed", companyName: "Northstar" },
    { name: "Taylor Reed", companyName: "Northstar" },
  ]);
  assert.equal(result.items.length, 4);
  assert.equal(result.duplicates.length, 2);
  assert.equal(result.possibleMatches.length >= 1, true);
  assert.match(result.duplicates[0].reason, /verified email/i);
  assert.match(result.duplicates[1].reason, /verified LinkedIn/i);
});

test("LinkedIn matching rejects lookalike hostnames", () => {
  const result = deduplicateMpcContacts([
    { name: "Person One", companyName: "Company", linkedinUrl: "https://notlinkedin.com/in/person", linkedinVerified: true },
    { name: "Person Two", companyName: "Company", linkedinUrl: "https://linkedin.com.evil.example/in/person", linkedinVerified: true },
    { name: "Person Three", companyName: "Company", linkedinUrl: "https://careers.linkedin.com/in/person", linkedinVerified: true },
  ]);
  assert.equal(result.duplicates.length, 0);
  assert.equal(result.items.length, 3);
});

test("companies deduplicate by stable external ID or domain while name/location stays a review warning", () => {
  const result = deduplicateMpcTargets([
    { companyName: "Northstar Manufacturing", website: "https://www.northstar.example/jobs?x=1", location: "Toronto" },
    { companyName: "Northstar Manufacturing", website: "https://northstar.example/about", location: "Toronto" },
    { companyName: "Northstar Mfg", location: "Toronto" },
    { companyName: "Northstar Mfg", location: "Toronto" },
  ]);
  assert.equal(result.items.length, 3);
  assert.equal(result.duplicates.length, 1);
  assert.equal(result.duplicates[0].reason, "same company website domain");
  assert.equal(result.possibleMatches.length, 1);
});

test("source gaps are explicit and hiring signals expire after 30 days", () => {
  assert.equal(assessMpcEvidence({ sourceUrl: "", observedAt: "" }, { now }).evidenceStatus, "missing");
  assert.equal(assessMpcEvidence({ sourceUrl: "https://example.com/news", observedAt: "2026-10-13", status: "active" }, { kind: "signal", now }).evidenceStatus, "stale");
  assert.equal(assessMpcEvidence({ sourceUrl: "https://example.com/news", observedAt: "2026-11-12", status: "active" }, { kind: "signal", now }).evidenceStatus, "confirmed");
  const review = buildMpcReview({
    positioning: { headline: "Senior plant leader", summary: "Experienced operations leader", sourceUrl: "https://example.com/summary", observedAt: "2026-11-12", strengths: [{ text: "Led maintenance programs", sourceUrl: "https://example.com/resume", observedAt: "2026-11-12" }] },
    targets: [{ companyName: "Northstar", location: "Toronto", sourceUrl: "https://example.com", observedAt: "2026-11-12" }],
    signals: [{ companyName: "Northstar", signal: "Facility expansion", sourceUrl: "https://example.com/news", observedAt: "2026-10-01", status: "active" }],
  }, { now });
  assert.equal(review.targets[0].evidenceStatus, "confirmed");
  assert.equal(review.signals[0].activeStatus, "expired");
  assert.equal(review.gaps.length, 1);
});

test("profile details require a source URL and observed date before they become exportable", () => {
  const missing = buildMpcReview({ approvedFields: { location: "Toronto" } }, { now });
  assert.equal(missing.approvedFields.location.evidenceStatus, "missing");
  assert.ok(missing.gaps.some((item) => item.kind === "profile_field" && item.field === "location"));
  const sourced = buildMpcReview({
    approvedFields: { location: "Toronto" },
    approvedFieldEvidence: { location: { sourceUrl: "https://source.example/location", observedAt: "2026-11-12" } },
  }, { now });
  assert.equal(sourced.approvedFields.location.evidenceStatus, "confirmed");
  const blind = buildMpcBlindExport({ candidate: {}, positioning: {}, approvedFields: sourced.approvedFields });
  assert.equal(blind.preview.approvedFields.location, "Toronto");
  assert.equal(JSON.stringify(blind).includes("source.example"), false);
});

test("blind export contains source-backed positioning without names, contacts, employers, or source URLs", () => {
  const blind = buildMpcBlindExport({
    candidate: { name: "Pat Private", current_title: "Saved Tracker Title", employers: ["Secret Employer"] },
    positioning: {
      headline: "Senior Operations Leader", summary: "Experienced plant and maintenance leader",
      sourceUrl: "https://source.example/summary", observedAt: "2026-11-12",
      evidenceStatus: "confirmed",
      strengths: [
        { text: "Led multi-site maintenance programs", sourceUrl: "https://source.example/1", observedAt: "2026-11-12", evidenceStatus: "confirmed" },
        { text: "Built preventive maintenance routines", sourceUrl: "https://source.example/2", observedAt: "2026-11-12", evidenceStatus: "confirmed" },
        { text: "Managed plant reliability priorities", sourceUrl: "https://source.example/3", observedAt: "2026-11-12", evidenceStatus: "confirmed" },
        { text: "Coordinated skilled trades teams", sourceUrl: "https://source.example/4", observedAt: "2026-11-12", evidenceStatus: "confirmed" },
      ],
    },
    approvedFields: {
      location: { value: "Toronto, Ontario", sourceUrl: "https://source.example/location", observedAt: "2026-11-12", evidenceStatus: "confirmed" },
      availability: { value: "Four weeks", sourceUrl: "https://source.example/availability", observedAt: "2026-11-12", evidenceStatus: "confirmed" },
      compensationTarget: { value: "$130,000", sourceUrl: "https://source.example/comp", observedAt: "2026-11-12", evidenceStatus: "confirmed" },
    },
    targets: [{ companyName: "Confidential Target", evidenceStatus: "confirmed" }],
    contacts: [{ name: "Contact Name", companyName: "Confidential Target", email: "pat@example.invalid", phone: "555-0100", evidenceStatus: "confirmed" }],
    signals: [{ companyName: "Confidential Target", signal: "Hiring now", sourceUrl: "https://example.com/jobs", observedAt: "2026-11-12", evidenceStatus: "confirmed", activeStatus: "active" }],
    evidence: [{ observedAt: "2026-11-12", sourceUrl: "https://example.com/jobs" }],
  });
  const serialized = JSON.stringify(blind);
  for (const secret of ["Confidential Target", "Pat Private", "Contact Name", "Secret Employer", "pat@example.invalid", "555-0100", "example.com", "Hiring now"]) {
    assert.equal(serialized.includes(secret), false, `blind export leaked ${secret}`);
  }
  assert.equal(blind.complete, true);
  assert.equal(blind.status, "ready_for_review");
  assert.equal(blind.preview.title, "Senior Operations Leader");
  assert.equal(blind.preview.sellingBullets.length, 4);
  assert.equal(blind.preview.approvedFields.location, "Toronto, Ontario");
  assert.equal(blind.coverage.sourcedTargetCount, 1);
  assert.equal(blind.coverage.sourcedContactCount, 1);
  assert.equal(blind.coverage.activeSignalCount, 1);
});

test("blind export stays incomplete until four supported bullets remain after identity stripping", () => {
  const blind = buildMpcBlindExport({
    candidate: { name: "Taylor Reed" },
    positioning: { headline: "Plant Manager", evidenceStatus: "missing", strengths: [
      { text: "Led Taylor Reed at Northstar", sourceUrl: "https://source.example/1", observedAt: "2026-11-12", evidenceStatus: "confirmed" },
      { text: "Maintained production uptime", sourceUrl: "https://source.example/2", observedAt: "2026-11-12", evidenceStatus: "confirmed" },
    ] },
    targets: [{ companyName: "Northstar" }],
  });
  assert.equal(blind.complete, false);
  assert.equal(blind.status, "incomplete");
  assert.equal(blind.preview.sellingBullets.length, 1);
  assert.ok(blind.warnings.some((warning) => warning.includes("withheld")));
  assert.ok(blind.warnings.some((warning) => warning.includes("four source-backed")));
});

test("blind export rejects unsupported title and profile details", () => {
  const blind = buildMpcBlindExport({
    candidate: { name: "Private Candidate" },
    positioning: { headline: "Unverified Plant Manager", evidenceStatus: "missing", strengths: [
      ...[1, 2, 3, 4].map((n) => ({ text: `Supported strength ${n}`, evidenceStatus: "confirmed" })),
    ] },
    approvedFields: {
      location: { value: "Toronto", evidenceStatus: "missing" },
      availability: { value: "Immediate", evidenceStatus: "confirmed" },
    },
  });
  assert.equal(blind.complete, false);
  assert.equal(blind.preview.title, "");
  assert.deepEqual(blind.preview.approvedFields, {});
  assert.ok(blind.warnings.some((warning) => /source-backed title/i.test(warning)));
});
