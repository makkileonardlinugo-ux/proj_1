import { groq, resend, FROM_EMAIL, requireAuth, cors, resolveRecipients } from '../_lib/helpers.js';

// ── Catalogs ──────────────────────────────────────────────────────────────────

const PRODUCTS = {
  watch:     { name: 'Smart Watch Pro',    tagline: 'Medical-grade biosensing on the wrist',     category: 'Wearable',          specs: ['ECG + SpO2 sensor', 'Sapphire micro-display — 2,000 nits', 'Dual-band GPS', '9-day battery'],              image: 'device-watch.jpg' },
  glasses:   { name: 'Smart Glasses',      tagline: 'Heads-up display — under 38 grams',         category: 'Ambient computing', specs: ['Waveguide HUD', 'Open-ear audio', 'Live translation', 'On-device processing'],                              image: 'device-glasses.jpg' },
  assistant: { name: 'Smart Assistant',    tagline: 'Voice-first — your home stays private',     category: 'Home hub',          specs: ['On-device LLM', 'Far-field microphone array', 'Matter ready', 'No cloud dependency'],                       image: 'device-assistant.jpg' },
  earbuds:   { name: 'Smart Earbuds',      tagline: 'ANC that adapts to your heart rate',        category: 'Audio',             specs: ['Adaptive noise cancellation', 'Heart-rate sensor', 'Spatial audio', 'Motion-aware tuning'],                  image: 'device-earbuds.jpg' },
  ring:      { name: 'Smart Ring',         tagline: 'Sleep and recovery in titanium',            category: 'Wearable',          specs: ['Sleep stage tracking', 'Skin temperature sensor', '7-day battery', 'Titanium build'],                       image: 'device-ring.jpg' },
  hub:       { name: 'Smart Home Hub',     tagline: 'One secure mesh for every device',          category: 'Connected home',    specs: ['Thread + Matter protocol', 'Local-first control', 'Energy monitoring', 'No subscription'],                  image: 'device-hub.jpg' },
};

const PLANETS = {
  'kepler-452b':  { name: 'Kepler-452b',  tagline: "Earth's largest cousin — 1,402 light-years away",               category: 'Super-Earth',         price: 'CR 4.2B', specs: ['5.0 M⊕ mass, 1.63 R⊕ diameter', 'Orbital period: 384.8 days', 'Surface temp: -2 to 42°C', 'Confirmed habitable zone'],     image: 'kepler-452b.jpg' },
  'trappist-1e':  { name: 'TRAPPIST-1e',  tagline: 'The last uncharted ocean — 39.5 light-years away',              category: 'Ocean World',         price: 'CR 3.5B', specs: ['0.77 M⊕ mass, 0.91 R⊕ diameter', '100% ocean coverage', 'Surface temp: -20 to 10°C', '7-planet system rights'],         image: 'trappist-1e.jpg' },
  'gliese-667cc': { name: 'Gliese 667Cc', tagline: 'Three suns. One world. Yours to claim.',                        category: 'Premium Super-Earth', price: 'CR 6.1B', specs: ['3.8 M⊕ mass, 1.5 R⊕ diameter', 'Triple-star host system', 'Earth Similarity Index: 0.78', 'Surface temp: -5 to 28°C'], image: 'gliese-667cc.png' },
  'hd-40307g':    { name: 'HD 40307g',    tagline: 'The jewel of the K-dwarf belt — 42 light-years away',           category: 'Mini-Neptune',        price: 'CR 2.8B', specs: ['7.1 M⊕ mass, 2.1 R⊕ diameter', 'H₂-He atmospheric harvesting rights', 'Orbital period: 197.8 days', 'Closest mini-neptune'], image: 'hd-40307g.png' },
  'tau-ceti-e':   { name: 'Tau Ceti e',   tagline: 'Endless amber dunes — 11.9 light-years away',                   category: 'Desert World',        price: 'CR 2.3B', specs: ['3.93 M⊕ mass, 1.55 R⊕ diameter', 'Most Sun-like star in catalog', 'Geological age: 5.8 billion years', '5-planet observation rights'], image: 'tau-ceti-e.png' },
  'wolf-1061c':   { name: 'Wolf 1061c',   tagline: 'Raw power — closest world in the catalog at 13.8 light-years',  category: 'Volcanic World',      price: 'CR 1.9B', specs: ['4.3 M⊕ mass, 1.6 R⊕ diameter', 'Active Type IV geology', 'Best-value entry listing', 'Geothermal resource rights'],     image: 'wolf-1061c.png' },
};

