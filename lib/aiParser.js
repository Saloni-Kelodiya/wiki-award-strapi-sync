const cheerio = require('cheerio');

const MODEL = 'gemini-3.5-flash-lite';
const MAX_SOURCE_CHARS = 60000;
const MAX_PROMPT_SOURCE_CHARS = 60000;

const SYSTEM_PROMPT = `
You are an award-data normalization engine.

CORE RULE:
The SOURCE FORMAT can be anything: infoboxes, paragraphs, lists, simple tables, multi-column tables, Year/Recipient tables, winner-marked tables, or mixed layouts.
The OUTPUT FORMAT is ALWAYS FIXED.
Your job is to understand the meaning of the source evidence and transform it into the exact JSON schema below. Never copy the source layout into the output.

SOURCE-ONLY RULES:
1. Use ONLY the supplied source evidence. Never use outside knowledge, guessing, assumptions, or autocomplete.
2. Identify actual award RESULT categories and recipients/winners. Ignore unrelated page metadata and summary information.
3. Never treat these as categories by themselves: Year, Actor, Actress, Director, Producer, Singer, Choreographer, Screenwriter, Lyricist, Cinematographer, Music Director, Supporting Actor, Supporting Actress, Drama, Musical or Comedy, Network, Location, Host, Nationality, Born, Website, presenters, ambassadors, ratings, "most awards", "most nominations", etc.
4. If a table has a parent category plus columns such as Actor | Actress or Drama | Musical or Comedy, the parent is the categoryName. The column labels are dimensions/roles. Combine the actual winners from those columns into ONE result record for that parent category.
5. Winner evidence has priority. [WINNER]...[/WINNER] is explicit winner evidence. Also accept an explicitly written source label such as "Winner:", "Winners:", "Recipient:", "Awarded to:", or an equivalent clear winner marker.
6. Do NOT assume the first listed person is the winner. If no explicit winner evidence exists, winnerTitle and winnerSubTitle must be "".
7. winnerTitle contains the actual winning person, film, series, song, organization, etc.
8. winnerSubTitle contains only the directly associated work/title when the source explicitly connects one: person -> film/show, song -> film, etc. Never put occupations, roles, column headers, or years there.
9. For Year | Recipient | Occupation or similar special/lifetime/honorary tables: use the award's actual name as categoryName; recipient becomes winnerTitle; the row year becomes the category item's year; ignore Occupation entirely.
10. Preserve distinct categories and distinct year-specific results when the source explicitly distinguishes them.
11. Multiple winners in the SAME category are one result record. Join winners with " / ". Join corresponding works with " / " in the same order when applicable.
12. Nominees must be source-supported only. Do not invent or infer nominees.
13. categoryDescription must contain only useful, category-specific information explicitly supported by the source. If none exists, use "".
14. Extract the COMPLETE award-result material available in the supplied evidence. Do not stop after the first few categories.
15. Do not invent title, description, date, location, year, host, nomination count, country count, winners, nominees, or descriptions. Unsupported values must be "".
16. Before returning JSON, validate every categoryName: it must represent an actual award/result category, not a table dimension, occupation, metadata field, or generic column header.

FIXED OUTPUT CONTRACT:
Return ONLY valid JSON with exactly this top-level structure:
{
  "title": "",
  "description": "",
  "date": "",
  "location": "",
  "year": "",
  "host": "",
  "totalNominations": "",
  "countriesRepresented": "",
  "awardCategories": [
    {
      "categoryName": "",
      "categoryDescription": "",
      "year": "",
      "winnerTitle": "",
      "winnerSubTitle": "",
      "nominees": [
        {
          "name": "",
          "subTitle": ""
        }
      ]
    }
  ]
}

IMPORTANT NORMALIZATION EXAMPLES:

Example A:
SOURCE:
Category: Best Performance in a Motion Picture – Drama
Actor | Actress
[WINNER] Joaquin Phoenix – Joker [/WINNER] | [WINNER] Renée Zellweger – Judy [/WINNER]
OUTPUT:
{
  "categoryName": "Best Performance in a Motion Picture – Drama",
  "categoryDescription": "",
  "year": "",
  "winnerTitle": "Joaquin Phoenix / Renée Zellweger",
  "winnerSubTitle": "Joker / Judy",
  "nominees": []
}
Do NOT create Actor or Actress categories.

Example B:
SOURCE:
Year | Recipient | Occupation
2020 | Tom Hanks | Actor
2021 | Jane Doe | Director
OUTPUT:
[
  {
    "categoryName": "Cecil B. DeMille Award",
    "categoryDescription": "",
    "year": "2020",
    "winnerTitle": "Tom Hanks",
    "winnerSubTitle": "",
    "nominees": []
  },
  {
    "categoryName": "Cecil B. DeMille Award",
    "categoryDescription": "",
    "year": "2021",
    "winnerTitle": "Jane Doe",
    "winnerSubTitle": "",
    "nominees": []
  }
]
Occupation is ignored. Use the actual award name supplied by the source, not the example name if the source uses another award.

Example C:
SOURCE:
Best Actor | Joaquin Phoenix | Joker
Best Actress | Renée Zellweger | Judy
OUTPUT:
Two records with categoryName "Best Actor" and "Best Actress", because those are actual award categories in this source format.

Example D:
SOURCE:
Best Actor
Joaquin Phoenix
Leonardo DiCaprio
Adam Driver
(no winner marker or winner wording)
OUTPUT:
winnerTitle = "", winnerSubTitle = "".
Do not guess Joaquin Phoenix.

QUALITY CHECK:
- Every categoryName is an actual award/result category.
- No role/occupation/header became a category.
- No role/occupation/header became a winner.
- Every winner is explicitly supported.
- Source relationships are preserved.
- Output is only the fixed JSON structure.
`;

