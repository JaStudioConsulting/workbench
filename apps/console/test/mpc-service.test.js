import assert from "node:assert/strict";
import test from "node:test";
import { loadMpcCaseForCandidate, openMpcCase } from "../src/features/operator-cases/mpcService.js";
import { updateCaseArtifact } from "../src/features/operator-cases/operatorCaseService.js";

const ownerId = "11111111-1111-4111-8111-111111111111";
const candidateId = "sourcing:17";

function createClient() {
  const tables = {
    candidates_all: [{ id: candidateId, candidate_name: "Canonical Candidate", current_title: "Senior Plant Manager", current_company: "Confidential Employer" }],
    operator_cases: [], case_sources: [], case_artifacts: [], case_actions: [],
  };
  let nextId = 0;
  class Query {
    constructor(table) { this.table = table; this.operation = "select"; this.filters = []; this.rows = []; this.mode = "many"; this.sorts = []; this.max = Infinity; }
    select() { return this; }
    insert(input) { this.operation = "insert"; this.input = input; return this; }
    update(input) { this.operation = "update"; this.input = input; return this; }
    eq(key, value) { this.filters.push((row) => row[key] === value); return this; }
    order(key, options = {}) { this.sorts.push({ key, ascending: options.ascending !== false }); return this; }
    limit(max) { this.max = max; return this; }
    maybeSingle() { this.mode = "maybeSingle"; return this; }
    single() { this.mode = "single"; return this; }
    then(resolve, reject) { return Promise.resolve().then(() => this.execute()).then(resolve, reject); }
    execute() {
      const rows = tables[this.table];
      if (!rows) return { data: null, error: new Error(`unexpected table ${this.table}`) };
      let result;
      if (this.operation === "insert") {
        const inserted = (Array.isArray(this.input) ? this.input : [this.input]).map((item) => ({
          ...item,
          id: item.id || `id-${++nextId}`,
          owner_id: item.owner_id || ownerId,
          created_at: item.created_at || new Date(1_800_000_000_000 + nextId).toISOString(),
          updated_at: item.updated_at || new Date(1_800_000_000_000 + nextId).toISOString(),
        }));
        rows.push(...inserted);
        result = inserted;
      } else {
        result = rows.filter((row) => this.filters.every((predicate) => predicate(row)));
        if (this.operation === "update") result.forEach((row) => Object.assign(row, this.input));
      }
      if (this.sorts.length) result = [...result].sort((a, b) => {
        for (const sort of this.sorts) {
          const compared = a[sort.key] < b[sort.key] ? -1 : a[sort.key] > b[sort.key] ? 1 : 0;
          if (compared) return compared * (sort.ascending ? 1 : -1);
        }
        return 0;
      });
      result = result.slice(0, this.max);
      if (this.mode === "single") return result.length ? { data: result[0], error: null } : { data: null, error: new Error("row not found") };
      if (this.mode === "maybeSingle") return { data: result[0] || null, error: null };
      return { data: result, error: null };
    }
  }
  return {
    tables,
    client: {
      auth: { async getUser() { return { data: { user: { id: ownerId } }, error: null }; } },
      from(table) { return new Query(table); },
      async rpc(name, args) {
        if (name !== "save_operator_artifact_revision") return { data: null, error: new Error("unexpected RPC") };
        const prior = tables.case_artifacts.find((row) => row.id === args.artifact_id);
        if (!prior || prior.updated_at !== args.expected_updated_at) return { data: null, error: new Error("stale artifact revision") };
        const latest = tables.case_artifacts.filter((row) => row.case_id === prior.case_id && row.artifact_type === prior.artifact_type)
          .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)).at(-1);
        if (latest?.id !== prior.id) return { data: null, error: new Error("artifact is not the latest version") };
        const index = ++nextId;
        const row = {
          ...prior, id: `id-${index}`, source_ref: `${prior.source_ref}:revision-${index}`,
          content: args.content, generated_by: "human", review_state: "draft", reviewed_at: null,
          created_at: new Date(1_800_000_000_000 + index).toISOString(), updated_at: new Date(1_800_000_000_000 + index).toISOString(),
        };
        tables.case_artifacts.push(row);
        return { data: row, error: null };
      },
    },
  };
}

