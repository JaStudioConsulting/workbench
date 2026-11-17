// Synthetic resumes only. No real candidate data. Each fixture has the text as it would
// be stored (input) and the exact words that must come out (expected), written by hand:
// formatting marks are the only characters that may disappear.

const nbsp = String.fromCodePoint(0xa0);

function longResume() {
  const subjects = ["The plant", "A cross-functional team", "The maintenance group", "Our supplier network", "The quality lab"];
  const verbs = ["reduced downtime", "standardised changeover", "documented every deviation", "trained new operators", "audited incoming material"];
  const tails = ["across three shifts", "within one quarter", "without extra headcount", "during a major retool", "for two product families"];
  const inputLines = ["Morgan Ellery", ""];
  const expected = ["Morgan Ellery"];
  for (let section = 1; section <= 12; section += 1) {
    const heading = `PROJECT HISTORY PART ${section}`;
    inputLines.push(heading, "");
    expected.push(heading);
    for (let paragraph = 1; paragraph <= 3; paragraph += 1) {
      const sentence = `${subjects[(section + paragraph) % 5]} ${verbs[(section * paragraph) % 5]} ${tails[(section + 2 * paragraph) % 5]} in project ${section}.${paragraph} and then reviewed the result with the client lead before the next release window opened.`;
      inputLines.push(sentence, "");
      expected.push(sentence);
    }
    for (let bullet = 1; bullet <= 5; bullet += 1) {
      const text = `Delivered milestone ${section}-${bullet} ${tails[(section + bullet) % 5]} using ${verbs[(section + bullet) % 5]} as the main lever`;
      inputLines.push(`- ${text}`);
      expected.push(text);
    }
    inputLines.push("");
  }
  return { input: inputLines.join("\n"), expected: expected.join("\n"), minPages: 3 };
}

const plain = `Jordan Avery

Experienced maintenance planner with a focus on reliability and spare parts strategy.
Comfortable working with night shifts, vendors, and auditors.

Second paragraph after a blank line. It has two sentences.`;

const headings = `Casey Brooks
Toronto, Ontario

SUMMARY
Production supervisor who keeps lines running.

CORE SKILLS
Lean tools, root cause analysis, scheduling.

Certifications:
Six Sigma Green Belt
Forklift licence

EDUCATION & TRAINING
Diploma in Mechanical Technology`;

const lists = `Riley Hart

EXPERIENCE
• Led a crew of eight
· Wrote the shift handover standard
▪ Cut scrap by 11%
  - nested dash item under the bullets
  - second nested item that
    continues on an indented line

Duties:
1. Plan the weekly schedule
2) Order consumables
3. Review the safety log
   * nested star item

Closing note after the list.`;

const dates = `Taylor Quinn

EXPERIENCE
Senior Planner, Northfield Plastics
Jan 2019 – Present
2015-2018 | Planner | Lakeview Foods
03/2012 – 06/2014 and Nov. 12, 2020
Reference code 2019. stays plain, as does version 3.5 notes.
- Led the 2021–2023 retool programme`;

const unicode = `Zoë Müller-Łukasz

SUMMARY
Café “quality” lead; naïve about R&D budgets but sharp on 50%+ yield targets, €1,200 ± £30, ½ day, 5 × 3 and C++ / C# / .NET work… résumé – style — dashes.
Snake_case_name and 5*3 and a_b_c stay as typed. Привет and Δ-values included.
Price list: $5*3 is not emphasis, and neither is * alone.`;

const markdown = `# Sam Rowan

## Summary
Maker of **bold claims**, _quiet details_ and ***loud ones***. Uses \`make build\` daily.

## Experience
### Platform Engineer
- Built **the pipeline**
* Wrote _runbooks_ for [the team wiki](https://example.com/wiki/team)
+ Kept notes at [docs](https://example.com/docs)

1. First step
2. Second step

---

\`\`\`sh
npm run test
\`\`\`
Final line with an unclosed **star and a snake_case_word.`;

const awkward = [
  "Pat Doe",
  "",
  "",
  "",
  `Spacing${nbsp}test with tabs\tand   many   spaces.`,
  "Windows line endings follow.",
  "https://example.com/this/is/an/extremely/long/address/that/has/no/spaces/at/all/and/keeps/going/and/going/until/it/is/wider/than/the/page/itself/for/sure/abcdefghijklmnopqrstuvwxyz0123456789",
  "Last line.",
].join("\r\n");

const long = longResume();

export const FIXTURES = [
  { name: "plain paragraphs", input: plain, expected: plain },
  {
    name: "headings detected from plain text",
    input: headings,
    expected: headings,
    expectKinds: ["title", "paragraph", "heading", "paragraph", "heading", "paragraph", "heading", "paragraph", "heading", "paragraph"],
  },
  {
    name: "bullets and numbered lists",
    input: lists,
    expected: `Riley Hart
EXPERIENCE
Led a crew of eight
Wrote the shift handover standard
Cut scrap by 11%
nested dash item under the bullets
second nested item that continues on an indented line
Duties:
Plan the weekly schedule
Order consumables
Review the safety log
nested star item
Closing note after the list.`,
  },
  {
    name: "dates ranges and odd spacing in text",
    input: dates,
    expected: `Taylor Quinn
EXPERIENCE
Senior Planner, Northfield Plastics
Jan 2019 – Present
2015-2018 | Planner | Lakeview Foods
03/2012 – 06/2014 and Nov. 12, 2020
Reference code 2019. stays plain, as does version 3.5 notes.
Led the 2021–2023 retool programme`,
  },
  { name: "odd punctuation and unicode", input: unicode, expected: unicode },
  {
    name: "markdown symbols become formatting",
    input: markdown,
    expected: `Sam Rowan
Summary
Maker of bold claims, quiet details and loud ones. Uses make build daily.
Experience
Platform Engineer
Built the pipeline
Wrote runbooks for the team wiki
Kept notes at docs
First step
Second step
npm run test
Final line with an unclosed **star and a snake_case_word.`,
    markdownFixture: true,
  },
  { name: "very long resume over several pages", input: long.input, expected: long.expected, minPages: long.minPages },
  {
    name: "windows line endings, tabs, non-breaking spaces and an overlong token",
    input: awkward,
    expected: `Pat Doe
Spacing test with tabs and many spaces.
Windows line endings follow.
https://example.com/this/is/an/extremely/long/address/that/has/no/spaces/at/all/and/keeps/going/and/going/until/it/is/wider/than/the/page/itself/for/sure/abcdefghijklmnopqrstuvwxyz0123456789
Last line.`,
    overlongToken: true,
  },
];
