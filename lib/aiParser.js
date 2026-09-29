const cheerio = require('cheerio');

const MODEL = 'gemini-3.5-flash-lite';
const MAX_SOURCE_CHARS = 60000;
const MAX_PROMPT_SOURCE_CHARS = 60000;

const SYSTEM_PROMPT = `
You are a STRICT Wikipedia award-result extraction engine.

Your job is NOT to summarize the page and NOT to use outside knowledge.
You must convert the supplied Wikipedia evidence into award result records.

NON-NEGOTIABLE RULES:
1. Use ONLY the supplied source evidence. Never guess, infer, autocomplete, or use model knowledge.
2. Extract ONLY actual award-result categories from the "Winners and nominees", "Awards", "Results", "Recipients", "Honorees", "Past recipients", or equivalent result sections.
3. Ignore infobox fields, highlights, ceremony details, presenters, ambassadors, ratings, network, "most awards", "most nominations", and unrelated nomination/win summary tables.
4. A table can have a parent award category followed by column labels such as Actor/Actress, Drama/Musical or Comedy, Supporting Actor/Supporting Actress, etc. Those column labels are ROLE/DIMENSION labels, NOT categoryName values.
5. When a table has a parent category plus multiple result columns, preserve the parent category and represent all actual winners. Do NOT create categories named Actor, Actress, Supporting Actor, Drama, etc.
6. The source may use [WINNER]...[/WINNER]. This is authoritative evidence of the winner. Unmarked people/items in that same result group are nominees.
7. If the source does NOT explicitly identify a winner, leave winnerTitle and winnerSubTitle empty. Never choose the first nominee just because it appears first.
8. winnerTitle = actual winning person, film, series, song, etc. winnerSubTitle = directly associated work/title only (for example person -> film/show, song -> film). Never use occupation or role labels as winnerSubTitle.
9. For special/lifetime/honorary tables such as Year | Recipient | Occupation, use the award name as categoryName, recipient as winnerTitle, year as the result year, and IGNORE Occupation.
10. Never make Year, Actor, Actress, Director, Producer, Singer, Choreographer, Screenwriter, Cinematographer, Music Director, Host, Location, Network, Nationality, Born, Website, etc. into award categories.
11. Keep separate result records when distinct categories or distinct years are explicitly present.
12. Do not invent nominees, winners, descriptions, years, dates, locations, hosts, nomination counts, or countries.
13. categoryDescription must be source-grounded. If the source does not provide useful category-specific descriptive text, return "".
14. Extract the COMPLETE result section. Do not stop after the first few categories. Include film, television, special and honorary results when present.
15. For multiple winners in one actual category, keep all winners in winnerTitle using " / " between names. Keep corresponding works in winnerSubTitle using " / " when applicable.
16. Return only valid JSON matching the schema.

CRITICAL INTERPRETATION EXAMPLE:
If evidence says:
CATEGORY: Best Performance in a Motion Picture – Drama
COLUMN HEADERS: Actor | Actress
COLUMN 1: [WINNER] Joaquin Phoenix – Joker [/WINNER], Christian Bale – Ford v Ferrari, ...
COLUMN 2: [WINNER] Renée Zellweger – Judy [/WINNER], Cynthia Erivo – Harriet, ...
Then output ONE result record:
categoryName = "Best Performance in a Motion Picture – Drama"
winnerTitle = "Joaquin Phoenix / Renée Zellweger"
winnerSubTitle = "Joker / Judy"
Do NOT output Actor or Actress as categories or winners.

QUALITY GATE BEFORE RETURNING:
- Would every categoryName make sense if read as an award title?
- Is every winner explicitly supported by [WINNER] or equivalent source wording?
- Are column headers excluded from winners?
- Are occupation labels excluded?
- Are unsupported fields empty?
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
