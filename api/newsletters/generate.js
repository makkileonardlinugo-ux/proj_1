import { groq, requireAuth, cors } from '../_lib/helpers.js';

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (!requireAuth(req, res)) return;
  if (req.method !== 'POST') return res.status(405).end();

  const { prompt } = req.body || {};
  if (!prompt) return res.status(400).json({ ok: false, error: 'prompt is required' });

  try {
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You are an expert email copywriter for Tester.io, a smart wearable tech brand (products: Smart Watch Pro, Smart Glasses, Smart Earbuds, Smart Ring, Smart Assistant, Smart Home Hub) and PLANETEX (luxury exoplanet real estate).
Generate a professional newsletter as clean, readable HTML with inline styles.
Return ONLY valid JSON with this exact shape:
{
  "subject": "compelling email subject line under 60 characters",
  "preview_text": "inbox preview snippet under 100 characters",
  "html": "the full email body HTML with inline styles — white background #ffffff, Arial/Helvetica font, proper heading hierarchy, paragraph spacing, and a styled CTA button. No <html>/<body>/<head> tags — start with a <div style='padding:32px 24px;font-family:Arial,sans-serif;...'>"
}`,
        },
        { role: 'user', content: prompt },
      ],
      max_tokens: 2500,
      temperature: 0.75,
    });

    const result = JSON.parse(completion.choices[0].message.content);
    res.json({
      ok: true,
      subject:      result.subject      || '',
      preview_text: result.preview_text || '',
      html:         result.html         || '',
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}
