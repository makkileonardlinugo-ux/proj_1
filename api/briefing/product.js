import { requireAuth, cors, resolveRecipients } from '../_lib/helpers.js';
import { sendProductEmail } from '../_lib/send-product.js';

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (!requireAuth(req, res)) return;
  if (req.method !== 'POST') return res.status(405).end();

  const { product: productKey, recipient_type, recipient_emails } = req.body || {};
  if (!productKey) return res.status(400).json({ ok: false, error: 'product key is required' });

  try {
    const recipients = await resolveRecipients(recipient_type, recipient_emails);
    if (recipients !== null && !recipients.length) {
      return res.status(400).json({ ok: false, error: 'No recipients found for the selected option.' });
    }

    const toList = recipients ?? [];
    if (!toList.length) return res.status(400).json({ ok: false, error: 'No recipients configured.' });

    const host   = req.headers.host || '';
    const result = await sendProductEmail(productKey, toList, host);
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}
