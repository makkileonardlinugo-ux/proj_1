import { supabase, GOOGLE_SHEETS_URL, cors } from './_lib/helpers.js';

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).end();

  const { name, email, message } = req.body || {};
  const subscribed = req.body?.subscribed === 'true';

  if (!name || !email || !message) {
    return res.status(400).json({ ok: false, error: 'name, email, and message are required' });
  }

  const [supabaseResult, sheetsResult] = await Promise.allSettled([
    supabase.from('test_form').insert({ name, email, message, subscribed }),
    fetch(GOOGLE_SHEETS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, message, subscribed }),
      redirect: 'follow',
    }),
  ]);

  const supabaseError = supabaseResult.status === 'rejected'
    ? supabaseResult.reason
    : supabaseResult.value?.error;

  if (supabaseError) {
    return res.status(500).json({ ok: false, error: supabaseError.message });
  }

  res.json({ ok: true });
}
