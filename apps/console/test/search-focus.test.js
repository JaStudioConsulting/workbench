import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

test("search candidate navigation shows the directory without an active job and marks only the exact source ID", async () => {
  const vite = await createServer({
    root: new URL("../", import.meta.url).pathname,
    server: { middlewareMode: true },
    appType: "custom",
  });
  try {
    const [{ default: CandidateReview }, { default: PeopleView }] = await Promise.all([
      vite.ssrLoadModule("/src/features/candidate-review/CandidateReview.jsx"),
      vite.ssrLoadModule("/src/features/candidate-review/PeopleView.jsx"),
    ]);
    const noJobHtml = renderToStaticMarkup(
      React.createElement(CandidateReview, {
        initialView: "people",
        focusCandidateId: "submission:30",
      }),
    );
    assert.match(noJobHtml, /data-testid="people-view"/);
    assert.doesNotMatch(noJobHtml, /data-testid="unmatched-job-state"/);

    const base = {
      name: "Synthetic Same Name",
      title: "Program Manager",
      employer: "Synthetic Company",
      location: "Toronto, ON",
      initials: "SN",
      stage: "Applied",
      resumeStatus: "resume_on_file",
      activityTrail: [],
    };
    const html = renderToStaticMarkup(
      React.createElement(PeopleView, {
        candidates: [
          { ...base, id: "sourcing:20" },
          { ...base, id: "submission:30" },
        ],
        currentJob: null,
        focusCandidateId: "submission:30",
      }),
    );
    assert.equal((html.match(/data-testid="focused-candidate-row"/g) || []).length, 1);
    assert.match(html, /data-candidate-id="submission:30"[^>]*data-testid="focused-candidate-row"/);
    assert.doesNotMatch(html, /data-candidate-id="sourcing:20"[^>]*data-testid="focused-candidate-row"/);
  } finally {
    await vite.close();
  }
});

test("theme defines every colour token the components use and the search field shows a focus ring", async () => {
  const { readFile } = await import("node:fs/promises");
  const [styles, command] = await Promise.all([
    readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../src/components/ui/command.tsx", import.meta.url), "utf8"),
  ]);
  for (const token of ["input", "card", "card-foreground", "popover", "popover-foreground", "border"]) assert.match(styles, new RegExp(`--color-${token}:\\s*#`));
  assert.match(styles, /@layer base \{[^}]*border-color: var\(--color-border, currentColor\)/);
  assert.match(command, /has-\[\[data-slot=command-input\]:focus-visible\]:ring-2 has-\[\[data-slot=command-input\]:focus-visible\]:ring-ring/);
  assert.doesNotMatch(command, /border-input\/30/);
});
