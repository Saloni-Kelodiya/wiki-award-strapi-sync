const cheerio = require('cheerio');

const { getWikipediaTitle, fetchSummary, fetchHtml, fetchPageImageUrl } = require('./wikipedia');
const { cleanText, parseInfobox, parseCategories } = require('./parser');
const { extractAwardWithAI } = require('./aiParser');
const config = require('../config');

function detectIndustry(title, url) {
  const text = `${title} ${url}`.toLowerCase().replace(/_/g, ' ');
  for (const rule of config.INDUSTRY_MAP) {
    if (rule.keywords.some((k) => text.includes(k))) {
      return rule.categoryId;
    }
  }
  return config.DEFAULT_CATEGORY_ID;
}

// Looks up a value in the infobox object by trying several possible
// label patterns, since Wikipedia infoboxes don't use identical labels
// across every award show (e.g. "Site" vs "Location" vs "Venue", or
// "Date" vs "Announced on" vs "Presented on").
function findInfoboxValue(infobox, patterns) {
  const entries = Object.entries(infobox);

  for (const pattern of patterns) {
    const re = new RegExp(`^${pattern}$`, 'i');
    const hit = entries.find(([key]) => re.test(key.trim()));
    if (hit) return hit[1];
  }
  return '';
}

function extractYear(title, dateStr) {
  const fromTitle = title.match(/(\d{4})/);
  if (fromTitle) return fromTitle[1];
  const fromDate = (dateStr || '').match(/(\d{4})/);
  return fromDate ? fromDate[1] : '';
}

function tryParseDate(str) {
  if (!str) return null;

  const value = String(str).trim();

  // Wikipedia often gives a date without a timezone. Parsing it as local
  // midnight and then converting to UTC can move it to the previous day.
  // Parse date-only values in UTC so "January 5, 2020" stays 2020-01-05.
  const dateOnly = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  const parsed = new Date(value.includes('T') ? value : `${value} UTC`);
  return isNaN(parsed.getTime()) ? null : parsed.toISOString().split('T')[0];
}

function mergeAwardCategories(aiCategories, deterministicCategories) {
  const merged = [];
  const byName = new Map();

  const normalizeName = (value) =>
    String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();

  for (const aiCat of aiCategories || []) {
    if (!aiCat?.categoryName) continue;
    const item = {
      ...aiCat,
      nominees: Array.isArray(aiCat.nominees) ? aiCat.nominees : [],
    };
    byName.set(normalizeName(item.categoryName), item);
    merged.push(item);
  }

  for (const detCat of deterministicCategories || []) {
    if (!detCat?.categoryName) continue;

    const key = normalizeName(detCat.categoryName);
    const existing = byName.get(key);

    if (!existing) {
      const item = {
        ...detCat,
        nominees: Array.isArray(detCat.nominees) ? detCat.nominees : [],
      };
      byName.set(key, item);
      merged.push(item);
      continue;
    }

    // AI remains the primary extractor. Deterministic parsing only fills
    // fields that AI could not confidently extract.
    if (!existing.winnerTitle && detCat.winnerTitle) {
      existing.winnerTitle = detCat.winnerTitle;
    }
    if (!existing.winnerSubTitle && detCat.winnerSubTitle) {
      existing.winnerSubTitle = detCat.winnerSubTitle;
    }
    if (!existing.nominees?.length && detCat.nominees?.length) {
      existing.nominees = detCat.nominees;
    }
  }

  return merged;
}

function toBlocks(text) {
  return [
    {
      type: 'paragraph',
      children: [{ type: 'text', text: text || '' }]
    }
  ];
}

// Strapi's default "string" field type enforces a 255-character limit.
function truncate(str, maxLen = 255) {
  if (!str) return str;
  return str.length > maxLen ? `${str.slice(0, maxLen - 1)}…` : str;
}

// Cuts text to roughly maxLen characters without chopping a word/sentence
// in half.
function smartTruncate(text, maxLen) {
  if (!text) return '';
  if (text.length <= maxLen) return text;

  const cut = text.slice(0, maxLen);
  const lastSentenceEnd = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.\n'));
  if (lastSentenceEnd > maxLen * 0.4) {
    return cut.slice(0, lastSentenceEnd + 1);
  }
  const lastSpace = cut.lastIndexOf(' ');
  return lastSpace > 0 ? `${cut.slice(0, lastSpace)}…` : `${cut}…`;
}

// Reads real article paragraphs (not just the short API summary extract)
// for a fuller description.
function getIntroText($, maxLen) {
  let combined = '';
  $('p').each((i, el) => {
    if (combined.length >= maxLen) return false;
    const t = cleanText($(el).text());
    if (t) combined += (combined ? ' ' : '') + t;
  });
  return smartTruncate(combined, maxLen);
}

// Falls back to the first image inside the page's infobox if the
// Wikipedia summary API didn't return a thumbnail.
function getInfoboxImageUrl($) {
  const src = $('table.infobox img').first().attr('src');
  if (!src) return null;
  return src.startsWith('//') ? `https:${src}` : src;
}

