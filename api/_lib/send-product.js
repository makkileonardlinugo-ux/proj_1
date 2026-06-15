import { groq, resend, FROM_EMAIL } from './helpers.js';

const PRODUCTS = {
  watch:     { name: 'Smart Watch Pro',    tagline: 'Medical-grade biosensing on the wrist',                          category: 'Wearable',          specs: ['ECG + SpO2 sensor', 'Sapphire micro-display — 2,000 nits', 'Dual-band GPS', '9-day battery'],              image: 'device-watch.jpg' },
  glasses:   { name: 'Smart Glasses',      tagline: 'Heads-up display — under 38 grams',                             category: 'Ambient computing', specs: ['Waveguide HUD', 'Open-ear audio', 'Live translation', 'On-device processing'],                              image: 'device-glasses.jpg' },
  assistant: { name: 'Smart Assistant',    tagline: 'Voice-first — your home stays private',                         category: 'Home hub',          specs: ['On-device LLM', 'Far-field microphone array', 'Matter ready', 'No cloud dependency'],                       image: 'device-assistant.jpg' },
  earbuds:   { name: 'Smart Earbuds',      tagline: 'ANC that adapts to your heart rate',                            category: 'Audio',             specs: ['Adaptive noise cancellation', 'Heart-rate sensor', 'Spatial audio', 'Motion-aware tuning'],                  image: 'device-earbuds.jpg' },
  ring:      { name: 'Smart Ring',         tagline: 'Sleep and recovery in titanium',                                category: 'Wearable',          specs: ['Sleep stage tracking', 'Skin temperature sensor', '7-day battery', 'Titanium build'],                       image: 'device-ring.jpg' },
  hub:       { name: 'Smart Home Hub',     tagline: 'One secure mesh for every device',                              category: 'Connected home',    specs: ['Thread + Matter protocol', 'Local-first control', 'Energy monitoring', 'No subscription'],                  image: 'device-hub.jpg' },
};

const PLANETS = {
  'kepler-452b':  { name: 'Kepler-452b',  tagline: "Earth's largest cousin — 1,402 light-years away",              category: 'Super-Earth',         price: 'CR 4.2B', specs: ['5.0 M⊕ mass, 1.63 R⊕ diameter', 'Orbital period: 384.8 days', 'Surface temp: -2 to 42°C', 'Confirmed habitable zone'],     image: 'kepler-452b.jpg' },
  'trappist-1e':  { name: 'TRAPPIST-1e',  tagline: 'The last uncharted ocean — 39.5 light-years away',             category: 'Ocean World',         price: 'CR 3.5B', specs: ['0.77 M⊕ mass, 0.91 R⊕ diameter', '100% ocean coverage', 'Surface temp: -20 to 10°C', '7-planet system rights'],         image: 'trappist-1e.jpg' },
  'gliese-667cc': { name: 'Gliese 667Cc', tagline: 'Three suns. One world. Yours to claim.',                       category: 'Premium Super-Earth', price: 'CR 6.1B', specs: ['3.8 M⊕ mass, 1.5 R⊕ diameter', 'Triple-star host system', 'Earth Similarity Index: 0.78', 'Surface temp: -5 to 28°C'], image: 'gliese-667cc.png' },
  'hd-40307g':    { name: 'HD 40307g',    tagline: 'The jewel of the K-dwarf belt — 42 light-years away',          category: 'Mini-Neptune',        price: 'CR 2.8B', specs: ['7.1 M⊕ mass, 2.1 R⊕ diameter', 'H₂-He atmospheric harvesting rights', 'Orbital period: 197.8 days', 'Closest mini-neptune'], image: 'hd-40307g.png' },
  'tau-ceti-e':   { name: 'Tau Ceti e',   tagline: 'Endless amber dunes — 11.9 light-years away',                  category: 'Desert World',        price: 'CR 2.3B', specs: ['3.93 M⊕ mass, 1.55 R⊕ diameter', 'Most Sun-like star in catalog', 'Geological age: 5.8 billion years', '5-planet observation rights'], image: 'tau-ceti-e.png' },
  'wolf-1061c':   { name: 'Wolf 1061c',   tagline: 'Raw power — closest world at 13.8 light-years',                category: 'Volcanic World',      price: 'CR 1.9B', specs: ['4.3 M⊕ mass, 1.6 R⊕ diameter', 'Active Type IV geology', 'Best-value entry listing', 'Geothermal resource rights'],     image: 'wolf-1061c.png' },
};

