require('dotenv').config();
const Groq       = require('groq-sdk');
const { Resend } = require('resend');
const fs         = require('fs');
const path       = require('path');

// sharp is optional — images are embedded as base64 when available
let sharp;
try { sharp = require('sharp'); } catch { sharp = null; }

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
  if (!sharp) return null;
  const filepath = path.join(IMAGES_DIR, filename);
  if (!fs.existsSync(filepath)) return null;
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
  const accentColors = ['#c6a559', '#5c7cfa', '#34d399'];
  const specRows = product.specs.map((s, i) => `
    <tr>
      <td style="padding:13px 0; border-bottom:1px solid #141824;">
        <table cellpadding="0" cellspacing="0" width="100%"><tr>
          <td width="24" valign="top" style="padding-top:4px;">
            <div style="width:7px; height:7px; background:${accentColors[i % accentColors.length]}; border-radius:50%;"></div>
          </td>
          <td style="font-family:Helvetica,Arial,sans-serif; font-size:14px; color:#c8d0de; line-height:1.5;">${s}</td>
        </tr></table>
      </td>
    </tr>`).join('');

  const bestForItems = content.best_for.map(b =>
    `<span style="display:inline-block; margin:4px 6px 4px 0; padding:6px 16px; background:#0e1120; border:1px solid #1e2535; border-radius:20px; font-family:Helvetica,Arial,sans-serif; font-size:12px; color:#6e7d99; letter-spacing:0.4px;">${b}</span>`
  ).join('');

  const brandLabel = isPlanet ? 'PLANETEX ACQUISITION' : 'TESTER.IO PRODUCT SPOTLIGHT';
  const priceBlock = isPlanet
    ? `<div style="margin-top:14px;"><span style="display:inline-block; padding:5px 18px; background:linear-gradient(135deg,#c6a559,#e6b979); border-radius:4px; font-family:Helvetica,Arial,sans-serif; font-size:13px; font-weight:800; color:#060810; letter-spacing:0.5px;">${product.price}</span></div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${product.name}</title>
</head>
<body style="margin:0; padding:0; background:#060810;">

<table width="100%" cellpadding="0" cellspacing="0" style="background:#060810; padding:32px 16px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px; width:100%;">

  <!-- TOP LABEL BAR -->
  <tr><td style="background:#090b13; border:1px solid #1a1f2e; border-bottom:none; border-radius:10px 10px 0 0; padding:14px 32px;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="font-family:Helvetica,Arial,sans-serif; font-size:10px; font-weight:700; letter-spacing:3px; text-transform:uppercase; color:#c6a559;">${brandLabel}</td>
      <td align="right" style="font-family:Helvetica,Arial,sans-serif; font-size:10px; color:#2e3650; letter-spacing:1.5px; text-transform:uppercase;">${product.category}</td>
    </tr></table>
  </td></tr>

  <!-- HERO IMAGE -->
  ${imageDataUri ? `
  <tr><td style="border-left:1px solid #1a1f2e; border-right:1px solid #1a1f2e; padding:0; line-height:0; font-size:0;">
    <img src="${imageDataUri}" alt="${product.name}" width="600"
         style="width:100%; height:300px; object-fit:cover; object-position:center; display:block;" />
  </td></tr>
  <tr><td style="height:3px; background:linear-gradient(90deg,#c6a559,#f0c060,#c6a559);"></td></tr>` : `
  <tr><td style="height:3px; background:linear-gradient(90deg,#c6a559,#f0c060,#c6a559);"></td></tr>`}

  <!-- PRODUCT IDENTITY -->
  <tr><td style="background:#090b13; border-left:1px solid #1a1f2e; border-right:1px solid #1a1f2e; padding:28px 32px 24px;">
    <div style="font-family:Georgia,'Times New Roman',serif; font-size:34px; font-weight:700; color:#ffffff; line-height:1.1; margin-bottom:10px; letter-spacing:-0.5px;">${product.name}</div>
    <div style="font-family:Helvetica,Arial,sans-serif; font-size:15px; color:#6a7896; line-height:1.6;">${product.tagline}</div>
    ${priceBlock}
  </td></tr>

  <!-- PITCH COPY -->
  <tr><td style="background:#0c0f18; border:1px solid #1a1f2e; border-top:none; padding:26px 32px;">
    <div style="font-family:Georgia,'Times New Roman',serif; font-size:15px; color:#c0c8d8; line-height:1.95; font-style:italic;">${content.pitch}</div>
  </td></tr>

  <!-- KEY SPECS -->
  <tr><td style="background:#090b13; border:1px solid #1a1f2e; border-top:none; padding:24px 32px;">
    <div style="font-family:Helvetica,Arial,sans-serif; font-size:10px; font-weight:700; letter-spacing:3px; text-transform:uppercase; color:#c6a559; padding-bottom:12px; margin-bottom:4px; border-bottom:1px solid #141824;">${isPlanet ? 'PLANETARY DATA' : 'KEY SPECIFICATIONS'}</div>
    <table width="100%" cellpadding="0" cellspacing="0">${specRows}</table>
  </td></tr>

  <!-- WHY NOW -->
  <tr><td style="background:#0c0f18; border:1px solid #1a1f2e; border-top:none; padding:22px 32px;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="background:#0a0d18; border:1px solid #1e2535; border-left:3px solid #c6a559; border-radius:0 6px 6px 0; padding:16px 20px;">
        <div style="font-family:Helvetica,Arial,sans-serif; font-size:10px; font-weight:700; letter-spacing:2.5px; text-transform:uppercase; color:#c6a559; margin-bottom:8px;">${isPlanet ? 'ACQUISITION WINDOW' : 'WHY NOW'}</div>
        <div style="font-family:Helvetica,Arial,sans-serif; font-size:14px; color:#d0d8e8; line-height:1.7;">${content.why_now}</div>
      </td>
    </tr></table>
  </td></tr>

  <!-- IDEAL FOR -->
  <tr><td style="background:#090b13; border:1px solid #1a1f2e; border-top:none; padding:20px 32px 22px;">
    <div style="font-family:Helvetica,Arial,sans-serif; font-size:10px; font-weight:700; letter-spacing:3px; text-transform:uppercase; color:#c6a559; margin-bottom:12px;">IDEAL FOR</div>
    <div>${bestForItems}</div>
  </td></tr>

  <!-- CTA -->
  <tr><td style="background:#0c0f18; border:1px solid #1a1f2e; border-top:none; padding:28px 32px; text-align:center;">
    <a href="${product.url}" style="display:inline-block; padding:15px 44px; background:linear-gradient(135deg,#c6a559,#e6b979); color:#060810; font-family:Helvetica,Arial,sans-serif; font-size:12px; font-weight:800; text-decoration:none; border-radius:4px; letter-spacing:2px; text-transform:uppercase;">${content.cta} &rarr;</a>
  </td></tr>

  <!-- FOOTER -->
  <tr><td style="background:#060810; border:1px solid #1a1f2e; border-top:none; border-radius:0 0 10px 10px; padding:18px 32px; text-align:center;">
    <div style="height:1px; background:linear-gradient(90deg,transparent,#1a1f2e,transparent); margin-bottom:14px;"></div>
    <div style="font-family:Helvetica,Arial,sans-serif; font-size:10px; color:#232b3e; letter-spacing:2px; text-transform:uppercase;">${isPlanet ? 'PLANETEX' : 'TESTER.IO'} &nbsp;&bull;&nbsp; POWERED BY GROQ &amp; RESEND</div>
  </td></tr>

  <!-- BOTTOM ACCENT -->
  <tr><td style="height:2px; background:linear-gradient(90deg,transparent,#c6a559,transparent); border-radius:0 0 4px 4px;"></td></tr>

</table>
</td></tr>
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
  const subject = `${subjectPrefix}: ${product.name}`;
  console.log('Sending via Resend...');
  const _toList = (process.env.RESEND_TO || '').split(',').map(e => e.trim()).filter(Boolean);
  if (!_toList.length) throw new Error('RESEND_TO is empty — no recipients configured');

  const ids = [];
  for (let i = 0; i < _toList.length; i += 50) {
    const batch = _toList.slice(i, i + 50);
    const to    = batch.length === 1 ? batch[0] : batch;
    const { data, error } = await resend.emails.send({ from: process.env.RESEND_FROM, to, subject, html });
    if (error) throw new Error(error.message);
    ids.push(data.id);
    console.log(`Batch ${Math.floor(i / 50) + 1}: sent to ${batch.length} recipient(s). ID: ${data.id}`);
  }
  console.log(`Sent ${product.name} to ${_toList.length} recipient(s).`);
  return { ok: true, ids, product: product.name };
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
