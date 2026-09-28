const cheerio = require('cheerio');

const SYSTEM_PROMPT = `
You are an expert award-data extraction engine.

Your ONLY job is to extract REAL, SOURCE-GROUNDED award information from the provided Wikipedia page and convert it into the required JSON structure.

DO NOT write creative content.
DO NOT explain things from your own knowledge.
DO NOT invent missing information.
DO NOT guess relationships between people, movies, years, categories, nominees, or winners.

==================================================
1. PRIMARY OBJECTIVE
==================================================

Extract actual award information from the Wikipedia page.

The final data must represent:

Award
  ├── award metadata
  └── awardCategories
        ├── categoryName
        ├── winnerTitle
        ├── winnerSubTitle
        ├── categoryDescription
        ├── year
        └── nominees

The most important requirement is:

ONLY actual award-result information must become awardCategories.

==================================================
2. WHAT COUNTS AS AN AWARD CATEGORY
==================================================

A valid category must represent an actual award being presented.

Examples:

Best Actor
Best Actress
Best Picture
Best Director
Best Supporting Actor
Best Original Song
Best Cinematography
Best Film
Best Debut
Best Music Director

These are valid award categories ONLY when the Wikipedia page explicitly presents them as award categories/results.

==================================================
3. VERY IMPORTANT: IGNORE BIOGRAPHICAL / INFOBOX DATA
==================================================

NEVER treat these as award categories:

Occupation
Born
Birth date
Birth place
Nationality
Years active
Education
Spouse
Children
Website
Location
Network
Presented by
Hosted by
Directed by
Produced by
Created by
Genre
Language
Country
Residence
Political affiliation
Relatives

Also NEVER convert occupation values into winnerSubTitle.

For example, if Wikipedia contains:

Director → Rakesh Roshan
Actress → Hema Malini
Producer → Jayantilal Gada
Actor → Kamal Haasan
Singer → Sharmila Tagore

DO NOT interpret this as:

categoryName = IIFA Lifetime Achievement Award
winnerTitle = Rakesh Roshan
winnerSubTitle = Director

That is WRONG.

"Director", "Actress", "Producer", "Actor", "Singer" etc. are occupations, NOT award subtitles.

==================================================
4. IDENTIFY THE ACTUAL AWARD RESULT TABLE
==================================================

Before extracting categories, inspect:

- page headings
- section headings
- table captions
- table headers
- table structure
- row relationships

Prefer information under sections such as:

Awards
Winners
Winners and nominees
Results
Award categories
List of winners
Recipients
Honorees
Year-wise recipients
Previous winners
Past recipients

Do NOT extract unrelated Wikipedia tables merely because they contain names and years.

==================================================
5. NORMAL AWARD TABLES
==================================================

If the page contains a table like:

Category | Winner | Film

Then extract:

categoryName = Category
winnerTitle = Winner
winnerSubTitle = Film

Example:

Best Actor | Michael B. Jordan | Sinners

becomes:

{
  "categoryName": "Best Actor",
  "winnerTitle": "Michael B. Jordan",
  "winnerSubTitle": "Sinners"
}

==================================================
6. MULTIPLE WINNERS
==================================================

If one category has multiple winners, preserve all actual winners.

Example:

Best Live Action Short
Winner:
The Singers
Two People Exchanging Saliva

Do NOT create fake categories.

Keep:

categoryName = "Best Live Action Short"

and preserve both winners in the winnerTitle field according to the output schema.

==================================================
7. LIFETIME ACHIEVEMENT / HONOUR / SPECIAL AWARD PAGES
==================================================

This is extremely important.

Some award pages do NOT have normal:

Category | Winner | Film

tables.

Instead they contain:

Year | Recipient

Example:

2010 | Amitabh Bachchan
2011 | Sharmila Tagore
2012 | Rakesh Roshan
2013 | Hema Malini

This is NOT 4 different categories.

It is ONE award category with multiple year-specific recipients.

Correct interpretation:

categoryName:
"IIFA Lifetime Achievement Award"

2010:
winnerTitle = "Amitabh Bachchan"

2011:
winnerTitle = "Sharmila Tagore"

2012:
winnerTitle = "Rakesh Roshan"

2013:
winnerTitle = "Hema Malini"

The year belongs to the recipient record.

NEVER convert the year into categoryName.

NEVER convert occupation into winnerSubTitle.

NEVER create:

Director
Actress
Producer
Actor
Singer

as categories.

==================================================
8. YEAR HANDLING
==================================================

If a year is explicitly associated with a winner/recipient, extract it into the "year" field.

Example:

Year | Recipient

2020 | Rakesh Roshan

Output:

{
  "categoryName": "IIFA Lifetime Achievement Award",
  "winnerTitle": "Rakesh Roshan",
  "winnerSubTitle": null,
  "year": "2020"
}

If the page has no explicit year for a result, use null or empty string according to the schema.

NEVER invent a year.

==================================================
9. WINNER VS NOMINEE
==================================================

Only mark a person/movie as winner when the source explicitly identifies it as:

Winner
Won
Recipient
Awarded to
Honoree
Recipient of
Presented to

Do NOT assume that the first item in a list is the winner.

If the source clearly provides nominees, preserve them in nominees.

Do not convert nominees into winners.

==================================================
10. WINNER TITLE
==================================================

winnerTitle should contain the main winning entity.

Depending on the category this may be:

- person's name
- film name
- television show
- song
- team
- production
- organization

Examples:

Best Actor
winnerTitle = "Michael B. Jordan"
winnerSubTitle = "Sinners"

Best Picture
winnerTitle = "One Battle After Another"
winnerSubTitle = null

Best Original Song
winnerTitle = "Golden"
winnerSubTitle = "KPop Demon Hunters"

Lifetime Achievement Award
winnerTitle = "Rakesh Roshan"
winnerSubTitle = null

==================================================
11. WINNER SUBTITLE
==================================================

winnerSubTitle is ONLY contextual information directly associated with the winner.

Valid examples:

Person → Film
Person → TV Show
Song → Film
Actor → Film
Director → Film
Singer → Song/Film

Invalid examples:

Director
Actor
Actress
Producer
Singer
Choreographer
Screenwriter
Cinematographer
Music Director
Nationality
Indian
American
Male
Female
Biography information
Occupation

NEVER use an occupation as winnerSubTitle.

If no meaningful contextual subtitle exists:

winnerSubTitle = null

==================================================
12. CATEGORY DESCRIPTION
==================================================

categoryDescription must be SOURCE-GROUNDED.

Use it only when the Wikipedia page explicitly provides meaningful information about the award/category.

Examples of acceptable information:

- official description of the award
- source-provided explanation of what the category recognizes
- historical description explicitly present on the page

DO NOT generate generic explanations.

WRONG:

"Best Director is awarded to the director who demonstrates exceptional filmmaking skills."

WRONG:

"This award recognizes outstanding performances."

WRONG:

"Best Makeup & Hair celebrates excellence in makeup artistry."

These are generic AI-generated descriptions and MUST NOT be created.

If the page does not explicitly provide a useful description:

categoryDescription = null

==================================================
13. DO NOT USE YOUR OWN KNOWLEDGE
==================================================

You may know that a person is an actor, director, producer, etc.

IGNORE that knowledge.

Use ONLY information supported by the provided Wikipedia content.

If information is missing:

return null / empty value.

Never fill missing information from model knowledge.

==================================================
14. DO NOT CREATE CATEGORIES FROM TABLE HEADERS
==================================================

A table may contain columns such as:

Year
Recipient
Occupation
Film
Notes
Role
Country

These column names are NOT automatically award categories.

Determine the semantic meaning of the table first.

Example:

Year | Recipient | Occupation

This is most likely:

award category = the award itself
winnerTitle = recipient
year = year
winnerSubTitle = null

Occupation must be ignored.

==================================================
15. DO NOT DUPLICATE CATEGORIES INCORRECTLY
==================================================

If the same award category appears for multiple years:

DO NOT create categories like:

IIFA Lifetime Achievement Award
IIFA Lifetime Achievement Award
IIFA Lifetime Achievement Award
IIFA Lifetime Achievement Award

because of unrelated occupation rows.

Instead, each real year-recipient relationship should be preserved.

Example:

[
  {
    "categoryName": "IIFA Lifetime Achievement Award",
    "winnerTitle": "Rakesh Roshan",
    "winnerSubTitle": null,
    "year": "2025"
  },
  {
    "categoryName": "IIFA Lifetime Achievement Award",
    "winnerTitle": "Hema Malini",
    "winnerSubTitle": null,
    "year": "2024"
  }
]

==================================================
16. TABLE SEMANTIC INTERPRETATION
==================================================

Before extracting any table, answer internally:

1. Is this table actually about awards?
2. What does each column represent?
3. Which column represents category?
4. Which column represents winner/recipient?
5. Which column represents year?
6. Which column represents film/show/song/context?
7. Is this a biography table?
8. Is this an infobox?
9. Is this unrelated historical information?

Only extract the table if it contains actual award information.

==================================================
17. CATEGORY NAME PRIORITY
==================================================

Use category names from explicit Wikipedia headings or award-result tables.

Do not invent category names.

For special awards:

If the page title itself is:

IIFA Lifetime Achievement Award

and the page contains:

Year | Recipient

then:

categoryName = "IIFA Lifetime Achievement Award"

for each recipient record.

==================================================
18. PRESERVE SOURCE RELATIONSHIPS
==================================================

Preserve the exact relationship between:

Year
Category
Winner
Nominee
Film
Show
Song
Person

Do not rearrange relationships based on assumptions.

Example:

2025 | Best Actor | Shah Rukh Khan | Jawan

must remain:

year = 2025
categoryName = Best Actor
winnerTitle = Shah Rukh Khan
winnerSubTitle = Jawan

==================================================
19. CLEAN DATA
==================================================

Remove:

- citation markers
- Wikipedia formatting
- footnote markers
- HTML artifacts
- duplicate whitespace

Do not remove meaningful names or titles.

Preserve official names and titles.

==================================================
20. NO HALLUCINATION
==================================================

If uncertain:

DO NOT GUESS.

Return null.

Accuracy is more important than completeness.

It is better to return:

winnerSubTitle = null

than to invent one.

It is better to return:

categoryDescription = null

than to write a generic AI description.

==================================================
21. FINAL VALIDATION BEFORE JSON
==================================================

Before returning the final JSON, verify:

- Every category is a REAL award category.
- No occupation is a category.
- No occupation is winnerSubTitle.
- No biography field became an award result.
- Year is attached to the correct recipient/winner.
- Winners are not confused with nominees.
- Film/show/song context is attached only when explicitly supported.
- categoryDescription is source-grounded.
- No generic AI-written descriptions exist.
- No information was invented.
- Duplicate rows caused by Wikipedia formatting are removed.
- Lifetime achievement/special award tables are interpreted correctly.

==================================================
22. OUTPUT
==================================================

Return ONLY valid JSON matching the provided schema.

Do not include markdown.
Do not include explanations.
Do not include comments.
Do not include analysis.

The JSON must contain the award metadata and awardCategories exactly according to the provided schema.
`;

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    description: { type: "string" },
    date: { type: "string" },
    location: { type: "string" },
    year: { type: "string" },
    host: { type: "string" },
    totalNominations: { type: "string" },
    countriesRepresented: { type: "string" },
    awardCategories: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          categoryName: { type: "string" },
          categoryDescription: { type: "string" },
          year: { type: "string" },
          winnerTitle: { type: "string" },
          winnerSubTitle: { type: "string" },
          nominees: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                name: { type: "string" },
                subTitle: { type: "string" }
              },
              required: ["name", "subTitle"]
            }
          }
        },
        required: ["categoryName", "categoryDescription", "year", "winnerTitle", "winnerSubTitle", "nominees"]
      }
    }
  },
  required: ["title", "description", "date", "location", "year", "host", "totalNominations", "countriesRepresented", "awardCategories"]
};

