require('dotenv').config();

module.exports = {
  STRAPI_URL: (process.env.STRAPI_URL || 'http://localhost:1337').replace(/\/$/, ''),
  STRAPI_TOKEN: process.env.STRAPI_TOKEN || '',

  // ---------------------------------------------------------------------
  // EDIT THIS: map keywords (found in the award-show title/URL) to the
  // `id` of the matching entry in your Strapi `category` collection, and
  // to the `language` enum value ("en" or "hi").
  //
  // Find your category IDs in the Strapi admin panel:
  //   Content Manager -> Category -> click an entry -> check the URL
  //   (e.g. .../content-manager/collectionType/api::category.category/5)
  //   -> the number at the end is the id.
  // ---------------------------------------------------------------------
  // NOTE: order matters — the FIRST matching rule wins, so more specific
  // industries (Tollywood, Bhojiwood) are listed before generic ones that
  // could otherwise false-match (e.g. "film award" appearing everywhere).
  INDUSTRY_MAP: [
    // Bhojiwood (Bhojpuri film industry)
    { keywords: ['bhojpuri', 'bhojiwood'], categoryId: 22, language: 'hi' },

    // Tollywood (Telugu film industry)
    { keywords: ['tollywood', 'telugu film', 'siima', 'nandi award', 'filmfare awards south'], categoryId: 21, language: 'hi' },

    // Bollywood (Hindi film industry)
    { keywords: ['filmfare', 'iifa', 'bollywood', 'national film award', 'zee cine', 'stardust', 'hindi film'], categoryId: 8, language: 'hi' },

    // Hollywood
    { keywords: ['oscar', 'academy award', 'golden globe', 'bafta', 'sag award', 'critics choice', 'hollywood'], categoryId: 9, language: 'en' },

    // TV (television awards, not tied to a specific streaming platform)
    { keywords: ['emmy', 'television award', 'indian television academy', 'itaa award', 'star parivaar'], categoryId: 11, language: 'en' },

    // OTT / streaming platforms
    { keywords: ['ott', 'streaming', 'netflix', 'amazon prime', 'hotstar', 'web series award'], categoryId: 10, language: 'en' },

    // Korean (K-Drama / K-Pop)
    { keywords: ['korean', 'k-drama', 'kdrama', 'baeksang', 'k-pop'], categoryId: 26, language: 'en' }
  ],

  // Used when nothing in INDUSTRY_MAP matches. Set DEFAULT_CATEGORY_ID to
  // null to leave the relation empty (you can fill it manually in Strapi
  // admin afterwards), or set it to a real category id.
  DEFAULT_CATEGORY_ID: null,
  DEFAULT_LANGUAGE: 'en',

  // How many nominee/winner sub-images to fetch from their own Wikipedia
  // pages. Each ON toggle adds one extra Wikipedia lookup PER NAME, so a
  // page with 50 categories × 5 nominees could mean 250+ extra requests —
  // expect the script to run noticeably slower (potentially several
  // minutes) with these on. Turn either back to false if it's too slow.
  FETCH_WINNER_IMAGES: true,
  FETCH_NOMINEE_IMAGES: true,

  // Set to false to omit the NomineesList field entirely when creating
  // entries. Useful as a temporary workaround/diagnostic if your Strapi
  // instance rejects the nested NomineesList component.
  INCLUDE_NOMINEES: true,

  // Roughly how many characters the "description" field should be. The
  // script reads real article paragraphs (not just the short API summary)
  // and trims to this length at a sentence/word boundary.
  DESCRIPTION_MAX_LENGTH: 400
};
