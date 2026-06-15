import { groq, resend, FROM_EMAIL } from './helpers.js';

function renderBriefingEmail(data, dateStr) {
  const highlightCards = data.highlights.map(h => `
    <tr>
      <td style="padding:0 0 12px 0;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="background:#0f1219; border:1px solid #252b38; border-left:3px solid #c6a559; border-radius:6px; padding:18px 20px;">
              <div style="font-family:Helvetica,Arial,sans-serif; font-size:14px; font-weight:700; color:#f0f2f5; margin-bottom:6px; line-height:1.3;">${h.title}</div>
              <div style="font-family:Helvetica,Arial,sans-serif; font-size:13px; color:#8b9197; line-height:1.7;">${h.summary}</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>`).join('');

  const focusItems = data.focus.map((f, i) => `
    <tr>
      <td style="padding:0 0 10px 0;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td width="36" valign="top" style="padding-top:2px;">
              <div style="width:26px; height:26px; background:linear-gradient(135deg,#c6a559,#e6b979); border-radius:50%; text-align:center; line-height:26px; font-family:Helvetica,Arial,sans-serif; font-size:12px; font-weight:800; color:#0a0c10;">${i + 1}</div>
            </td>
            <td style="font-family:Helvetica,Arial,sans-serif; font-size:14px; color:#e8eaed; line-height:1.6; padding-left:4px;">${f}</td>
          </tr>
        </table>
      </td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Morning Briefing</title>
</head>
<body style="margin:0; padding:0; background:#070910;">

<table width="100%" cellpadding="0" cellspacing="0" style="background:#070910; padding:32px 16px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px; width:100%;">

  <!-- TOP ACCENT BAR -->
  <tr><td style="height:4px; background:linear-gradient(90deg,#c6a559,#f0c060,#c6a559); border-radius:4px 4px 0 0;"></td></tr>

  <!-- HEADER -->
  <tr><td style="background:#0c0e14; border-left:1px solid #1e2535; border-right:1px solid #1e2535; padding:36px 40px 28px;">
    <div style="font-family:Helvetica,Arial,sans-serif; font-size:11px; font-weight:700; letter-spacing:3px; text-transform:uppercase; color:#c6a559; margin-bottom:14px;">&#9788; &nbsp;Morning Briefing</div>
    <div style="font-family:Georgia,serif; font-size:32px; font-weight:700; color:#ffffff; line-height:1.15; margin-bottom:14px;">${dateStr}</div>
    <div style="height:1px; background:linear-gradient(90deg,#c6a55940,transparent); margin-bottom:16px;"></div>
    <div style="font-family:Helvetica,Arial,sans-serif; font-size:15px; color:#a0a8b4; line-height:1.75;">${data.greeting}</div>
  </td></tr>

  <!-- TODAY'S FOCUS -->
  <tr><td style="background:#0a0c12; border-left:1px solid #1e2535; border-right:1px solid #1e2535; border-top:1px solid #1e2535; padding:28px 40px;">
    <div style="font-family:Helvetica,Arial,sans-serif; font-size:10px; font-weight:700; letter-spacing:3px; text-transform:uppercase; color:#c6a559; margin-bottom:20px;">&#9654; &nbsp;Today's Focus</div>
    <table width="100%" cellpadding="0" cellspacing="0">${focusItems}</table>
  </td></tr>

  <!-- WHAT'S HAPPENING -->
  <tr><td style="background:#0c0e14; border-left:1px solid #1e2535; border-right:1px solid #1e2535; border-top:1px solid #1e2535; padding:28px 40px;">
    <div style="font-family:Helvetica,Arial,sans-serif; font-size:10px; font-weight:700; letter-spacing:3px; text-transform:uppercase; color:#c6a559; margin-bottom:20px;">&#9670; &nbsp;What's Happening</div>
    <table width="100%" cellpadding="0" cellspacing="0">${highlightCards}</table>
  </td></tr>

  <!-- TIP OF THE DAY -->
  <tr><td style="background:#0a0c12; border-left:1px solid #1e2535; border-right:1px solid #1e2535; border-top:1px solid #1e2535; padding:24px 40px;">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="background:linear-gradient(135deg,#1a1508,#120e05); border:1px solid #3a2e10; border-radius:8px; padding:20px 24px;">
          <div style="font-family:Helvetica,Arial,sans-serif; font-size:10px; font-weight:700; letter-spacing:3px; text-transform:uppercase; color:#c6a559; margin-bottom:10px;">&#9998; &nbsp;Tip of the Day</div>
          <div style="font-family:Helvetica,Arial,sans-serif; font-size:14px; color:#d4c9a8; line-height:1.75;">${data.tip}</div>
        </td>
      </tr>
    </table>
  </td></tr>

  <!-- QUOTE -->
  <tr><td style="background:#0c0e14; border-left:1px solid #1e2535; border-right:1px solid #1e2535; border-top:1px solid #1e2535; padding:32px 40px; text-align:center;">
    <div style="font-family:Georgia,serif; font-size:42px; color:#c6a559; line-height:1; margin-bottom:4px; opacity:0.6;">&ldquo;</div>
    <div style="font-family:Georgia,serif; font-size:16px; font-style:italic; color:#d8dce4; line-height:1.8; margin-bottom:16px;">${data.quote.text}</div>
    <div style="display:inline-block; width:40px; height:1px; background:#c6a559; margin-bottom:12px;"></div>
    <div style="font-family:Helvetica,Arial,sans-serif; font-size:12px; font-weight:700; letter-spacing:2px; text-transform:uppercase; color:#c6a559;">${data.quote.author}</div>
  </td></tr>

  <!-- FOOTER -->
  <tr><td style="background:#080a0f; border:1px solid #1e2535; border-top:none; border-radius:0 0 6px 6px; padding:24px 40px; text-align:center;">
    <div style="font-family:Helvetica,Arial,sans-serif; font-size:14px; color:#6b7280; line-height:1.7; margin-bottom:16px;">${data.closing}</div>
    <div style="height:1px; background:linear-gradient(90deg,transparent,#1e2535,transparent); margin-bottom:16px;"></div>
    <div style="font-family:Helvetica,Arial,sans-serif; font-size:11px; color:#3a4050; letter-spacing:1px;">TESTER.IO &nbsp;&bull;&nbsp; MORNING BRIEFING &nbsp;&bull;&nbsp; POWERED BY GROQ</div>
  </td></tr>

  <!-- BOTTOM ACCENT -->
  <tr><td style="height:3px; background:linear-gradient(90deg,transparent,#c6a559,transparent);"></td></tr>

</table>
</td></tr>
</table>

</body>
</html>`;
}

export async function sendBriefingEmail(toList) {
  const now     = new Date();
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const subject = `Morning Briefing: ${now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`;

  const completion = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `You are a sharp, concise morning briefing assistant. Return ONLY valid JSON:
{ "greeting": "...", "highlights": [{"title":"...","summary":"..."},{"title":"...","summary":"..."},{"title":"...","summary":"..."}], "focus": ["...","...","..."], "tip": "...", "quote": {"text":"...","author":"..."}, "closing": "..." }`,
      },
      { role: 'user', content: `Today is ${dateStr}. Generate a morning briefing for a tech startup founder building a smart wearable product website.` },
    ],
    max_tokens: 900,
    temperature: 0.8,
  });

  const content = JSON.parse(completion.choices[0].message.content);
  const html    = renderBriefingEmail(content, dateStr);

  const ids = [];
  for (let i = 0; i < toList.length; i += 50) {
    const batch = toList.slice(i, i + 50);
    const to    = batch.length === 1 ? batch[0] : batch;
    const { data, error } = await resend.emails.send({ from: FROM_EMAIL, to, subject, html });
    if (error) throw new Error(error.message);
    ids.push(data.id);
  }
  return { ok: true, output: `Briefing sent to ${toList.length} recipient(s).` };
}
