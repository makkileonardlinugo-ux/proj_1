import { supabase, requireAuth, cors } from './_lib/helpers.js';

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (!requireAuth(req, res)) return;
  if (req.method !== 'GET') return res.status(405).end();

  const { data, error } = await supabase
    .from('test_form')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ ok: false, error: error.message });
  res.json({ ok: true, data });
}
