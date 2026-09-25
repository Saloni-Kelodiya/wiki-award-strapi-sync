/**
 * Helpers for talking to Wikipedia's public REST API and Action API.
 * No API key required. A descriptive User-Agent is sent on every request,
 * as Wikipedia's API etiquette asks: https://meta.wikimedia.org/wiki/User-Agent_policy
 */

const USER_AGENT = 'WikiAwardStrapiSync/1.0 (personal project; contact via GitHub issues)';

async function fetchWithRetry(url, options, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, options);
    if (res.status !== 429 && res.status < 500) return res;
    if (attempt === retries) return res;
    const waitMs = 1000 * (attempt + 1); // 1s, then 2s
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

function getWikipediaTitle(url) {
  const match = url.match(/\/wiki\/([^#?]+)/);
  if (!match) {
    throw new Error(`Could not extract a page title from URL: ${url}`);
  }
  return decodeURIComponent(match[1]);
}

async function fetchSummary(title) {
  const res = await fetchWithRetry(
    `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
    { headers: { 'User-Agent': USER_AGENT } }
  );
  if (!res.ok) {
    throw new Error(`Wikipedia summary fetch failed (${res.status}) for "${title}"`);
  }
  return res.json();
}

async function fetchHtml(title) {
  const res = await fetchWithRetry(
    `https://en.wikipedia.org/api/rest_v1/page/html/${encodeURIComponent(title)}`,
    { headers: { 'User-Agent': USER_AGENT } }
  );
  if (!res.ok) {
    throw new Error(`Wikipedia HTML fetch failed (${res.status}) for "${title}"`);
  }
  return res.text();
}

// Looks up a Wikipedia page by (approximate) title and returns its lead
// image, using the Action API's pageimages property. Used to find photos
// for individual winners/nominees (people or films) by name. Returns null
// if no matching page or no image is found — this is expected often
// (many nominees won't have a clean 1:1 Wikipedia page title match).
async function fetchPageImageUrl(pageTitleGuess) {
  if (!pageTitleGuess || !pageTitleGuess.trim()) return null;

  try {
    const url = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(
      pageTitleGuess.trim()
    )}&prop=pageimages&format=json&pithumbsize=800&redirects=1&origin=*`;

    const res = await fetchWithRetry(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) return null;

    const data = await res.json();
    const pages = data?.query?.pages;
    if (!pages) return null;

    const pageId = Object.keys(pages)[0];
    if (pageId === '-1') return null; // no matching page

    return pages[pageId]?.thumbnail?.source || null;
  } catch {
    return null;
  }
}

module.exports = { getWikipediaTitle, fetchSummary, fetchHtml, fetchPageImageUrl };