function slugify(text) {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// winnerTitle can be "Person A & Person B" for tied/shared awards — the
// Strapi schema only has room for ONE winnerImage, so for image lookup
// purposes we use just the first name.
function firstNameForLookup(title) {
  return (title || '').split(' & ')[0].trim();
}

/**
 * Fetches a Wikipedia award-show page and builds the exact Strapi
 * "awards" payload. When config.FETCH_WINNER_IMAGES / FETCH_NOMINEE_IMAGES
 * are enabled, also looks up a photo for each winner/nominee by name via
 * Wikipedia's pageimages API and attaches it as a temporary `_imageUrl` /
 * `_winnerImageUrl` field — index.js is responsible for uploading those
 * to Strapi and stripping the temp fields before the actual create call
 * (Strapi would reject unknown fields otherwise).
 *
 * No Strapi connection is touched here at all.
 */
async function buildPayload(wikiUrl) {
  const warnings = [];

  const pageTitle = await getWikipediaTitle(wikiUrl);
  const summary = await fetchSummary(pageTitle);
  const html = await fetchHtml(pageTitle);
  const $ = cheerio.load(html);

  const infobox = parseInfobox($);

  let aiData = null;
  try {
    console.log('   🤖 AI is analyzing the fetched Wikipedia data...');
    aiData = await extractAwardWithAI({ html, pageTitle, wikiUrl });
    console.log(`   🤖 AI extracted ${aiData.awardCategories?.length || 0} award result categories.`);
  } catch (err) {
    warnings.push(`AI extraction failed: ${err.message}`);
    console.warn(`   ⚠️  AI extraction failed; falling back to structured parser: ${err.message}`);
  }

  const deterministicCategories = parseCategories($);
  const aiCategories = aiData?.awardCategories || [];
  const categories = aiCategories.length
    ? mergeAwardCategories(aiCategories, deterministicCategories)
    : deterministicCategories;

  if (categories.length === 0) {
    warnings.push('No categories auto-detected. This page\'s table layout may differ — you will need to add awardCategories manually.');
  }

  const categoryId = detectIndustry(pageTitle, wikiUrl);
  if (categoryId === null) {
    warnings.push('Could not auto-detect industry category. Set industry_category manually, or add a keyword rule in config.js.');
  }

  const dateStr = findInfoboxValue(infobox, ['date', 'announced on', 'presented on']) || aiData?.date;
  const location = findInfoboxValue(infobox, ['site', 'location', 'venue', 'city']) || aiData?.location;
  const host = findInfoboxValue(infobox, ['hosted by', 'host(s)?', 'presenter']) || aiData?.host;
  const totalNominations = findInfoboxValue(infobox, ['total nominations', 'nominations']) || aiData?.totalNominations;
  const countriesRepresented = findInfoboxValue(infobox, ['countries represented', 'countries']) || aiData?.countriesRepresented;

  const imageUrl = summary.thumbnail?.source || getInfoboxImageUrl($);
  if (!imageUrl) {
    warnings.push('No poster image found on this page (no summary thumbnail or infobox image) — image field will be empty.');
  }
  if (!dateStr) warnings.push('Could not find a "Date" field in the infobox.');
  if (!location) warnings.push('Could not find a Site/Location field in the infobox.');
  if (!totalNominations) warnings.push('No "total nominations" figure found on this page (common — Wikipedia often doesn\'t list this).');
  if (!countriesRepresented) warnings.push('No "countries represented" figure found on this page (common — Wikipedia often doesn\'t list this).');

  const fetchImages = config.FETCH_WINNER_IMAGES || config.FETCH_NOMINEE_IMAGES;
  if (fetchImages) {
    warnings.push('Per-winner/nominee image lookup is ON — this makes one extra Wikipedia request per name and will be noticeably slower.');
  }

  const awardCategories = [];
  for (const cat of categories) {
    let winnerImageUrl = null;
    if (config.FETCH_WINNER_IMAGES && cat.winnerTitle) {
      winnerImageUrl = await fetchPageImageUrl(firstNameForLookup(cat.winnerTitle));
    }

    const nomineesListProcessed = [];
    if (config.INCLUDE_NOMINEES) {
      for (const n of cat.NomineesList || cat.nominees || []) {
        let nomineeImageUrl = null;
        if (config.FETCH_NOMINEE_IMAGES && n.name) {
          nomineeImageUrl = await fetchPageImageUrl(n.name);
        }
        nomineesListProcessed.push({
          Name: truncate(n.name || n.Name || ''),
          SubTitle: truncate(n.subTitle || n.SubTitle || ''),
          Image: [],
          ...(nomineeImageUrl ? { _imageUrl: nomineeImageUrl } : {})
        });
      }
    }

    awardCategories.push({
      categoryName: truncate(cat.categoryName),
      categoryDescription: truncate(cat.categoryDescription || ''),
      winnerTitle: truncate(cat.winnerTitle || ''),
      winnerSubTitle: truncate(cat.winnerSubTitle || ''),
      winnerImage: null,
      ...(winnerImageUrl ? { _winnerImageUrl: winnerImageUrl } : {}),
      ...(config.INCLUDE_NOMINEES ? { NomineesList: nomineesListProcessed } : {})
    });
  }

  const title = pageTitle.replace(/_/g, ' ');
  const description = aiData?.description || getIntroText($, config.DESCRIPTION_MAX_LENGTH) || cleanText(summary.extract || '');

  const payload = {
    title: truncate(title),
    slug: slugify(title),
    image: null, // filled in with a real media id by index.js after uploading
    description: toBlocks(smartTruncate(description, config.DESCRIPTION_MAX_LENGTH)),
    date: tryParseDate(dateStr),
    location: truncate(location),
    year: aiData?.year || extractYear(pageTitle, dateStr),
    host: truncate(host),
    categories: String(awardCategories.length),
    totalNominations: truncate(totalNominations),
    countriesRepresented: truncate(countriesRepresented),
    industry_category: categoryId,
    // We only ever read from en.wikipedia.org, so the scraped content is
    // always English, regardless of industry.
    language: 'en',
    awardCategories
  };

  return { payload, warnings, imageUrl, pageTitle, categoryCount: awardCategories.length };
}

module.exports = { buildPayload };