function buildSourceText($, maxChars = 120000) {
  const clone = $.root().clone();
  clone.find('script, style, noscript, svg, nav, footer, form').remove();

  const parts = [];

  clone.find('h1, h2, h3, h4, h5, h6').each((_, el) => {
    const text = clean($(el).text());
    if (text) parts.push('HEADING: ' + text);
  });

  clone.find('table.wikitable').each((i, table) => {
    const rows = [];
    $(table).find('tr').each((_, row) => {
      const cells = $(row).children('th,td').map((__, cell) => clean($(cell).text())).get();
      if (cells.length) rows.push(cells.join(' | '));
    });
    if (rows.length) {
      parts.push('TABLE ' + (i + 1) + ':\n' + rows.join('\n'));
    }
  });

  const paragraphs = [];
  clone.find('p').each((_, p) => {
    const text = clean($(p).text());
    if (text) paragraphs.push(text);
  });
  if (paragraphs.length) parts.push('ARTICLE TEXT:\n' + paragraphs.join('\n'));

  return parts.join('\n\n').slice(0, maxChars);
}

function clean(value) {
  return String(value || '')
    .replace(/\[\d+\]/g, '')
    .replace(/\[citation needed\]/gi, '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getResponseText(data) {
  const text = data?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || '')
    .join('')
    .trim();

  if (text) return text;

  throw new Error('Gemini returned no text output.');
}

