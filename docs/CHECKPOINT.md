# Workbench checkpoint

Updated: 2026-08-24

This is the durable handoff for the repository migration, current deployment truth, and UI discussion. It distinguishes code that exists from features Ja can use today.

## Repository ownership and versions

- Application: private `JaStudioConsulting/workbench` repository.
- Recruiting authority: private `JaStudioConsulting/recruitment-skills` repository.
- Workbench `main`: `03a43b768ac03d7477a9b45f85196712723b267a` before this checkpoint update.
- Recruitment skills `main`: `0f8e929f28c94098f3f992ab33eb7ba901dd9527`.
- Synthetic demonstration branch: `codex/synthetic-sandbox` at `6ad65674deb2798a49ce70c62d8ef5f54912ce57`.
- Workbench loads `@jastudioconsulting/recruitment-skills` through its public package exports. Skills are not copied back into the application repository.

## Deployment truth

- A synthetic-only frontend is deployed at `https://workbench-synthetic-sandbox.vercel.app/`.
- Vercel project: `workbench-synthetic-sandbox` under Ja's Vercel team.
- The permanent Vercel alias currently serves the synthetic demonstration, not the connected Workbench.
- The demonstration uses one fixed fake candidate and runs entirely in the browser.
- It can run a fixed source audit and display basic resume, submission, presentation-email, and Loxo-note drafts.
- It cannot accept uploads, edit candidate inputs, save cases, sign in, create Gmail drafts, read Loxo, query Neo4j, or process a real candidate.
- No connected production gateway, database, OAuth session, case storage, or live recruiting integration has been deployed.

## Implemented application foundation

- React/Vite console with Case Intake, Review Queue, Drafts, and Safety Settings foundations.
- Express/Vercel gateway with health, safety, authenticated MCP discovery, and after-call preparation routes.
- Better Auth and Google provider configuration that fails closed until every required hosted setting is present.
- Strict HTTPS origin allowlisting and credentialed CORS.
- `$recruiter` as the only recruiting MCP front door plus read-only `workspace_status`.
- Draft-only Gmail abstraction with no send method.
- Neo4j read-only adapter that blocks write and administration commands.
- Shared schemas for candidate input, source-backed claims, workflow drafts, safety state, MCP discovery, and error responses.
- No browser-local case storage and no fallback persistence when hosted services are unavailable.

## Recruiting authority

`$recruiter` remains the only recruiting front door. It routes to 22 internal modules covering candidate screening, branded resumes, candidate defense, matching, reference checks, cover letters, vetting, Ja-style writing, job support, LinkedIn posts, Loxo guidance, offer letters, HR support, sourcing, web sourcing, and full candidate write-ups.

Current distinction:

- The skills package owns instructions, rules, templates, builders, and capability contracts.
- The Workbench gateway can return the recruiter router and permitted guides.
- The online sandbox does not yet execute the complete 22-module workflow.
- Restricted, internal, and legacy modules are not exposed as standalone MCP tools.

## Source and action rules

- Resume is the baseline career source.
- Transcript or explicit call notes may update missing facts only when stated.
- Job description positions evidence but cannot create candidate facts.
- Every accepted after-call claim value and evidence snippet must exist in its declared resume, transcript, or call-notes source.
- Outputs remain drafts and require human review.
- Gmail send, candidate submission, Loxo write, Neo4j write, approval decision through MCP, and external delete remain unavailable.
- No live candidate, client, referee, credential, token, environment file, or secret belongs in code, tests, fixtures, templates, logs, or Git.

## Intended UI tabs

Current UI decision map proposes eight recruiter-facing top-level tabs.

### Today

Daily action view for missing information, urgent cases, drafts needing review, recent work, interviews, follow-ups, and stalled next actions. Every card opens the exact underlying work item.

### Cases

Primary workspace for candidate work. Proposed internal views:

- Overview
- Sources
- Audit and Fit
- Outputs
- Approval and History

Cases lead to Review, Jobs, Sourcing, or source correction.

### Candidates

Searchable candidate directory, verified profile, documents, calls, preferences, compensation, availability, role matches, risks, and existing packages.

### Jobs

Active roles, job intake, mandatory and flexible requirements, role pipeline, matched candidates, evidence gaps, and duplicate-submission controls.

