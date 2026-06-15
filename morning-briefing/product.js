require('dotenv').config();
const Groq       = require('groq-sdk');
const { Resend } = require('resend');
const sharp      = require('sharp');
const fs         = require('fs');
const path       = require('path');

const IMAGES_DIR = path.join(__dirname, '..', 'images');

const groq   = new Groq({ apiKey: process.env.GROQ_API_KEY });
const resend = new Resend(process.env.RESEND_API_KEY);

// ── Product catalog ────────────────────────────────────────────────────────────

const PRODUCTS = {
  watch: {
    name:     'Smart Watch Pro',
    tagline:  'Medical-grade biosensing on the wrist',
    category: 'Wearable',
    specs:    ['ECG + SpO2 sensor', 'Sapphire micro-display — 2,000 nits', 'Dual-band GPS', '9-day battery'],
    url:      'http://localhost:3000/product/Watch/index.html',
    image:    'device-watch.jpg',
  },
  glasses: {
    name:     'Smart Glasses',
    tagline:  'Heads-up display — under 38 grams',
    category: 'Ambient computing',
    specs:    ['Waveguide HUD', 'Open-ear audio', 'Live translation', 'On-device processing'],
    url:      'http://localhost:3000/product/Glasses/index.html',
    image:    'device-glasses.jpg',
  },
  assistant: {
    name:     'Smart Assistant',
    tagline:  'Voice-first — your home stays private',
    category: 'Home hub',
    specs:    ['On-device LLM', 'Far-field microphone array', 'Matter ready', 'No cloud dependency'],
    url:      'http://localhost:3000/product/Assistant/index.html',
    image:    'device-assistant.jpg',
  },
  earbuds: {
    name:     'Smart Earbuds',
    tagline:  'ANC that adapts to your heart rate',
    category: 'Audio',
    specs:    ['Adaptive noise cancellation', 'Heart-rate sensor', 'Spatial audio', 'Motion-aware tuning'],
    url:      'http://localhost:3000/product/Earbuds/index.html',
    image:    'device-earbuds.jpg',
  },
  ring: {
    name:     'Smart Ring',
    tagline:  'Sleep and recovery in titanium',
    category: 'Wearable',
    specs:    ['Sleep stage tracking', 'Skin temperature sensor', '7-day battery', 'Titanium build'],
    url:      'http://localhost:3000/product/Ring/index.html',
    image:    'device-ring.jpg',
  },
  hub: {
    name:     'Smart Home Hub',
    tagline:  'One secure mesh for every device',
    category: 'Connected home',
    specs:    ['Thread + Matter protocol', 'Local-first control', 'Energy monitoring', 'No subscription'],
    url:      'http://localhost:3000/product/Hub/index.html',
    image:    'device-hub.jpg',
  },
};

// ── Planet catalog ────────────────────────────────────────────────────────────

