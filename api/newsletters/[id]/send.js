import { supabase, resend, FROM_EMAIL, requireAuth, cors, resolveRecipients } from '../../_lib/helpers.js';

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (!requireAuth(req, res)) return;
  if (req.method !== 'POST') return res.status(405).end();

  const { id } = req.query;
  const { recipient_type, recipient_emails } = req.body || {};

  const { data: newsletter, error: nErr } = await supabase
    .from('newsletters')
    .select('*')
    .eq('id', id)
    .single();
  if (nErr) return res.status(404).json({ ok: false, error: 'Newsletter not found' });

  let sendList;
  try {
    const resolved = await resolveRecipients(recipient_type, recipient_emails);
    if (resolved !== null) {
      sendList = resolved.map(email => ({ email }));
    } else {
      const { data: subs, error: sErr } = await supabase
        .from('test_form').select('email').eq('subscribed', true);
      if (sErr) return res.status(500).json({ ok: false, error: sErr.message });
      sendList = subs;
    }
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }

  let sent = 0, failed = 0;
  for (const sub of sendList) {
    const { error } = await resend.emails.send({
      from:    FROM_EMAIL,
      to:      sub.email,
      subject: newsletter.subject,
      html:    newsletter.body,
    });
    if (error) { failed++; } else { sent++; }
  }

  await supabase
    .from('newsletters')
    .update({ sent_at: new Date().toISOString() })
    .eq('id', id);

  res.json({ ok: true, sent, failed });
}
