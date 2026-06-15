import { supabase, requireAuth, cors, computeNextRun } from '../_lib/helpers.js';

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (!requireAuth(req, res)) return;

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('scheduled_emails')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.json({ ok: true, data });
  }

  if (req.method === 'POST') {
    const {
      label, type, product_key,
      schedule_type,
      send_hour = 8, send_minute = 0, send_weekday,
      run_once_at,
      recipient_type   = 'all',
      recipient_emails = null,
    } = req.body || {};

    if (!label || !type || !schedule_type) {
      return res.status(400).json({ ok: false, error: 'label, type, and schedule_type are required' });
    }
    if (type === 'product' && !product_key) {
      return res.status(400).json({ ok: false, error: 'product_key required for product type' });
    }

    let next_run;
    if (schedule_type === 'once') {
      if (!run_once_at) return res.status(400).json({ ok: false, error: 'run_once_at required for once schedule' });
      next_run = new Date(run_once_at).toISOString();
    } else {
      next_run = computeNextRun(
        schedule_type,
        Number(send_hour),
        Number(send_minute),
        send_weekday != null ? Number(send_weekday) : undefined,
      ).toISOString();
    }

    const { data, error } = await supabase
      .from('scheduled_emails')
      .insert({ label, type, product_key, schedule_type, send_hour, send_minute, send_weekday, run_once_at, next_run, recipient_type, recipient_emails })
      .select()
      .single();

    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.json({ ok: true, data });
  }

  res.status(405).end();
}
