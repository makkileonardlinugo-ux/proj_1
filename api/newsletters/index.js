import { supabase, requireAuth, cors } from '../_lib/helpers.js';

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (!requireAuth(req, res)) return;

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('newsletters')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.json({ ok: true, data });
  }

  if (req.method === 'POST') {
    const { subject, preview_text, body } = req.body || {};
    if (!subject || !body) {
      return res.status(400).json({ ok: false, error: 'subject and body are required' });
    }
    const { data, error } = await supabase
      .from('newsletters')
      .insert({ subject, preview_text, body })
      .select()
      .single();
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.json({ ok: true, data });
  }

  res.status(405).end();
}
