import { groq, resend, FROM_EMAIL } from './helpers.js';

function renderBriefingEmail(data, dateStr) {
  const cardAccents = ['#c6a559', '#5c7cfa', '#34d399'];

  const highlightCards = data.highlights.map((h, i) => `
    <tr>
      <td style="padding:0 0 10px 0;">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="background:#0a0d18; border:1px solid #1a1f2e; border-left:3px solid ${cardAccents[i % cardAccents.length]}; border-radius:0 6px 6px 0; padding:16px 18px;">
            <div style="font-family:Helvetica,Arial,sans-serif; font-size:13px; font-weight:700; color:#e0e6f0; margin-bottom:6px; line-height:1.3;">${h.title}</div>
            <div style="font-family:Helvetica,Arial,sans-serif; font-size:12px; color:#5a6a84; line-height:1.75;">${h.summary}</div>
          </td>
        </tr></table>
      </td>
    </tr>`).join('');

  const focusItems = data.focus.map((f, i) => `
    <tr>
      <td style="padding:0 0 10px 0;">
        <table cellpadding="0" cellspacing="0"><tr>
          <td width="30" valign="top">
            <div style="width:22px; height:22px; background:linear-gradient(135deg,#c6a559,#e6b979); border-radius:4px; text-align:center; line-height:22px; font-family:Helvetica,Arial,sans-serif; font-size:11px; font-weight:800; color:#060810;">${i + 1}</div>
          </td>
          <td style="font-family:Helvetica,Arial,sans-serif; font-size:14px; color:#c0c8d8; line-height:1.6; padding-top:2px;">${f}</td>
        </tr></table>
      </td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Morning Briefing</title>
</head>
<body style="margin:0; padding:0; background:#060810;">

<table width="100%" cellpadding="0" cellspacing="0" style="background:#060810; padding:32px 16px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px; width:100%;">

  <!-- TOP ACCENT -->
  <tr><td style="height:3px; background:linear-gradient(90deg,#c6a559,#f0c060,#c6a559); border-radius:3px 3px 0 0;"></td></tr>

  <!-- MASTHEAD -->
  <tr><td style="background:#090b13; border:1px solid #1a1f2e; border-top:none; padding:36px 36px 30px;">
    <div style="font-family:Helvetica,Arial,sans-serif; font-size:10px; font-weight:700; letter-spacing:4px; text-transform:uppercase; color:#c6a559; margin-bottom:18px;">TESTER.IO &nbsp;&#9670;&nbsp; MORNING BRIEFING</div>
    <div style="font-family:Georgia,'Times New Roman',serif; font-size:38px; font-weight:700; color:#ffffff; line-height:1.05; margin-bottom:18px; letter-spacing:-1px;">${dateStr}</div>
    <div style="height:1px; background:linear-gradient(90deg,#c6a55950,transparent); margin-bottom:16px;"></div>
    <div style="font-family:Helvetica,Arial,sans-serif; font-size:15px; color:#6a7896; line-height:1.8;">${data.greeting}</div>
  </td></tr>

  <!-- TODAY'S PRIORITIES -->
  <tr><td style="background:#0c0f18; border:1px solid #1a1f2e; border-top:none; padding:26px 36px;">
    <div style="font-family:Helvetica,Arial,sans-serif; font-size:10px; font-weight:700; letter-spacing:3px; text-transform:uppercase; color:#c6a559; padding-bottom:12px; margin-bottom:16px; border-bottom:1px solid #141824;">TODAY'S PRIORITIES</div>
    <table width="100%" cellpadding="0" cellspacing="0">${focusItems}</table>
  </td></tr>

  <!-- INTELLIGENCE BRIEF -->
  <tr><td style="background:#090b13; border:1px solid #1a1f2e; border-top:none; padding:26px 36px;">
    <div style="font-family:Helvetica,Arial,sans-serif; font-size:10px; font-weight:700; letter-spacing:3px; text-transform:uppercase; color:#c6a559; padding-bottom:12px; margin-bottom:16px; border-bottom:1px solid #141824;">INTELLIGENCE BRIEF</div>
    <table width="100%" cellpadding="0" cellspacing="0">${highlightCards}</table>
  </td></tr>

  <!-- EDGE TIP -->
  <tr><td style="background:#0c0f18; border:1px solid #1a1f2e; border-top:none; padding:22px 36px;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="background:linear-gradient(135deg,#1a1508,#110f07); border:1px solid #2a2010; border-radius:6px; padding:18px 22px;">
        <div style="font-family:Helvetica,Arial,sans-serif; font-size:10px; font-weight:700; letter-spacing:3px; text-transform:uppercase; color:#c6a559; margin-bottom:8px;">EDGE &nbsp;&#9998;</div>
        <div style="font-family:Georgia,'Times New Roman',serif; font-size:14px; color:#d4c9a8; line-height:1.85; font-style:italic;">${data.tip}</div>
      </td>
    </tr></table>
  </td></tr>

  <!-- QUOTE -->
  <tr><td style="background:#090b13; border:1px solid #1a1f2e; border-top:none; padding:32px 36px; text-align:center;">
    <div style="font-family:Georgia,'Times New Roman',serif; font-size:52px; color:#c6a559; line-height:0.6; margin-bottom:14px; opacity:0.4;">&ldquo;</div>
    <div style="font-family:Georgia,'Times New Roman',serif; font-size:17px; font-style:italic; color:#d0d8e8; line-height:1.9; margin-bottom:18px;">${data.quote.text}</div>
    <div style="display:inline-block; height:1px; width:36px; background:#c6a559; margin-bottom:12px; vertical-align:middle;"></div>
    <br />
    <div style="font-family:Helvetica,Arial,sans-serif; font-size:11px; font-weight:700; letter-spacing:2.5px; text-transform:uppercase; color:#c6a559;">${data.quote.author}</div>
  </td></tr>

  <!-- FOOTER -->
  <tr><td style="background:#060810; border:1px solid #1a1f2e; border-top:none; border-radius:0 0 8px 8px; padding:24px 36px; text-align:center;">
    <div style="font-family:Helvetica,Arial,sans-serif; font-size:14px; color:#4a5570; line-height:1.7; margin-bottom:16px;">${data.closing}</div>
    <div style="height:1px; background:linear-gradient(90deg,transparent,#1a1f2e,transparent); margin-bottom:14px;"></div>
    <div style="font-family:Helvetica,Arial,sans-serif; font-size:10px; color:#232b3e; letter-spacing:2px; text-transform:uppercase;">TESTER.IO &nbsp;&bull;&nbsp; MORNING BRIEFING &nbsp;&bull;&nbsp; POWERED BY GROQ</div>
  </td></tr>

  <!-- BOTTOM ACCENT -->
  <tr><td style="height:2px; background:linear-gradient(90deg,transparent,#c6a559,transparent); border-radius:0 0 4px 4px;"></td></tr>

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