export { PRODUCTS, PLANETS };

export async function sendProductEmail(productKey, toList, host = '') {
  const product  = PRODUCTS[productKey] || PLANETS[productKey];
  const isPlanet = !!PLANETS[productKey];
  if (!product) throw new Error(`Unknown product key: ${productKey}`);

  const systemPrompt = isPlanet
    ? `You are a luxury real-estate copywriter for PLANETEX. Return ONLY valid JSON: { "pitch": "...", "why_now": "...", "best_for": ["...","...","..."], "cta": "..." }`
    : `You are a product marketing writer for Tester.io. Return ONLY valid JSON: { "pitch": "...", "why_now": "...", "best_for": ["...","...","..."], "cta": "..." }`;

  const userContent = isPlanet
    ? `Write acquisition email for ${product.name}. Tagline: ${product.tagline}. Category: ${product.category}. Data: ${product.specs.join(', ')}. Price: ${product.price}.`
    : `Write product email for ${product.name}. Tagline: ${product.tagline}. Category: ${product.category}. Specs: ${product.specs.join(', ')}.`;

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
  const protocol = (host.includes('localhost') ? 'http' : 'https');
  const imageUrl = product.image && host ? `${protocol}://${host}/images/${product.image}` : null;
  const html    = renderProductEmail(product, content, isPlanet, imageUrl);
  const subject = `${isPlanet ? 'Planet Listing' : 'Product Spotlight'}: ${product.name}`;

  const ids = [];
  for (let i = 0; i < toList.length; i += 50) {
    const batch = toList.slice(i, i + 50);
    const to    = batch.length === 1 ? batch[0] : batch;
    const { data, error } = await resend.emails.send({ from: FROM_EMAIL, to, subject, html });
    if (error) throw new Error(error.message);
    ids.push(data.id);
  }
  return { ok: true, output: `Sent: ${product.name} to ${toList.length} recipient(s).` };
}