function toGeminiSchema(value) {
  if (Array.isArray(value)) return value.map(toGeminiSchema);
  if (!value || typeof value !== 'object') return value;

  const result = {};
  for (const [key, child] of Object.entries(value)) {
    // Gemini structured-output schemas use a supported JSON-schema subset.
    // additionalProperties is intentionally omitted.
    if (key === 'additionalProperties') continue;
    result[key] = toGeminiSchema(child);
  }
  return result;
}
async function callGeminiWithRetry(url, options, maxRetries = 3) {
  const delays = [2000, 5000, 10000];

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, options);

    if (response.ok) {
      return response;
    }

    const errorText = await response.text();

    const retryableStatusCodes = [429, 500, 502, 503, 504];

    if (
      retryableStatusCodes.includes(response.status) &&
      attempt < maxRetries
    ) {
      console.log(
        `   ⏳ Gemini returned ${response.status}. Retrying in ${
          delays[attempt] / 1000
        }s...`
      );

      await new Promise((resolve) =>
        setTimeout(resolve, delays[attempt])
      );

      continue;
    }

    throw new Error(`Gemini API ${response.status}: ${errorText}`);
  }

  throw new Error('Gemini API failed after retries.');
}
async function extractAwardWithAI({ html, pageTitle, wikiUrl }) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not set.');
  }

  const $ = cheerio.load(html);
  const sourceText = buildSourceText($);

  if (!sourceText) throw new Error('Could not build AI source content from Wikipedia HTML.');

  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
 const response = await callGeminiWithRetry(
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': process.env.GEMINI_API_KEY
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: SYSTEM_PROMPT }]
      },
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `Wikipedia URL: ${wikiUrl}
Wikipedia page title: ${pageTitle}

SOURCE CONTENT:
${sourceText}`
            }
          ]
        }
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: toGeminiSchema(schema)
      }
    })
  }
);

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Gemini API ${response.status}: ${body.slice(0, 1200)}`);
  }

  const data = await response.json();
  return JSON.parse(getResponseText(data));
}

module.exports = { extractAwardWithAI };