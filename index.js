require('dotenv').config();

const { buildPayload } = require('./lib/buildPayload');
const { uploadImageFromUrl, createAward } = require('./lib/strapi');
const config = require('./config');

async function run(wikiUrl) {
  if (!config.STRAPI_TOKEN) {
    throw new Error('STRAPI_TOKEN is not set. Copy .env.example to .env and fill it in.');
  }

  console.log(`\n🔍 Fetching: ${wikiUrl}`);

  const { payload, warnings, imageUrl, pageTitle, categoryCount } = await buildPayload(wikiUrl);

  console.log(`   Found ${categoryCount} categor${categoryCount === 1 ? 'y' : 'ies'} on the page.`);

  for (const warning of warnings) {
    console.warn(`   ⚠️  ${warning}`);
  }

  if (categoryCount === 0 || payload.awardCategories.length === 0) {
    throw new Error('No award categories were parsed; refusing to create an empty award entry.');
  }

  console.log('   Uploading main poster image...');
  const mainImageId = await uploadImageFromUrl(
    imageUrl,
    config.STRAPI_URL,
    config.STRAPI_TOKEN,
    `${pageTitle}-poster`
  );
  if (imageUrl && !mainImageId) {
    throw new Error('Main poster upload failed; award was not created. Check the Strapi server log for the upload error.');
  }
  payload.image = mainImageId;

  // Upload any winner/nominee images that buildPayload found (only present
  // when config.FETCH_WINNER_IMAGES / FETCH_NOMINEE_IMAGES are on). These
  // temporary _winnerImageUrl / _imageUrl fields are NOT part of the Strapi
  // schema — they must be uploaded and removed before the create call,
  // otherwise Strapi will reject the request with an "invalid key" error.
  const hasImageLookups = payload.awardCategories.some(
    (c) => c._winnerImageUrl || (c.NomineesList || []).some((n) => n._imageUrl)
  );
  if (hasImageLookups) {
    console.log('   Uploading winner/nominee images (this can take a while)...');
  }

  for (const category of payload.awardCategories) {
    if (category._winnerImageUrl) {
      const winnerImgId = await uploadImageFromUrl(
        category._winnerImageUrl,
        config.STRAPI_URL,
        config.STRAPI_TOKEN,
        `winner-${category.winnerTitle}`
      );
      category.winnerImage = winnerImgId;
    }
    delete category._winnerImageUrl;

    for (const nominee of category.NomineesList || []) {
      if (nominee._imageUrl) {
        const nomineeImgId = await uploadImageFromUrl(
          nominee._imageUrl,
          config.STRAPI_URL,
          config.STRAPI_TOKEN,
          `nominee-${nominee.Name}`
        );
        if (nomineeImgId) nominee.Image = [nomineeImgId];
      }
      delete nominee._imageUrl;
    }
  }

  console.log('   Creating entry in Strapi...');
  const result = await createAward(payload, config.STRAPI_URL, config.STRAPI_TOKEN);

  console.log(`\n✅ Done: "${payload.title}" created (id: ${result.data?.id}).`);
  console.log('   Please double-check the categories/winners/nominees in Strapi admin — Wikipedia table layouts vary and auto-parsing is best-effort.\n');
}

// ---- CLI entry point -------------------------------------------------
const urls = process.argv.slice(2);

if (urls.length === 0) {
  console.error('Usage:');
  console.error('  node index.js <wikipedia-url>');
  console.error('  node index.js <url1> <url2> <url3>   (batch mode, processed one by one)\n');
  console.error('Example:');
  console.error('  node index.js https://en.wikipedia.org/wiki/68th_Filmfare_Awards\n');
  console.error('Tip: run "node preview.js <url>" first to see the parsed data as JSON');
  console.error('     without creating anything in Strapi.');
  process.exit(1);
}

(async () => {
  for (const url of urls) {
    try {
      await run(url);
    } catch (err) {
      console.error(`\n❌ Failed on ${url}: ${err.message}\n`);
      // continue with the next URL instead of stopping the whole batch
    }
  }
})();
