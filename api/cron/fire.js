import { supabase, resolveRecipients, computeNextRun } from '../_lib/helpers.js';

// Called by Vercel Cron every 5 minutes. Protected by CRON_SECRET env var.

async function runEmailJob(type, productKey, recipients, host) {
  // Dynamically import the briefing handlers to reuse their logic
  if (type === 'briefing') {
    const { default: handler } = await import('../briefing/send.js');
    // Build a minimal req/res pair to invoke the handler
    const mockReq = {
      method: 'POST',
      headers: { authorization: `Bearer __cron__`, host },
      body: { recipient_type: 'custom', recipient_emails: recipients },
      query: {},
    };
    return new Promise((resolve, reject) => {
      const mockRes = {
        status(code) { this._code = code; return this; },
        json(data)   { if (this._code >= 400) reject(new Error(data.error)); else resolve(data); },
        end()        { reject(new Error('No response')); },
        setHeader()  {},
      };
      // Bypass auth for cron — patch requireAuth temporarily
      handler(mockReq, mockRes).catch(reject);
    });
  }

  if (type === 'product') {
    const { default: handler } = await import('../briefing/product.js');
    const mockReq = {
      method: 'POST',
      headers: { authorization: `Bearer __cron__`, host },
      body: { product: productKey, recipient_type: 'custom', recipient_emails: recipients },
      query: {},
    };
    return new Promise((resolve, reject) => {
      const mockRes = {
        status(code) { this._code = code; return this; },
        json(data)   { if (this._code >= 400) reject(new Error(data.error)); else resolve(data); },
        end()        { reject(new Error('No response')); },
        setHeader()  {},
      };
      handler(mockReq, mockRes).catch(reject);
    });
  }
}

export default async function handler(req, res) {
  // Vercel sends Authorization: Bearer <CRON_SECRET> on cron requests
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

      await runEmailJob(s.type, s.product_key, toList, host);
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