// ── Email template ────────────────────────────────────────────────────────────

function renderProductEmail(product, content, isPlanet, imageUrl) {
  const specRows = product.specs.map(s => `
    <tr>
      <td style="padding:9px 0; border-bottom:1px solid #1e2129; font-size:0.82rem; color:#f2f4f5;">
        <span style="color:#c6a559; margin-right:8px;">&#10003;</span>${s}
      </td>
    </tr>`).join('');

  const bestForItems = content.best_for.map(b => `
    <span style="display:inline-block; margin:4px 4px 4px 0; padding:5px 12px; background:#111318; border:1px solid #1e2129; border-radius:999px; font-size:0.78rem; color:#8b9197;">${b}</span>`).join('');

  const productPath = isPlanet
    ? `product/planet/${Object.keys(PLANETS).find(k => PLANETS[k].name === product.name)}.html`
    : `product/${product.name.replace('Smart ', '')}/index.html`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${product.name} — Tester.io</title>
</head>
<body style="margin:0; padding:0; background:#05070a; font-family:'Helvetica Neue', Helvetica, Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#05070a; padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px; width:100%;">
        <tr>
          <td style="background:#0a0c10; border:1px solid #1e2129; border-radius:16px 16px 0 0; padding:32px 36px 24px;">
            <div style="font-size:0.68rem; font-weight:700; letter-spacing:0.2em; text-transform:uppercase; color:#c6a559; margin-bottom:8px;">${isPlanet ? 'PLANETEX' : 'Tester.io'} &bull; ${product.category}</div>
            ${isPlanet ? `<div style="font-size:0.78rem; color:#8b9197; margin-bottom:6px;">Acquisition Price: <span style="color:#c6a559; font-weight:700;">${product.price}</span></div>` : ''}
            <div style="font-size:1.8rem; font-weight:800; color:#f2f4f5; line-height:1.1; margin-bottom:8px;">${product.name}</div>
            <div style="font-size:0.9rem; color:#8b9197; line-height:1.5;">${product.tagline}</div>
          </td>
        </tr>
        <tr><td style="height:2px; background:linear-gradient(90deg, #c6a559, #e6b979, #c6a559);"></td></tr>
        ${imageUrl ? `
        <tr>
          <td style="border-left:1px solid #1e2129; border-right:1px solid #1e2129; padding:0; line-height:0;">
            <img src="${imageUrl}" alt="${product.name}" width="600" style="width:100%; max-width:600px; height:240px; object-fit:cover; display:block;" />
          </td>
        </tr>` : ''}
        <tr>
          <td style="background:#0a0c10; border-left:1px solid #1e2129; border-right:1px solid #1e2129; padding:28px 36px;">
            <div style="font-size:0.95rem; color:#f2f4f5; line-height:1.8;">${content.pitch}</div>
          </td>
        </tr>
        <tr>
          <td style="background:#0d0f15; border:1px solid #1e2129; border-top:none; padding:24px 36px;">
            <div style="font-size:0.68rem; font-weight:700; letter-spacing:0.18em; text-transform:uppercase; color:#c6a559; margin-bottom:14px;">Key Specs</div>
            <table width="100%" cellpadding="0" cellspacing="0">${specRows}</table>
          </td>
        </tr>
        <tr>
          <td style="background:#0a0c10; border:1px solid #1e2129; border-top:none; padding:24px 36px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="padding:16px 20px; background:#111318; border-left:3px solid #c6a559; border-radius:4px;">
                  <div style="font-size:0.68rem; font-weight:700; letter-spacing:0.16em; text-transform:uppercase; color:#c6a559; margin-bottom:6px;">Why Now</div>
                  <div style="font-size:0.85rem; color:#f2f4f5; line-height:1.65;">${content.why_now}</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="background:#0d0f15; border:1px solid #1e2129; border-top:none; padding:24px 36px;">
            <div style="font-size:0.68rem; font-weight:700; letter-spacing:0.18em; text-transform:uppercase; color:#c6a559; margin-bottom:12px;">Best For</div>
            <div>${bestForItems}</div>
          </td>
        </tr>
        <tr>
          <td style="background:#0a0c10; border:1px solid #1e2129; border-top:none; padding:28px 36px; text-align:center;">
            <a href="https://tester.io/${productPath}" style="display:inline-block; padding:14px 32px; background:linear-gradient(135deg, #c6a559, #e6b979); color:#0a0c10; font-weight:700; font-size:0.9rem; text-decoration:none; border-radius:999px;">${content.cta} &rarr;</a>
          </td>
        </tr>
        <tr>
          <td style="background:#080a0e; border:1px solid #1e2129; border-top:none; border-radius:0 0 16px 16px; padding:18px 36px; text-align:center;">
            <div style="font-size:0.72rem; color:#3e4248; letter-spacing:0.06em;">Tester.io Product Spotlight &bull; Powered by Groq &amp; Resend</div>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (!requireAuth(req, res)) return;
  if (req.method !== 'POST') return res.status(405).end();

  const { product: productKey, recipient_type, recipient_emails } = req.body || {};
  if (!productKey) return res.status(400).json({ ok: false, error: 'product key is required' });

  const product  = PRODUCTS[productKey] || PLANETS[productKey];
  const isPlanet = !!PLANETS[productKey];
  if (!product) return res.status(400).json({ ok: false, error: `Unknown product key: ${productKey}` });

  try {
    const recipients = await resolveRecipients(recipient_type, recipient_emails);
    if (recipients !== null && !recipients.length) {
      return res.status(400).json({ ok: false, error: 'No recipients found for the selected option.' });
    }

    const systemPrompt = isPlanet
      ? `You are a luxury real-estate copywriter for PLANETEX. Return ONLY valid JSON: { "pitch": "...", "why_now": "...", "best_for": ["...","...","..."], "cta": "..." }`
      : `You are a product marketing writer for Tester.io. Return ONLY valid JSON: { "pitch": "...", "why_now": "...", "best_for": ["...","...","..."], "cta": "..." }`;

    const userContent = isPlanet
      ? `Write acquisition email content for ${product.name}. Tagline: ${product.tagline}. Category: ${product.category}. Key data: ${product.specs.join(', ')}. Price: ${product.price}.`
      : `Write product email content for the ${product.name}. Tagline: ${product.tagline}. Category: ${product.category}. Key specs: ${product.specs.join(', ')}.`;

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

    const content  = JSON.parse(completion.choices[0].message.content);
    const host     = req.headers.host || '';
    const protocol = host.includes('localhost') ? 'http' : 'https';
    const imageUrl = product.image ? `${protocol}://${host}/images/${product.image}` : null;
    const html     = renderProductEmail(product, content, isPlanet, imageUrl);

    const toList = recipients ?? [];
    if (!toList.length) return res.status(400).json({ ok: false, error: 'No recipients configured.' });

    const subjectPrefix = isPlanet ? 'Planet Listing' : 'Product Spotlight';
    const { data, error } = await resend.emails.send({
      from:    FROM_EMAIL,
      to:      toList.length === 1 ? toList[0] : toList,
      subject: `${subjectPrefix}: ${product.name}`,
      html,
    });

    if (error) throw new Error(error.message);
    res.json({ ok: true, output: `Sent: ${product.name}. ID: ${data.id}` });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}
