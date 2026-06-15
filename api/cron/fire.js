import { supabase, resolveRecipients, computeNextRun } from '../_lib/helpers.js';
import { sendBriefingEmail } from '../_lib/send-briefing.js';
import { sendProductEmail }  from '../_lib/send-product.js';

// Called by Vercel Cron. Protected by CRON_SECRET env var.
export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const now = new Date();
  const { data: due, error } = await supabase
    .from('scheduled_emails')
    .select('*')
    .eq('is_active', true)
    .lte('next_run', now.toISOString());

  if (error) return res.status(500).json({ ok: false, error: error.message });
  if (!due?.length) return res.json({ ok: true, fired: 0 });

  const host = req.headers.host || '';
  let fired = 0;

  for (const s of due) {
    try {
      const recipients = await resolveRecipients(s.recipient_type, s.recipient_emails).catch(() => []);
      const toList = recipients ?? [];
      if (!toList.length) continue;

      if (s.type === 'briefing') {
        await sendBriefingEmail(toList);
      } else if (s.type === 'product') {
        await sendProductEmail(s.product_key, toList, host);
      } else {
        continue;
      }

      fired++;

      if (s.schedule_type === 'once') {
        await supabase.from('scheduled_emails')
          .update({ is_active: false, last_run: now.toISOString() })
          .eq('id', s.id);
      } else {
        const nextRun = computeNextRun(s.schedule_type, s.send_hour, s.send_minute, s.send_weekday);
        await supabase.from('scheduled_emails')
          .update({ last_run: now.toISOString(), next_run: nextRun.toISOString() })
          .eq('id', s.id);
      }
    } catch (e) {
      console.error(`[cron] Failed: "${s.label}":`, e.message);
    }
  }

  res.json({ ok: true, fired });
}
