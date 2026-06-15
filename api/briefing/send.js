import { groq, resend, FROM_EMAIL, requireAuth, cors, resolveRecipients } from '../_lib/helpers.js';

// ── Email template ────────────────────────────────────────────────────────────

function renderBriefingEmail(data, dateStr) {
  const highlightRows = data.highlights.map(h => `
    <tr>
      <td style="padding:14px 0; border-bottom:1px solid #1e2129;">
        <div style="font-size:0.85rem; font-weight:700; color:#f2f4f5; margin-bottom:4px;">${h.title}</div>
        <div style="font-size:0.82rem; color:#8b9197; line-height:1.6;">${h.summary}</div>
      </td>
    </tr>`).join('');

  const focusItems = data.focus.map((f, i) => `
    <tr>
      <td style="padding:10px 0; border-bottom:1px solid #1e2129;">
        <span style="color:#c6a559; font-weight:700; margin-right:10px;">${i + 1}.</span>
        <span style="font-size:0.85rem; color:#f2f4f5;">${f}</span>
      </td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Morning Briefing</title>
</head>
<body style="margin:0; padding:0; background:#05070a; font-family:'Helvetica Neue', Helvetica, Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#05070a; padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px; width:100%;">
        <tr>
          <td style="background:#0a0c10; border:1px solid #1e2129; border-radius:16px 16px 0 0; padding:32px 36px 24px;">
            <div style="font-size:0.7rem; font-weight:700; letter-spacing:0.2em; text-transform:uppercase; color:#c6a559; margin-bottom:10px;">Morning Briefing</div>
            <div style="font-size:1.5rem; font-weight:700; color:#f2f4f5; line-height:1.2; margin-bottom:6px;">${dateStr}</div>
            <div style="font-size:0.9rem; color:#8b9197; line-height:1.6;">${data.greeting}</div>
          </td>
        </tr>
        <tr><td style="height:2px; background:linear-gradient(90deg, #c6a559, #e6b979, #c6a559);"></td></tr>
        <tr>
          <td style="background:#0a0c10; border-left:1px solid #1e2129; border-right:1px solid #1e2129; padding:28px 36px 20px;">
            <div style="font-size:0.7rem; font-weight:700; letter-spacing:0.18em; text-transform:uppercase; color:#c6a559; margin-bottom:16px;">Today's Focus</div>
            <table width="100%" cellpadding="0" cellspacing="0">${focusItems}</table>
          </td>
        </tr>
        <tr>
          <td style="background:#0d0f15; border:1px solid #1e2129; border-top:none; padding:28px 36px 20px;">
            <div style="font-size:0.7rem; font-weight:700; letter-spacing:0.18em; text-transform:uppercase; color:#c6a559; margin-bottom:16px;">What's Happening</div>
            <table width="100%" cellpadding="0" cellspacing="0">${highlightRows}</table>
          </td>
        </tr>
        <tr>
          <td style="background:#0a0c10; border:1px solid #1e2129; border-top:none; padding:24px 36px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="padding:16px 20px; background:#111318; border-left:3px solid #c6a559; border-radius:4px;">
                  <div style="font-size:0.68rem; font-weight:700; letter-spacing:0.16em; text-transform:uppercase; color:#c6a559; margin-bottom:6px;">Tip of the Day</div>
                  <div style="font-size:0.85rem; color:#f2f4f5; line-height:1.6;">${data.tip}</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="background:#0d0f15; border:1px solid #1e2129; border-top:none; padding:24px 36px; text-align:center;">
            <div style="font-size:1rem; font-style:italic; color:#f2f4f5; line-height:1.7; margin-bottom:8px;">&ldquo;${data.quote.text}&rdquo;</div>
            <div style="font-size:0.78rem; color:#c6a559; font-weight:600; letter-spacing:0.08em;">&mdash; ${data.quote.author}</div>
          </td>
        </tr>
        <tr>
          <td style="background:#080a0e; border:1px solid #1e2129; border-top:none; border-radius:0 0 16px 16px; padding:20px 36px; text-align:center;">
            <div style="font-size:0.82rem; color:#8b9197; line-height:1.6; margin-bottom:12px;">${data.closing}</div>
            <div style="font-size:0.72rem; color:#3e4248; letter-spacing:0.08em;">Tester.io Morning Briefing &bull; Powered by Groq &amp; Resend</div>
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

  const { recipient_type, recipient_emails } = req.body || {};

  try {
    const recipients = await resolveRecipients(recipient_type, recipient_emails);
    if (recipients !== null && !recipients.length) {
      return res.status(400).json({ ok: false, error: 'No recipients found for the selected option.' });
    }

    const toList = recipients ?? [];

    const now      = new Date();
    const dateStr  = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const subject  = `Morning Briefing: ${now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`;

    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You are a sharp, concise morning briefing assistant.
Return ONLY valid JSON matching this exact shape:
{
  "greeting": "one upbeat sentence welcoming the user to the day",
  "highlights": [
    { "title": "short headline", "summary": "1-2 sentence summary" },
    { "title": "short headline", "summary": "1-2 sentence summary" },
    { "title": "short headline", "summary": "1-2 sentence summary" }
  ],
  "focus": [
    "concise action-oriented task or goal",
    "concise action-oriented task or goal",
    "concise action-oriented task or goal"
  ],
  "tip": "one practical productivity tip for the day",
  "quote": { "text": "an inspiring quote", "author": "author name" },
  "closing": "one short motivating closing line"
}`,
        },
        {
          role: 'user',
          content: `Today is ${dateStr}. Generate a morning briefing for a tech startup founder building a smart wearable product website.`,
        },
      ],
      max_tokens: 900,
      temperature: 0.8,
    });

    const content = JSON.parse(completion.choices[0].message.content);
    const html    = renderBriefingEmail(content, dateStr);

    const finalList = toList.length ? toList : null;
    if (!finalList) {
      return res.status(400).json({ ok: false, error: 'No recipients configured.' });
    }

    const { data, error } = await resend.emails.send({
      from:    FROM_EMAIL,
      to:      finalList.length === 1 ? finalList[0] : finalList,
      subject,
      html,
    });

    if (error) throw new Error(error.message);
    res.json({ ok: true, output: `Briefing sent. ID: ${data.id}` });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}
