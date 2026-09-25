/**
 * Run this BEFORE index.js to check that your .env is set up correctly
 * and your Strapi token actually works:
 *
 *   node test-connection.js
 */
require('dotenv').config();
const config = require('./config');

(async () => {
  console.log(`Strapi URL: ${config.STRAPI_URL}`);
  console.log(
    config.STRAPI_TOKEN
      ? `Token loaded: yes (${config.STRAPI_TOKEN.length} characters)`
      : 'Token loaded: NO — .env file missing or STRAPI_TOKEN not set!'
  );

  if (!config.STRAPI_TOKEN) {
    console.log('\n👉 Fix: copy .env.example to .env and paste your Strapi API token into it.');
    process.exit(1);
  }

  const token = config.STRAPI_TOKEN;
  console.log(`Token preview: ${token.slice(0, 6)}...${token.slice(-6)}`);

  let sawWarning = false;
  if (/^["']|["']$/.test(token)) {
    console.log('⚠️  Token has quote characters at the start/end — remove any " or \' around it in .env');
    sawWarning = true;
  }
  if (/^\s|\s$/.test(token)) {
    console.log('⚠️  Token has leading/trailing whitespace or a line break — re-copy it as one clean line in .env');
    sawWarning = true;
  }
  if (/^\uFEFF/.test(token) || /\uFEFF/.test(token)) {
    console.log('⚠️  Token contains a BOM/hidden character — .env was likely saved by Notepad. Re-save it as "UTF-8" (not "UTF-8 with BOM") using VS Code or Notepad++.');
    sawWarning = true;
  }
  if (sawWarning) {
    console.log('   Fix the warning(s) above, save .env, and run this script again.\n');
  }

  console.log('\nCalling GET /api/awards ...');
  try {
    const res = await fetch(`${config.STRAPI_URL}/api/awards?pagination[limit]=1`, {
      headers: { Authorization: `Bearer ${config.STRAPI_TOKEN}` }
    });
    const bodyText = await res.text();
    console.log(`Status: ${res.status}`);

    if (res.status === 200) {
      console.log('\n✅ Success — your Strapi URL and token both work correctly.');
    } else if (res.status === 401) {
      console.log('\n❌ 401 Unauthorized. This means the token itself is missing or wrong.');
      console.log('   Check:');
      console.log('   1. .env file exists in this project folder (not just .env.example)');
      console.log('   2. STRAPI_TOKEN was copied in full, with no extra spaces/quotes/line breaks');
      console.log('   3. The token was not deleted/regenerated in Strapi admin after you copied it');
      console.log(`   Response body: ${bodyText.slice(0, 300)}`);
    } else if (res.status === 403) {
      console.log('\n❌ 403 Forbidden. The token is valid but does not have permission for "awards".');
      console.log('   Fix: Strapi admin -> Settings -> API Tokens -> edit your token -> Token type: "Full access"');
      console.log(`   Response body: ${bodyText.slice(0, 300)}`);
    } else if (res.status === 404) {
      console.log('\n❌ 404 Not Found. Check STRAPI_URL in .env, and that the Award content-type is saved/published.');
      console.log(`   Response body: ${bodyText.slice(0, 300)}`);
    } else {
      console.log(`\n❌ Unexpected status. Response body: ${bodyText.slice(0, 500)}`);
    }
  } catch (err) {
    console.log(`\n❌ Could not reach Strapi at all: ${err.message}`);
    console.log('   Check that STRAPI_URL in .env is correct and your Strapi server is actually running.');
  }
})();
