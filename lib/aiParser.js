const cheerio = require('cheerio');

const MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const MAX_SOURCE_CHARS = 60000;
const MAX_PROMPT_SOURCE_CHARS = 20000;

const SYSTEM_PROMPT = `
You are an award-data extraction engine. Extract ONLY information explicitly supported by the provided Wikipedia source.

The output is for a Strapi award collection.

CORE RULES:
1. Extract real award result categories only.
2. Never turn Wikipedia biography/infobox fields into award categories.
3. Occupations such as Actor, Actress, Director, Producer, Singer, Choreographer, Screenwriter, Cinematographer and Music Director are NOT award categories and are NOT winnerSubTitle values.
4. Prefer actual award-result tables under sections such as Awards, Winners, Results, Winners and nominees, Recipients, Honorees, Previous winners and Past recipients.
5. Do not treat unrelated tables as award results.
6. Preserve the relationship between year, category, winner, nominee and film/show/song.
7. If a table is Year | Recipient for a special/lifetime/honour award, use the page/award name as categoryName and put the year in the category item's year field.
8. Never make the year the categoryName.
9. winnerTitle is the actual winner/recipient. winnerSubTitle is only directly associated context such as a film, show or song. Never use occupation as winnerSubTitle.
10. Only mark something as a winner when the source explicitly identifies it as winner, won, recipient, awarded to, honoree or equivalent.
11. Do not invent nominees, winners, years, descriptions or contextual information.
12. categoryDescription must be copied/paraphrased only from meaningful source information. If unavailable, return an empty string.
13. Remove citation markers and formatting artifacts.
14. If the same category occurs for multiple years, keep separate result records when each record has a distinct year/winner.
15. For multiple winners in one category, preserve all winner names in winnerTitle rather than creating fake categories.
16. Return only JSON matching the supplied schema. No markdown or explanation.

SPECIAL EXAMPLE:
If the page is an award such as "IIFA Lifetime Achievement Award" and its result table is:
Year | Recipient | Occupation
2025 | Rakesh Roshan | Director
2024 | Hema Malini | Actress
then output two records:
categoryName = IIFA Lifetime Achievement Award
winnerTitle = Rakesh Roshan / Hema Malini
year = 2025 / 2024
winnerSubTitle = empty string
Occupation must be ignored.

QUALITY CHECK BEFORE OUTPUT:
- Every awardCategories item is a real award result.
- No occupation is a category.
- No occupation is a subtitle.
- Year is attached to the correct result.
- Winners are not confused with nominees.
- No generic AI descriptions.
- No invented facts.
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
        required: [
          'categoryName',
          'categoryDescription',
          'year',
          'winnerTitle',
          'winnerSubTitle',
          'nominees'
        ]
      }
    }
  },
  required: [
    'title',
    'description',
    'date',
    'location',
    'year',
    'host',
    'totalNominations',
    'countriesRepresented',
    'awardCategories'
  ]
};

function clean(value) {
  return String(value || '')
    .replace(/\\[\\d+\\]/g, '')
    .replace(/\\[citation needed\\]/gi, '')
    .replace(/\\u00a0/g, ' ')
    .replace(/\\s+/g, ' ')
    .trim();
}

function buildTableText($) {
  const tables = [];

  $('table.wikitable').each((index, table) => {
    const rows = [];

    $(table).find('tr').each((_, row) => {
      const cells = $(row)
        .children('th,td')
        .map((__, cell) => clean($(cell).text()))
        .get()
        .filter(Boolean);

      if (cells.length) rows.push(cells.join(' | '));
    });

    if (rows.length) {
      tables.push(`TABLE ${index + 1}:\\n${rows.join('\\n')}`);
    }
  });

  return tables.join('\\n\\n');
}

function buildRelevantParagraphs($) {
  const paragraphs = [];
  const keywords = /award|winner|recipient|honouree|honoree|nominee|presented|achievement|ceremony|results/i;

  $('p').each((_, p) => {
    const text = clean($(p).text());
    if (text && keywords.test(text)) paragraphs.push(text);
  });

  return paragraphs.slice(0, 80).join('\\n');
}

function buildSourceText($, pageTitle) {
  const headings = [];

  $('h1,h2,h3,h4,h5,h6').each((_, el) => {
    const text = clean($(el).text());
    if (text) headings.push(text);
  });

  const tables = buildTableText($);
  const paragraphs = buildRelevantParagraphs($);

  const source = [
    `PAGE TITLE: ${clean(pageTitle)}`,
    `HEADINGS:\\n${headings.join('\\n')}`,
    `AWARD TABLES:\\n${tables}`,
    `RELEVANT ARTICLE TEXT:\\n${paragraphs}`
  ].join('\\n\\n');

  return source.slice(0, MAX_SOURCE_CHARS);
}

function toGeminiSchema(value) {
  if (Array.isArray(value)) return value.map(toGeminiSchema);
  if (!value || typeof value !== 'object') return value;

  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === 'additionalProperties') continue;
    result[key] = toGeminiSchema(child);
  }
  return result;
}

function normalizeResult(data) {
  const result = data && typeof data === 'object' ? data : {};

  const stringValue = (value) => {
    if (value === null || value === undefined) return '';
    const text = String(value).trim();
    if (!text || text.toLowerCase() === 'null' || text.toLowerCase() === 'undefined') return '';
    return text;
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
          ? item.nominees
              .map((nominee) => ({
                name: stringValue(nominee?.name),
                subTitle: stringValue(nominee?.subTitle)
              }))
              .filter((nominee) => nominee.name)
          : []
      }))
    : [];

  // Final deterministic protection against common occupation mistakes.
  const occupations = new Set([
    'actor',
    'actress',
    'director',
    'producer',
    'singer',
    'choreographer',
    'screenwriter',
    'lyricist',
    'cinematographer',
    'music director',
    'composer',
    'writer'
  ]);

  result.awardCategories = result.awardCategories.filter((item) => {
    return item.categoryName && !occupations.has(item.categoryName.toLowerCase());
  });

  for (const item of result.awardCategories) {
    if (occupations.has(item.winnerSubTitle.toLowerCase())) {
      item.winnerSubTitle = '';
    }
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
      console.log(
        `   ⏳ Gemini returned ${response.status}. Retrying in ${delays[attempt] / 1000}s...`
      );
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
      continue;
    }

    throw new Error(`Gemini API ${response.status}: ${errorText.slice(0, 1500)}`);
  }

  throw new Error('Gemini API failed after retries.');
}

async function extractAwardWithAI({ html, pageTitle, wikiUrl }) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not set.');
  }

  const $ = cheerio.load(html);
  const sourceText = buildSourceText($, pageTitle).slice(0, MAX_PROMPT_SOURCE_CHARS);

  if (!sourceText) {
    throw new Error('Could not build AI source content from Wikipedia HTML.');
  }

  console.log(`   📦 AI source size: ${sourceText.length.toLocaleString()} characters`);
  console.log(`   🧠 Gemini model: ${MODEL}`);

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

  const requestBody = {
    systemInstruction: {
      parts: [{ text: SYSTEM_PROMPT }]
    },
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: `Wikipedia URL: ${wikiUrl}\n\n${sourceText}`
          }
        ]
      }
    ],
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
  const text = data?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || '')
    .join('')
    .trim();

  if (!text) {
    throw new Error('Gemini returned no text output.');
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`Gemini returned invalid JSON: ${text.slice(0, 1000)}`);
  }

  return normalizeResult(parsed);
}

module.exports = { extractAwardWithAI };
