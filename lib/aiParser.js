const cheerio = require('cheerio');

const SYSTEM_PROMPT = `
You are an award-data extraction engine.

Your job is to identify REAL AWARD RESULTS from Wikipedia content and return structured JSON.

CRITICAL RULES:
1. Distinguish award-result tables from infobox metadata and unrelated biography tables.
2. Never treat fields such as Occupation, Born, Nationality, Director, Actor, Actress, Producer, Website, Location, Date, Year, Host, Network, etc. as award categories unless the page explicitly presents them as award-result categories.
3. A year column is usually metadata for a recipient, not a category.
4. Preserve the relationship between year, category, winner/recipient, nominees, movie/show and person.
5. If a page is a lifetime-achievement/honour award and the table is Year | Recipient, create one category named after the award itself and put each recipient under the corresponding year.
6. Do not invent winners, nominees, categories, years, images, or facts that are not present in the supplied content.
7. Prefer explicit table headings/section headings over guesses.
8. If uncertain, leave the field empty rather than inventing it.
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

async function extractAwardWithAI({ html, pageTitle, wikiUrl }) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not set.');
  }

  const $ = cheerio.load(html);
  const sourceText = buildSourceText($);

  if (!sourceText) throw new Error('Could not build AI source content from Wikipedia HTML.');

  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const response = await fetch(
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
            parts: [{
              text: `Wikipedia URL: ${wikiUrl}\nWikipedia page title: ${pageTitle}\n\nSOURCE CONTENT:\n${sourceText}`
            }]
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