const PLANETS = {
  'kepler-452b': {
    name:     'Kepler-452b',
    tagline:  "Earth's largest cousin — 1,402 light-years away",
    category: 'Super-Earth',
    specs:    ['5.0 M⊕ mass, 1.63 R⊕ diameter', 'Orbital period: 384.8 days', 'Surface temp: -2 to 42°C', 'Confirmed habitable zone — N₂-O₂ atmosphere'],
    price:    'CR 4.2B',
    url:      'http://localhost:3000/product/planet/kepler-452b.html',
    image:    'kepler-452b.jpg',
  },
  'trappist-1e': {
    name:     'TRAPPIST-1e',
    tagline:  'The last uncharted ocean — 39.5 light-years away',
    category: 'Ocean World',
    specs:    ['0.77 M⊕ mass, 0.91 R⊕ diameter', '100% ocean coverage', 'Surface temp: -20 to 10°C', 'Observation rights to 7-planet system'],
    price:    'CR 3.5B',
    url:      'http://localhost:3000/product/planet/trappist-1e.html',
    image:    'trappist-1e.jpg',
  },
  'gliese-667cc': {
    name:     'Gliese 667Cc',
    tagline:  'Three suns. One world. Yours to claim.',
    category: 'Premium Super-Earth',
    specs:    ['3.8 M⊕ mass, 1.5 R⊕ diameter', 'Triple-star host system', 'Earth Similarity Index: 0.78', 'Surface temp: -5 to 28°C'],
    price:    'CR 6.1B',
    url:      'http://localhost:3000/product/planet/gliese-667cc.html',
    image:    'gliese-667cc.png',
  },
  'hd-40307g': {
    name:     'HD 40307g',
    tagline:  'The jewel of the K-dwarf belt — 42 light-years away',
    category: 'Mini-Neptune',
    specs:    ['7.1 M⊕ mass, 2.1 R⊕ diameter', 'H₂-He atmospheric harvesting rights', 'Orbital period: 197.8 days', 'Closest mini-neptune in catalog'],
    price:    'CR 2.8B',
    url:      'http://localhost:3000/product/planet/hd-40307g.html',
    image:    'hd-40307g.png',
  },
  'tau-ceti-e': {
    name:     'Tau Ceti e',
    tagline:  'Endless amber dunes — 11.9 light-years away',
    category: 'Desert World',
    specs:    ['3.93 M⊕ mass, 1.55 R⊕ diameter', 'Most Sun-like star in catalog', 'Geological age: 5.8 billion years', 'Five-planet system observation rights'],
    price:    'CR 2.3B',
    url:      'http://localhost:3000/product/planet/tau-ceti-e.html',
    image:    'tau-ceti-e.png',
  },
  'wolf-1061c': {
    name:     'Wolf 1061c',
    tagline:  'Raw power — closest world in the catalog at 13.8 light-years',
    category: 'Volcanic World',
    specs:    ['4.3 M⊕ mass, 1.6 R⊕ diameter', 'Active Type IV geology', 'Best-value entry listing', 'Geothermal resource rights included'],
    price:    'CR 1.9B',
    url:      'http://localhost:3000/product/planet/wolf-1061c.html',
    image:    'wolf-1061c.png',
  },
};

// ── Image helper: resize to max 600px wide and return base64 data URI ─────────

async function imageToDataUri(filename) {
  const filepath = path.join(IMAGES_DIR, filename);
  if (!fs.existsSync(filepath)) return null;

  const ext  = path.extname(filename).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : 'image/jpeg';

  const buffer = await sharp(filepath)
    .resize({ width: 600, withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();

  return `data:image/jpeg;base64,${buffer.toString('base64')}`;
}

// ── Generate product email content via Groq ────────────────────────────────────

async function generateProductContent(product, isPlanet = false) {
  const systemPrompt = isPlanet
    ? `You are a luxury real-estate copywriter for PLANETEX, a platform selling sovereign ownership of exoplanets.
Return ONLY valid JSON with this exact shape:
{
  "pitch": "2-3 sentence evocative pitch about owning this world — poetic but grounded in the real data",
  "why_now": "1-2 sentences on why this planet is a rare acquisition opportunity right now",
  "best_for": ["type of investor or visionary", "type of investor or visionary", "type of investor or visionary"],
  "cta": "short punchy acquisition CTA label (4-6 words max)"
}`
    : `You are a sharp product marketing writer for Tester.io, a smart wearable tech brand.
Return ONLY valid JSON with this exact shape:
{
  "pitch": "2-3 sentence compelling product pitch — enthusiastic but not salesy",
  "why_now": "1-2 sentences on why this product is relevant right now (trends, timing, market)",
  "best_for": ["type of person or use case", "type of person or use case", "type of person or use case"],
  "cta": "short punchy call-to-action button label (4-6 words max)"
}`;

  const userContent = isPlanet
    ? `Write acquisition email content for ${product.name}.
Tagline: ${product.tagline}
Category: ${product.category}
Key data: ${product.specs.join(', ')}
Acquisition price: ${product.price}

Make it feel exclusive, vast, and historic — like buying a piece of the universe.`
    : `Write product email content for the ${product.name}.
Tagline: ${product.tagline}
Category: ${product.category}
Key specs: ${product.specs.join(', ')}

Make it feel premium, technical, and exciting.`;

  const completion = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userContent },
    ],
    max_tokens: 500,
    temperature: 0.75,
  });

  return JSON.parse(completion.choices[0].message.content);
}

