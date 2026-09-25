/**
 * Preview what the script WOULD send to Strapi, without actually creating
 * anything. No Strapi connection or token is needed for this — it's pure
 * Wikipedia-fetch-and-parse, useful for checking the data (and debugging
 * the parser) before running index.js for real.
 *
 * Usage:
 *   node preview.js <wikipedia-url>
 *   node preview.js <wikipedia-url> --save        (also writes a JSON file)
 */
const fs = require('fs');
const path = require('path');
const { buildPayload } = require('./lib/buildPayload');

async function main() {
  const args = process.argv.slice(2);
  const save = args.includes('--save');
  const wikiUrl = args.find((a) => a.startsWith('http'));

  if (!wikiUrl) {
    console.error('Usage:');
    console.error('  node preview.js <wikipedia-url>');
    console.error('  node preview.js <wikipedia-url> --save   (also writes a .json file)\n');
    console.error('Example:');
    console.error('  node preview.js https://en.wikipedia.org/wiki/68th_Filmfare_Awards');
    process.exit(1);
  }

  console.log(`\n🔍 Fetching (preview only, nothing will be sent to Strapi): ${wikiUrl}\n`);

  const { payload, warnings, imageUrl, pageTitle, categoryCount } = await buildPayload(wikiUrl);

  console.log(`Found ${categoryCount} categor${categoryCount === 1 ? 'y' : 'ies'}.`);
  console.log(`Poster image that WOULD be uploaded: ${imageUrl || '(none found)'}\n`);

  if (warnings.length > 0) {
    console.log('Warnings:');
    for (const w of warnings) console.log(`  ⚠️  ${w}`);
    console.log('');
  }

  // image/winnerImage/nominee Image are left null/[] in preview mode since
  // no upload happens — that's expected, not a bug.
  console.log(JSON.stringify(payload, null, 2));

  if (save) {
    const outDir = path.join(__dirname, 'preview-output');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
    const outPath = path.join(outDir, `${pageTitle}.json`);
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
    console.log(`\n💾 Saved to ${outPath}`);
  }
}

main().catch((err) => {
  console.error(`\n❌ ${err.message}\n`);
  process.exit(1);
});