const schema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string' },
    description: { type: 'string' },
    date: { type: 'string' },
    location: { type: 'string' },
    year: { type: 'string' },
    host: { type: 'string' },
    totalNominations: { type: 'string' },
    countriesRepresented: { type: 'string' },
    awardCategories: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          categoryName: { type: 'string' },
          categoryDescription: { type: 'string' },
          year: { type: 'string' },
          winnerTitle: { type: 'string' },
          winnerSubTitle: { type: 'string' },
          nominees: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string' },
                subTitle: { type: 'string' }
              },
              required: ['name', 'subTitle']
            }
          }
        },
        required: ['categoryName', 'categoryDescription', 'year', 'winnerTitle', 'winnerSubTitle', 'nominees']
      }
    }
  },
  required: ['title', 'description', 'date', 'location', 'year', 'host', 'totalNominations', 'countriesRepresented', 'awardCategories']
};

function clean(value) {
  return String(value || '')
    .replace(/\[\d+\]/g, '')
    .replace(/\[citation needed\]/gi, '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cellTextWithWinnerMarker($, cell) {
  const clone = $(cell).clone();

  clone.find('b, strong').each((_, el) => {
    const text = clean($(el).text());
    if (!text) return;
    $(el).replaceWith(` [WINNER] ${text} [/WINNER] `);
  });

  clone.find('br').replaceWith(' ');
  return clean(clone.text());
}

function buildTableText($, table) {
  const rows = [];

  $(table).find('tr').each((_, row) => {
    const cells = $(row).children('th,td').map((__, cell) => cellTextWithWinnerMarker($, cell)).get().filter(Boolean);
    if (cells.length) rows.push(cells.join(' || '));
  });

  return rows.join('\n');
}

function buildAwardTables($) {
  const tables = [];

  $('table.wikitable').each((index, table) => {
    const text = buildTableText($, table);
    if (!text) return;

    const nearbyHeading = $(table).prevAll('h3,h4,h5').first();
    const heading = nearbyHeading.length ? clean(nearbyHeading.text()) : '';

    tables.push(`TABLE ${index + 1}${heading ? ` [SECTION: ${heading}]` : ''}:\n${text}`);
  });

  return tables.join('\n\n');
}

function buildWinnersSectionText($) {
  const parts = [];
  const winnersHeading = $('h2').filter((_, el) =>
    clean($(el).text()).toLowerCase().includes('winners and nominees')
  ).first();

  if (!winnersHeading.length) return '';

  let node = winnersHeading.next();
  while (node && node.length) {
    if (node.is('h2')) break;

    if (node.is('h3,h4,h5')) {
      const heading = clean(node.text());
      if (heading) parts.push(`SECTION: ${heading}`);
    } else if (node.is('table.wikitable')) {
      const text = buildTableText($, node);
      if (text) parts.push(`RESULT TABLE:\n${text}`);
    } else if (node.is('p,ul,ol')) {
      const text = clean(node.text());
      if (text) parts.push(text);
    }

    node = node.next();
  }

  return parts.join('\n\n');
}

function buildRelevantParagraphs($) {
  const paragraphs = [];
  const keywords = /award|winner|recipient|honouree|honoree|nominee|presented|achievement|ceremony|results/i;

  $('p').each((_, p) => {
    const text = clean($(p).text());
    if (text && keywords.test(text)) paragraphs.push(text);
  });

  return paragraphs.slice(0, 80).join('\n');
}

function buildSourceText($, pageTitle) {
  const headings = [];

  $('h1,h2,h3,h4,h5,h6').each((_, el) => {
    const text = clean($(el).text());
    if (text) headings.push(text);
  });

  const winnersSection = buildWinnersSectionText($);
  const tables = buildAwardTables($);
  const paragraphs = buildRelevantParagraphs($);

  const source = [
    `PAGE TITLE: ${clean(pageTitle)}`,
    `HEADINGS:\n${headings.join('\n')}`,
    `WINNERS AND NOMINEES SECTION:\n${winnersSection}`,
    `AWARD TABLES:\n${tables}`,
    `RELEVANT ARTICLE TEXT:\n${paragraphs}`
  ].join('\n\n');

  return source.slice(0, MAX_SOURCE_CHARS);
}

function normalizeResult(data) {
  const result = data && typeof data === 'object' ? data : {};
  const stringValue = (value) => {
    if (value === null || value === undefined) return '';
    const text = String(value).trim();
    return !text || /^(null|undefined)$/i.test(text) ? '' : text;
  };

  result.title = stringValue(result.title);
  result.description = stringValue(result.description);
  result.date = stringValue(result.date);
  result.location = stringValue(result.location);
  result.year = stringValue(result.year);
  result.host = stringValue(result.host);
  result.totalNominations = stringValue(result.totalNominations);
  result.countriesRepresented = stringValue(result.countriesRepresented);

  result.awardCategories = Array.isArray(result.awardCategories)
    ? result.awardCategories.map((item) => ({
        categoryName: stringValue(item?.categoryName),
        categoryDescription: stringValue(item?.categoryDescription),
        year: stringValue(item?.year),
        winnerTitle: stringValue(item?.winnerTitle),
        winnerSubTitle: stringValue(item?.winnerSubTitle),
        nominees: Array.isArray(item?.nominees)
          ? item.nominees.map((n) => ({
              name: stringValue(n?.name),
              subTitle: stringValue(n?.subTitle)
            })).filter((n) => n.name)
          : []
      }))
    : [];

  const invalidExact = new Set([
    'actor','actress','director','producer','singer','choreographer',
    'screenwriter','lyricist','cinematographer','music director',
    'composer','writer','supporting actor','supporting actress',
    'drama','musical or comedy','miniseries or television film'
  ]);

  result.awardCategories = result.awardCategories.filter((item) =>
    item.categoryName && !invalidExact.has(item.categoryName.toLowerCase())
  );

  for (const item of result.awardCategories) {
    if (invalidExact.has(item.winnerTitle.toLowerCase())) item.winnerTitle = '';
    if (invalidExact.has(item.winnerSubTitle.toLowerCase())) item.winnerSubTitle = '';
  }

  return result;
}

async function callGemini(url, options, maxRetries = 3) {
  const delays = [3000, 7000, 15000];

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, options);
    if (response.ok) return response;

    const errorText = await response.text();

    if ([429, 500, 502, 503, 504].includes(response.status) && attempt < maxRetries) {
      console.log(`   ⏳ Gemini returned ${response.status}. Retrying in ${delays[attempt] / 1000}s...`);
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
      continue;
    }

    throw new Error(`Gemini API ${response.status}: ${errorText.slice(0, 1500)}`);
  }

  throw new Error('Gemini API failed after retries.');
}

async function extractAwardWithAI({ html, pageTitle, wikiUrl }) {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set.');

  const $ = cheerio.load(html);
  const sourceText = buildSourceText($, pageTitle).slice(0, MAX_PROMPT_SOURCE_CHARS);

  if (!sourceText) throw new Error('Could not build AI source content from Wikipedia HTML.');

  console.log(`   📦 AI source size: ${sourceText.length.toLocaleString()} characters`);
  console.log(`   🧠 Gemini model: ${MODEL}`);

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

  const requestBody = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{
      role: 'user',
      parts: [{ text: `Wikipedia URL: ${wikiUrl}\n\nSOURCE EVIDENCE:\n${sourceText}` }]
    }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0
    }
  };

  const response = await callGemini(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': process.env.GEMINI_API_KEY
    },
    body: JSON.stringify(requestBody)
  });

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim();

  if (!text) throw new Error('Gemini returned no text output.');

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Gemini returned invalid JSON: ${text.slice(0, 1000)}`);
  }

  return normalizeResult(parsed);
}

module.exports = { extractAwardWithAI };