test("MPC service rejects mixed candidate identity before persistence", async () => {
  const { client, tables } = createClient();
  await assert.rejects(openMpcCase({ candidateId, candidate: { id: "submission:99", candidate_name: "Other Person" } }, { client }), /does not match/i);
  assert.equal(tables.operator_cases.length, 0);
});

test("MPC refresh uses canonical candidate identity and repairs stable evidence rows", async () => {
  const { client, tables } = createClient();
  const strengths = [1, 2, 3, 4].map((n) => ({ text: `Supported capability ${n}`, sourceUrl: `https://source.example/${n}`, observedAt: "2026-11-12" }));
  const base = { candidateId, candidate: { id: candidateId, candidate_name: "Forged Display Name", current_title: "Forged Title" }, positioning: { strengths } };

  const first = await openMpcCase(base, { client, now: new Date("2026-11-13T12:00:00.000Z") });
  assert.equal(first.record.status, "open");
  assert.equal(first.record.title, "Canonical Candidate — Candidate marketing");
  assert.equal(first.blindExport.preview.title, "Senior Plant Manager");
  const firstSerialized = JSON.stringify(first.blindExport);
  assert.equal(firstSerialized.includes("Canonical Candidate"), false);
  assert.equal(firstSerialized.includes("Confidential Employer"), false);
  assert.equal(firstSerialized.includes("Forged Display Name"), false);
  assert.equal(firstSerialized.includes("Forged Title"), false);
  assert.equal(first.blindExport.complete, true);

  const unresolved = await openMpcCase({ ...base, positioning: { headline: "Unverified Headline", summary: "Added summary", strengths, sourceUrl: "", observedAt: "" } }, { client, now: new Date("2026-11-13T12:00:00.000Z") });
  assert.equal(unresolved.record.status, "blocked");
  const missingSourceRows = tables.case_sources.filter((row) => row.source_type === "resume" && row.source_id === "positioning_summary:row:1");
  assert.equal(missingSourceRows.length, 1);
  assert.equal(missingSourceRows[0].evidence_status, "missing");

  const refreshed = await openMpcCase({ ...base, positioning: { headline: "Source-backed Headline", summary: "Added summary", strengths, sourceUrl: "https://source.example/summary", observedAt: "2026-11-12" } }, { client, now: new Date("2026-11-13T12:00:00.000Z") });
  assert.equal(refreshed.record.status, "open");
  const updatedSourceRows = tables.case_sources.filter((row) => row.source_type === "resume" && row.source_id === "positioning_summary:row:1");
  assert.equal(updatedSourceRows.length, 1);
  assert.equal(updatedSourceRows[0].evidence_status, "confirmed");
  assert.equal(updatedSourceRows[0].metadata.sourceUrl, "https://source.example/summary");
  assert.equal(refreshed.blindExport.preview.title, "Source-backed Headline");
  assert.ok(tables.case_artifacts.length > 1, "changed review content creates versioned artifacts");
});

test("an explicit save writes empty section versions when entries are removed", async () => {
  const { client, tables } = createClient();
  const first = await openMpcCase({
    candidateId,
    candidate: { id: candidateId },
    contacts: [{ name: "Recruiting contact", companyName: "Northstar", sourceUrl: "https://northstar.example/team", observedAt: "2026-11-12" }],
    outreachDraft: { subject: "Candidate introduction", body: "Draft message" },
  }, { client, now: new Date("2026-11-13T12:00:00.000Z") });
  const initialContacts = first.artifacts.find((artifact) => artifact.artifact_type === "contacts");
  const initialOutreach = first.artifacts.find((artifact) => artifact.artifact_type === "outreach_draft");
  assert.equal(initialContacts.content.items.length, 1);
  assert.equal(initialOutreach.content.body, "Draft message");

  const second = await openMpcCase({ candidateId, candidate: { id: candidateId } }, { client, now: new Date("2026-11-13T12:00:00.000Z") });
  const latestContacts = second.artifacts.filter((artifact) => artifact.artifact_type === "contacts").at(-1);
  const latestOutreach = second.artifacts.filter((artifact) => artifact.artifact_type === "outreach_draft").at(-1);
  assert.notEqual(latestContacts.id, initialContacts.id);
  assert.notEqual(latestOutreach.id, initialOutreach.id);
  assert.deepEqual(latestContacts.content.items, []);
  assert.deepEqual(latestOutreach.content, { subject: "", body: "" });
  assert.ok(tables.case_artifacts.some((artifact) => artifact.id === initialContacts.id));
});

