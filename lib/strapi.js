const FormData = require('form-data');

const USER_AGENT = 'WikiAwardStrapiSync/1.0 (personal project)';

// Strips accents/diacritics and any character that isn't safe in a
// filename, so names like "Kiran Rao" or "Café" don't produce a broken
// upload filename.
function safeFileName(name, ext) {
  const base = (name || 'image')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents
    .replace(/[^a-zA-Z0-9]/g, '_') // everything else -> underscore
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase();
  return `${base || 'image'}.${ext}`;
}

/**
 * Downloads an image from a URL and uploads it to Strapi's media library.
 * Returns the uploaded file's id, or null if anything fails (so the main
 * script can keep going and just leave that image field empty).
 */
async function uploadImageFromUrl(imageUrl, strapiUrl, token, baseFileName) {
  if (!imageUrl || typeof imageUrl !== 'string') return null;

  try {
    const fixedUrl = imageUrl.startsWith('//') ? `https:${imageUrl}` : imageUrl;

    const imgRes = await fetch(fixedUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
      }
    });
    if (!imgRes.ok) throw new Error(`image fetch failed (${imgRes.status})`);

    const buffer = Buffer.from(await imgRes.arrayBuffer());
    if (!buffer || buffer.length === 0) throw new Error('downloaded image was empty');

    // Determine the real content-type/extension instead of always forcing
    // .jpg — Strapi's image processor (sharp) can fail on a mismatched
    // extension (e.g. a PNG saved with a .jpg filename).
    let contentType = (imgRes.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
    const extMap = {
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'image/svg+xml': 'svg'
    };
    const ext = extMap[contentType] || 'jpg';
    if (!contentType.startsWith('image/')) contentType = 'image/jpeg';

    const fileName = safeFileName(baseFileName, ext);

    const form = new FormData();
    form.append('files', buffer, { filename: fileName, contentType, knownLength: buffer.length });

    const uploadRes = await fetch(`${strapiUrl}/api/upload`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        ...form.getHeaders()
      },
      body: form
    });

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      throw new Error(`Strapi upload failed (${uploadRes.status}): ${errText}`);
    }

    const uploaded = await uploadRes.json();
    return uploaded?.[0]?.id ?? null;
  } catch (err) {
    console.warn(`   ⚠️  Image upload skipped (${baseFileName}): ${err.message}`);
    return null;
  }
}

async function createAward(data, strapiUrl, token) {
  const res = await fetch(`${strapiUrl}/api/awards`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ data })
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Strapi create failed (${res.status}): ${errBody}`);
  }

  return res.json();
}

module.exports = { uploadImageFromUrl, createAward };
