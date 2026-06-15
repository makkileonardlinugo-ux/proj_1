import { supabase, requireAuth, cors } from '../_lib/helpers.js';

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (!requireAuth(req, res)) return;
  if (req.method !== 'DELETE') return res.status(405).end();

  const { id } = req.query;
  const { error } = await supabase
    .from('scheduled_emails')
    .delete()
    .eq('id', id);

  if (error) return res.status(500).json({ ok: false, error: error.message });
  res.json({ ok: true });
}