### Sourcing

Candidate, company, business-development, MPC, re-engagement, and competitor research with sources, verification, confidence, deduplication, lists, and reviewed exports.

### Calls

Scheduled and completed calls, recording and transcript status, after-call fact extraction, conflicts, compensation, availability, motivations, and follow-up questions.

### Review

Human checkpoint for resumes, submissions, presentation emails, Loxo bullets, reference checks, cover letters, and offers. Controls should support approve exact version, request changes with notes, compare versions, inspect evidence, download, and permitted draft actions.

### Settings

Google, Drive, Gmail, Calendar, Loxo, Airtable, Adzuna, Firecrawl, Neo4j, private access, sessions, storage, safety boundaries, navigation, notifications, and accessibility settings.

## Explicit UI decision: no Agents tab

- There is no planned `Agents` tab and no visual automation builder like a trigger, condition, and action canvas.
- Workflows belong inside Cases and Review.
- Codex, OpenCode, Hermes, Claude, Gemini, generic MCP, Neo4j, and individual recruiter modules stay behind the interface.
- They may perform approved work but should not become separate daily dashboards or tabs.
- This decision is unchanged unless Ja explicitly revisits it.

## Editable UI decision map

An interactive decision map was produced during the 2026-08-24 discussion. It supports expanding branches, editing labels and destinations, adding branches, writing notes, marking items `RIGHT`, `WRONG`, `MISSING`, or `LATER`, and exporting a backup or Markdown notes.

The map is a discussion and approval artifact. It is not evidence that these tabs are implemented. Ja should mark decisions before frontend implementation uses the map as a specification.

## Open UI decisions for Ja

1. Should Today be the default opening screen, and which three action groups appear first?
2. Should a case use one scrolling workspace or separate internal tabs?
3. Should business-development Leads live under Candidates or become a later top-level tab?
4. Should Jobs ship in the first usable release or after candidate packaging works?
5. Which sourcing mode comes first: active-role candidates, MPC, business-development companies, or re-engagement?
6. Should Calls be a full tab before recording integration exists?
7. Should Drafts and Approvals stay together under Review or become separate tabs?
8. Should integrations remain inside Settings or move into a later Administration area?

## Recommended build sequence from this discussion

### Release one

- Private authentication and durable hosted case storage.
- Cases with source intake, source audit, missing-information and conflict handling.
- Recruiter-routed after-call preparation.
- Resume, submission, presentation-email, and Loxo-bullet review surfaces.
- Change requests, exact-version approval, history, and document download.
- Synthetic end-to-end verification before any real candidate use.

### Release two

- Drive intake.
- One approved Gmail draft creation flow.
- Candidate and job records.
- Calls and transcripts.
- Sourcing workflows.
- Read-only Loxo and Neo4j.
- Verified Codex, OpenCode, Hermes, Claude, Gemini, and generic MCP host connections.

## Remaining cutover blockers

- Ja must confirm the UI decision map.
- Provision and approve hosted PostgreSQL plus Better Auth schema migration.
- Configure encrypted Vercel environment values and exact production origins.
- Validate Google OAuth and gateway sessions with a non-production account.
- Add and test durable case storage.
- Connect the frontend to the authenticated gateway.
- Implement real source intake and recruiter execution rather than fixed synthetic playback.
- Verify each external integration and MCP host using synthetic data only.
- Complete privacy, secret, dependency, browser, responsive, and end-to-end checks.

## Current safety posture

- Workbench main tests, type checks, privacy validation, production build, and production dependency audit passed during the 2026-08-24 inspection.
- Synthetic branch verification passed 16 Workbench tests plus privacy, type, build, and dependency checks.
- Recruitment skills validation found 22 capabilities, 19 declared tool contracts, 6 hosts, and 88 packaged skill files; its three tests and Python/package checks passed.
- Passing checks do not authorize live candidate use, Gmail send, candidate submission, Loxo write, Neo4j write, active-client repointing, repository deletion, or production cutover.

## Next continuation instruction

Read this checkpoint first. Do not restart migration or treat the synthetic Vercel page as the completed Workbench. Resume from UI decisions, then build the smallest usable private release: Cases, Sources, Audit and Fit, Outputs, Review, authentication, and durable storage.
