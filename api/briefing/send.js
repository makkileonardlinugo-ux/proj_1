import { requireAuth, cors, resolveRecipients } from '../_lib/helpers.js';
import { sendBriefingEmail } from '../_lib/send-briefing.js';

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
    if (!toList.length) return res.status(400).json({ ok: false, error: 'No recipients configured.' });

    const result = await sendBriefingEmail(toList);
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}