test("MPC loader returns the latest saved form without writing", async () => {
  const { client, tables } = createClient();
  const payload = {
    candidateId, candidate: { id: candidateId },
    positioning: { headline: "Senior Plant Leader", summary: "Supported summary", sourceUrl: "https://source.example/summary", observedAt: "2026-11-12", strengths: [{ text: "Reliability programs", sourceUrl: "https://source.example/strength", observedAt: "2026-11-12" }], caveats: ["Review site size"] },
    targets: [{ companyName: "Northstar", location: "Toronto", sourceUrl: "https://northstar.example/company", observedAt: "2026-11-12" }],
    contacts: [{ name: "Hiring lead", companyName: "Northstar", sourceUrl: "https://northstar.example/team", observedAt: "2026-11-12" }],
    signals: [{ companyName: "Northstar", signal: "Expansion", status: "active", sourceUrl: "https://northstar.example/news", observedAt: "2026-11-12" }],
    outreachDraft: { subject: "Introduction", body: "Unsent draft" },
  };
  await openMpcCase(payload, { client, now: new Date("2026-11-13T12:00:00.000Z") });
  const before = Object.fromEntries(Object.entries(tables).map(([table, rows]) => [table, rows.length]));
  const loaded = await loadMpcCaseForCandidate(candidateId, { client });
  assert.equal(loaded.candidate.candidate_name, "Canonical Candidate");
  assert.equal(loaded.formData.positioning.headline, "Senior Plant Leader");
  assert.equal(loaded.formData.targets[0].companyName, "Northstar");
  assert.equal(loaded.formData.contacts[0].name, "Hiring lead");
  assert.equal(loaded.formData.signals[0].signal, "Expansion");
  assert.equal(loaded.formData.outreachDraft.body, "Unsent draft");
  assert.deepEqual(Object.fromEntries(Object.entries(tables).map(([table, rows]) => [table, rows.length])), before);
});

test("generic artifact edits append a draft and reject stale revisions", async () => {
  const { client, tables } = createClient();
  tables.operator_cases.push({ id: "case-1", case_type: "after_call", owner_id: ownerId });
  const old = {
    id: "artifact-1", owner_id: ownerId, case_id: "case-1", artifact_type: "branded_resume",
    source_ref: "meeting:resume:v1", generated_by: "after_call_service", review_state: "approved",
    reviewed_at: "2026-11-13T10:00:00.000Z", content: { text: "Old resume", pdf: { data: "old-pdf" }, exportStatus: "draft_rendered" },
    created_at: "2026-11-13T09:00:00.000Z", updated_at: "2026-11-13T10:00:00.000Z",
  };
  tables.case_artifacts.push(old);
  const next = await updateCaseArtifact(old.id, { text: "Edited resume", pdf: { data: "old-pdf" } }, {
    client, expectedUpdatedAt: old.updated_at,
  });
  assert.notEqual(next.id, old.id);
  assert.equal(next.review_state, "draft");
  assert.equal(next.generated_by, "human");
  assert.equal(next.content.pdf, null);
  assert.equal(next.content.exportStatus, "not_rendered");
  assert.equal(next.content.editReview.reviewNeeded, true);
  assert.ok(next.content.editReview.humanEditedPaths.includes("text"));
  assert.match(next.content.editReview.note, /quotes are reference material/i);
  assert.equal(old.content.text, "Old resume");
  assert.deepEqual(old.content.pdf, { data: "old-pdf" });
  assert.equal(old.review_state, "approved", "only the database supersession trigger changes prior review state");

  await assert.rejects(updateCaseArtifact(old.id, { text: "stale edit" }, { client, expectedUpdatedAt: old.updated_at }), /stale|reload/i);
  await assert.rejects(updateCaseArtifact(next.id, { text: "wrong timestamp" }, { client, expectedUpdatedAt: old.updated_at }), /changed since you opened/i);
});
