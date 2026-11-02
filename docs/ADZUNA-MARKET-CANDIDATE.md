# Adzuna Market Candidate workflow

## Status

**Intended process only. Not implemented. Do not trigger Adzuna yet.**

This document is the source of truth for adding Adzuna to the existing
Recruiting Workbench. It does not authorize a second app, background searches,
automatic lead creation, or automatic outreach.

## Purpose

Use Adzuna Canada to find current jobs that may fit a selected candidate, then
let Ja decide which employers are worth approaching.

```text
Candidate
   ↓
Market Candidate
   ↓
Enter search terms
   ↓
Search Adzuna Canada
   ↓
Review job results
   ↓
Select opportunities
   ↓
Create outreach drafts
   ↓
Human review
   ↓
Send manually
```

## Location in the app

- Start from a real candidate record.
- Open **Market Candidate** from that candidate.
- Keep the workflow inside the existing Workbench.
- Do not create a separate Adzuna application.

## Required inputs

- Candidate identity and source-backed profile.
- Candidate title and relevant skills.
- Preferred location or search radius.
- Recruiter-entered search terms.
- Country fixed to Canada for the first version.

Missing facts remain missing. The workflow must never infer credentials,
experience, compensation, location preference, or availability.

## Search contract

- Human clicks **Search**. No scheduled or background searches.
- Gateway calls the Adzuna Canada Search API server-side.
- Credentials come from server environment variables or the M1 credential
  store. They never enter browser code, Supabase rows, logs, or GitHub.
- Default endpoint: `https://api.adzuna.com/v1/api/jobs/ca/search/{page}`.
- Bound result count and pagination.
- Show Adzuna attribution and preserve the source job URL.
- Results are read-only until Ja explicitly selects an opportunity.

Official reference: [Adzuna API documentation](https://developer.adzuna.com/docs/search).

## Results and Leads

- A result is an external opportunity, not automatically a Workbench Lead.
- Ja may promote one selected result into Leads after review.
- Deduplicate by Adzuna job ID and canonical source URL before saving.
- Never overwrite an existing client, job, lead, or candidate record.
- Record the source, search date, and candidate used for the search.

## Outreach

- Generate drafts only from candidate facts and the selected job posting.
- Keep claims source-grounded. No invented fit, achievements, or availability.
- Ja reviews the company, recipient, message, attachments, and ownership risk.
- Sending is a separate manual action after human approval.
- No bulk send and no automatic follow-up.

## Activation gates

All gates must pass before the first live API call:

1. Confirm Adzuna permits Ja's commercial candidate-marketing use. Adzuna's
   standard API terms distinguish ordinary job search from commercial analysis,
   prospecting, and lead-generation use.
2. Store credentials only on the M1 server.
3. Add a same-origin gateway route with bounded inputs and safe errors.
4. Add the **Market Candidate** screen to the existing candidate workflow.
5. Add deduplication, attribution, and a manual Leads promotion action.
6. Test with synthetic candidate data before using a real candidate.
7. Verify there is no background query, auto-save, or send path.

## Non-goals

- No automatic candidate scoring.
- No automatic decision about candidate quality.
- No bulk Loxo checking.
- No replacement for Tracker, Supabase, or Loxo.
- No new standalone app.