function renderProductEmail(product, content, isPlanet, imageUrl) {
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
<head><meta charset="UTF-8" /><title>${product.name}</title></head>
<body style="margin:0; padding:0; background:#060810;">

<table width="100%" cellpadding="0" cellspacing="0" style="background:#060810; padding:32px 16px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px; width:100%;">

  <tr><td style="background:#090b13; border:1px solid #1a1f2e; border-bottom:none; border-radius:10px 10px 0 0; padding:14px 32px;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="font-family:Helvetica,Arial,sans-serif; font-size:10px; font-weight:700; letter-spacing:3px; text-transform:uppercase; color:#c6a559;">${brandLabel}</td>
      <td align="right" style="font-family:Helvetica,Arial,sans-serif; font-size:10px; color:#2e3650; letter-spacing:1.5px; text-transform:uppercase;">${product.category}</td>
    </tr></table>
  </td></tr>

  ${imageUrl ? `
  <tr><td style="border-left:1px solid #1a1f2e; border-right:1px solid #1a1f2e; padding:0; line-height:0; font-size:0;">
    <img src="${imageUrl}" alt="${product.name}" width="600"
         style="width:100%; height:300px; object-fit:cover; object-position:center; display:block;" />
  </td></tr>
  <tr><td style="height:3px; background:linear-gradient(90deg,#c6a559,#f0c060,#c6a559);"></td></tr>` : `
  <tr><td style="height:3px; background:linear-gradient(90deg,#c6a559,#f0c060,#c6a559);"></td></tr>`}

  <tr><td style="background:#090b13; border-left:1px solid #1a1f2e; border-right:1px solid #1a1f2e; padding:28px 32px 24px;">
    <div style="font-family:Georgia,'Times New Roman',serif; font-size:34px; font-weight:700; color:#ffffff; line-height:1.1; margin-bottom:10px; letter-spacing:-0.5px;">${product.name}</div>
    <div style="font-family:Helvetica,Arial,sans-serif; font-size:15px; color:#6a7896; line-height:1.6;">${product.tagline}</div>
    ${priceBlock}
  </td></tr>

  <tr><td style="background:#0c0f18; border:1px solid #1a1f2e; border-top:none; padding:26px 32px;">
    <div style="font-family:Georgia,'Times New Roman',serif; font-size:15px; color:#c0c8d8; line-height:1.95; font-style:italic;">${content.pitch}</div>
  </td></tr>

  <tr><td style="background:#090b13; border:1px solid #1a1f2e; border-top:none; padding:24px 32px;">
    <div style="font-family:Helvetica,Arial,sans-serif; font-size:10px; font-weight:700; letter-spacing:3px; text-transform:uppercase; color:#c6a559; padding-bottom:12px; margin-bottom:4px; border-bottom:1px solid #141824;">${isPlanet ? 'PLANETARY DATA' : 'KEY SPECIFICATIONS'}</div>
    <table width="100%" cellpadding="0" cellspacing="0">${specRows}</table>
  </td></tr>

  <tr><td style="background:#0c0f18; border:1px solid #1a1f2e; border-top:none; padding:22px 32px;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="background:#0a0d18; border:1px solid #1e2535; border-left:3px solid #c6a559; border-radius:0 6px 6px 0; padding:16px 20px;">
        <div style="font-family:Helvetica,Arial,sans-serif; font-size:10px; font-weight:700; letter-spacing:2.5px; text-transform:uppercase; color:#c6a559; margin-bottom:8px;">${isPlanet ? 'ACQUISITION WINDOW' : 'WHY NOW'}</div>
        <div style="font-family:Helvetica,Arial,sans-serif; font-size:14px; color:#d0d8e8; line-height:1.7;">${content.why_now}</div>
      </td>
    </tr></table>
  </td></tr>

  <tr><td style="background:#090b13; border:1px solid #1a1f2e; border-top:none; padding:20px 32px 22px;">
    <div style="font-family:Helvetica,Arial,sans-serif; font-size:10px; font-weight:700; letter-spacing:3px; text-transform:uppercase; color:#c6a559; margin-bottom:12px;">IDEAL FOR</div>
    <div>${bestForItems}</div>
  </td></tr>

  <tr><td style="background:#0c0f18; border:1px solid #1a1f2e; border-top:none; padding:28px 32px; text-align:center;">
    <a href="${product.url || '#'}" style="display:inline-block; padding:15px 44px; background:linear-gradient(135deg,#c6a559,#e6b979); color:#060810; font-family:Helvetica,Arial,sans-serif; font-size:12px; font-weight:800; text-decoration:none; border-radius:4px; letter-spacing:2px; text-transform:uppercase;">${content.cta} &rarr;</a>
  </td></tr>

  <tr><td style="background:#060810; border:1px solid #1a1f2e; border-top:none; border-radius:0 0 10px 10px; padding:18px 32px; text-align:center;">
    <div style="height:1px; background:linear-gradient(90deg,transparent,#1a1f2e,transparent); margin-bottom:14px;"></div>
    <div style="font-family:Helvetica,Arial,sans-serif; font-size:10px; color:#232b3e; letter-spacing:2px; text-transform:uppercase;">${isPlanet ? 'PLANETEX' : 'TESTER.IO'} &nbsp;&bull;&nbsp; POWERED BY GROQ &amp; RESEND</div>
  </td></tr>

  <tr><td style="height:2px; background:linear-gradient(90deg,transparent,#c6a559,transparent); border-radius:0 0 4px 4px;"></td></tr>

</table>
</td></tr>
</table>

</body></html>`;
}