// ── Render HTML email ──────────────────────────────────────────────────────────

function renderProductEmail(product, content, isPlanet = false, imageDataUri = null) {
  const specRows = product.specs.map(s => `
    <tr>
      <td style="padding:9px 0; border-bottom:1px solid #1e2129; font-size:0.82rem; color:#f2f4f5;">
        <span style="color:#c6a559; margin-right:8px;">&#10003;</span>${s}
      </td>
    </tr>`).join('');

  const bestForItems = content.best_for.map(b => `
    <span style="display:inline-block; margin:4px 4px 4px 0; padding:5px 12px; background:#111318; border:1px solid #1e2129; border-radius:999px; font-size:0.78rem; color:#8b9197;">
      ${b}
    </span>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${product.name} — Tester.io</title>
</head>
<body style="margin:0; padding:0; background:#05070a; font-family:'Helvetica Neue', Helvetica, Arial, sans-serif;">

  <table width="100%" cellpadding="0" cellspacing="0" style="background:#05070a; padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px; width:100%;">

          <!-- Header -->
          <tr>
            <td style="background:#0a0c10; border:1px solid #1e2129; border-radius:16px 16px 0 0; padding:32px 36px 24px;">
              <div style="font-size:0.68rem; font-weight:700; letter-spacing:0.2em; text-transform:uppercase; color:#c6a559; margin-bottom:8px;">
                ${isPlanet ? 'PLANETEX' : 'Tester.io'} &bull; ${product.category}
              </div>
              ${isPlanet ? `<div style="font-size:0.78rem; color:#8b9197; margin-bottom:6px;">Acquisition Price: <span style="color:#c6a559; font-weight:700;">${product.price}</span></div>` : ''}
              <div style="font-size:1.8rem; font-weight:800; color:#f2f4f5; line-height:1.1; margin-bottom:8px;">
                ${product.name}
              </div>
              <div style="font-size:0.9rem; color:#8b9197; line-height:1.5;">
                ${product.tagline}
              </div>
            </td>
          </tr>

          <!-- Gold bar -->
          <tr>
            <td style="height:2px; background:linear-gradient(90deg, #c6a559, #e6b979, #c6a559);"></td>
          </tr>

          <!-- Product image -->
          ${imageDataUri ? `
          <tr>
            <td style="border-left:1px solid #1e2129; border-right:1px solid #1e2129; padding:0; line-height:0;">
              <img src="${imageDataUri}" alt="${product.name}" width="600"
                   style="width:100%; max-width:600px; height:240px; object-fit:cover; display:block;" />
            </td>
          </tr>` : ''}

          <!-- Pitch -->
          <tr>
            <td style="background:#0a0c10; border-left:1px solid #1e2129; border-right:1px solid #1e2129; padding:28px 36px;">
              <div style="font-size:0.95rem; color:#f2f4f5; line-height:1.8;">
                ${content.pitch}
              </div>
            </td>
          </tr>

          <!-- Specs -->
          <tr>
            <td style="background:#0d0f15; border:1px solid #1e2129; border-top:none; padding:24px 36px;">
              <div style="font-size:0.68rem; font-weight:700; letter-spacing:0.18em; text-transform:uppercase; color:#c6a559; margin-bottom:14px;">
                Key Specs
              </div>
              <table width="100%" cellpadding="0" cellspacing="0">
                ${specRows}
              </table>
            </td>
          </tr>

          <!-- Why Now -->
          <tr>
            <td style="background:#0a0c10; border:1px solid #1e2129; border-top:none; padding:24px 36px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding:16px 20px; background:#111318; border-left:3px solid #c6a559; border-radius:4px;">
                    <div style="font-size:0.68rem; font-weight:700; letter-spacing:0.16em; text-transform:uppercase; color:#c6a559; margin-bottom:6px;">
                      Why Now
                    </div>
                    <div style="font-size:0.85rem; color:#f2f4f5; line-height:1.65;">${content.why_now}</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Best For -->
          <tr>
            <td style="background:#0d0f15; border:1px solid #1e2129; border-top:none; padding:24px 36px;">
              <div style="font-size:0.68rem; font-weight:700; letter-spacing:0.18em; text-transform:uppercase; color:#c6a559; margin-bottom:12px;">
                Best For
              </div>
              <div>${bestForItems}</div>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td style="background:#0a0c10; border:1px solid #1e2129; border-top:none; padding:28px 36px; text-align:center;">
              <a href="${product.url}"
                 style="display:inline-block; padding:14px 32px; background:linear-gradient(135deg, #c6a559, #e6b979); color:#0a0c10; font-weight:700; font-size:0.9rem; text-decoration:none; border-radius:999px; letter-spacing:0.02em;">
                ${content.cta} &rarr;
              </a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#080a0e; border:1px solid #1e2129; border-top:none; border-radius:0 0 16px 16px; padding:18px 36px; text-align:center;">
              <div style="font-size:0.72rem; color:#3e4248; letter-spacing:0.06em;">
                Tester.io Product Spotlight &bull; Powered by Groq &amp; Resend
              </div>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>`;
}

// ── Orchestrate ────────────────────────────────────────────────────────────────

async function sendProductEmail(productKey) {
  const product = PRODUCTS[productKey] || PLANETS[productKey];
  if (!product) {
    const allKeys = [...Object.keys(PRODUCTS), ...Object.keys(PLANETS)].join(', ');
    throw new Error(`Unknown key: "${productKey}". Valid keys: ${allKeys}`);
  }

  const isPlanet = !!PLANETS[productKey];
  console.log(`Generating content for: ${product.name} (${isPlanet ? 'planet' : 'device'})...`);
  const [content, imageDataUri] = await Promise.all([
    generateProductContent(product, isPlanet),
    product.image ? imageToDataUri(product.image) : Promise.resolve(null),
  ]);

  console.log(imageDataUri ? 'Image loaded and encoded.' : 'No image found — skipping.');
  console.log('Rendering email...');
  const html = renderProductEmail(product, content, isPlanet, imageDataUri);

  const subjectPrefix = isPlanet ? 'Planet Listing' : 'Product Spotlight';
  console.log('Sending via Resend...');
  const _toList = (process.env.RESEND_TO || '').split(',').map(e => e.trim()).filter(Boolean);
  if (!_toList.length) throw new Error('RESEND_TO is empty — no recipients configured');
  const { data, error } = await resend.emails.send({
    from:    process.env.RESEND_FROM,
    to:      _toList.length === 1 ? _toList[0] : _toList,
    subject: `${subjectPrefix}: ${product.name}`,
    html,
  });

  if (error) throw new Error(error.message);
  console.log('Sent! ID:', data.id);
  return { ok: true, id: data.id, product: product.name };
}

const productKey = process.argv[2];
if (!productKey) {
  console.error('Usage: node product.js <product-key>');
  console.error('Device keys: watch, glasses, assistant, earbuds, ring, hub');
  console.error('Planet keys: kepler-452b, trappist-1e, gliese-667cc, hd-40307g, tau-ceti-e, wolf-1061c');
  process.exit(1);
}

sendProductEmail(productKey)
  .then(r => { console.log(JSON.stringify(r)); process.exit(0); })
  .catch(e => { console.error(e.message); process.exit(1); });
