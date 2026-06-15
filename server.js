import express from 'express';
import cors    from 'cors';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import cron from 'node-cron';
import Groq from 'groq-sdk';
import { createHmac } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors({ origin: 'http://localhost:3000' }));
app.use(express.json());

// Allow dashboard to call /api/* locally (Vercel uses real serverless routes)
app.use((req, _res, next) => {
  if (req.url.startsWith('/api/')) req.url = req.url.slice(4);
  next();
});

const SUPABASE_URL        = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

const RESEND_API_KEY    = process.env.RESEND_API_KEY || 'YOUR_RESEND_API_KEY';
const FROM_EMAIL        = process.env.RESEND_FROM || 'onboarding@resend.dev';
const GOOGLE_SHEETS_URL = process.env.GOOGLE_SHEETS_URL || 'https://script.google.com/macros/s/AKfycbwdwiErveMWLnGnOSzOJL5Pe7uw2xqqHz497WzpNLtwyIz5vX1ZyFoLtZqu591njdO1/exec';

const DASHBOARD_USERNAME = process.env.DASHBOARD_USERNAME;
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD;

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);
const resend   = new Resend(RESEND_API_KEY);
const groq     = new Groq({ apiKey: process.env.GROQ_API_KEY || '' });

function createToken(username) {
  const payload = Buffer.from(JSON.stringify({ u: username, t: Date.now() })).toString('base64url');
  const sig     = createHmac('sha256', DASHBOARD_PASSWORD).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username === DASHBOARD_USERNAME && password === DASHBOARD_PASSWORD) {
    return res.json({ ok: true, token: createToken(username) });
  }
  res.status(401).json({ ok: false, error: 'Incorrect username or password.' });
});

app.post('/contact', async (req, res) => {
  const { name, email, message } = req.body;
  const subscribed = req.body.subscribed === 'true';

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
    console.error('Supabase insert error:', supabaseError.message);
    return res.status(500).json({ ok: false, error: supabaseError.message });
  }

  if (sheetsResult.status === 'rejected') {
    console.warn('Google Sheets error (non-fatal):', sheetsResult.reason?.message);
  } else {
    console.log('Google Sheets: row appended');
  }

  console.log('Submission saved from:', email);
  res.json({ ok: true });
});

app.get('/submissions', async (req, res) => {
  const { data, error } = await supabase
    .from('test_form')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ ok: false, error: error.message });
  res.json({ ok: true, data });
});

// ── Newsletters ──────────────────────────────────────────────────────────────

app.get('/newsletters', async (req, res) => {
  const { data, error } = await supabase
    .from('newsletters')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ ok: false, error: error.message });
  res.json({ ok: true, data });
});

app.post('/newsletters', async (req, res) => {
  const { subject, preview_text, body } = req.body;
  if (!subject || !body) return res.status(400).json({ ok: false, error: 'subject and body are required' });

  const { data, error } = await supabase
    .from('newsletters')
    .insert({ subject, preview_text, body })
    .select()
    .single();

  if (error) return res.status(500).json({ ok: false, error: error.message });
  res.json({ ok: true, data });
});

app.post('/newsletters/generate', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ ok: false, error: 'prompt is required' });
  try {
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You are an expert email copywriter for Tester.io, a smart wearable tech brand (products: Smart Watch Pro, Smart Glasses, Smart Earbuds, Smart Ring, Smart Assistant, Smart Home Hub) and PLANETEX (luxury exoplanet real estate).
Generate a professional newsletter as clean, readable HTML with inline styles.
Return ONLY valid JSON with this exact shape:
{
  "subject": "compelling email subject line under 60 characters",
  "preview_text": "inbox preview snippet under 100 characters",
  "html": "the full email body HTML with inline styles — white background #ffffff, Arial/Helvetica font, proper heading hierarchy, paragraph spacing, and a styled CTA button. No <html>/<body>/<head> tags — start with a <div style='padding:32px 24px;font-family:Arial,sans-serif;...'>"
}`,
        },
        { role: 'user', content: prompt },
      ],
      max_tokens: 2500,
      temperature: 0.75,
    });
    const result = JSON.parse(completion.choices[0].message.content);
    res.json({ ok: true, subject: result.subject || '', preview_text: result.preview_text || '', html: result.html || '' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/newsletters/:id/send', async (req, res) => {
  const { id } = req.params;
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
      from: FROM_EMAIL,
      to:   sub.email,
      subject: newsletter.subject,
      html: newsletter.body,
    });
    if (error) { failed++; } else { sent++; }
  }

  await supabase.from('newsletters').update({ sent_at: new Date().toISOString() }).eq('id', id);
  console.log(`Newsletter "${newsletter.subject}" sent: ${sent} ok, ${failed} failed`);
  res.json({ ok: true, sent, failed });
});

app.post('/briefing/product', async (req, res) => {
  const { product, recipient_type, recipient_emails } = req.body || {};
  if (!product) return res.status(400).json({ ok: false, error: 'product key is required' });

  try {
    const recipients = await resolveRecipients(recipient_type, recipient_emails);
    if (recipients !== null && !recipients.length)
      return res.status(400).json({ ok: false, error: 'No recipients found for the selected option.' });

    const jobEnv = { ...process.env, PATH: process.env.PATH };
    if (recipients?.length) jobEnv.RESEND_TO = recipients.join(',');

    const output = await runEmailJob('product', product, jobEnv);
    res.json({ ok: true, output });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/briefing/send', async (req, res) => {
  const { recipient_type, recipient_emails } = req.body || {};

  try {
    const recipients = await resolveRecipients(recipient_type, recipient_emails);
    if (recipients !== null && !recipients.length)
      return res.status(400).json({ ok: false, error: 'No recipients found for the selected option.' });

    const jobEnv = { ...process.env, PATH: process.env.PATH };
    if (recipients?.length) jobEnv.RESEND_TO = recipients.join(',');

    const output = await runEmailJob('briefing', null, jobEnv);
    res.json({ ok: true, output });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Schedule helpers ──────────────────────────────────────────────────────────

function computeNextRun(scheduleType, hour, minute, weekday) {
  const now  = new Date();
  const next = new Date();

  if (scheduleType === 'daily') {
    next.setHours(hour, minute, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    return next;
  }

  if (scheduleType === 'weekly') {
    const diff = ((weekday - now.getDay()) + 7) % 7;
    next.setDate(now.getDate() + diff);
    next.setHours(hour, minute, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 7);
    return next;
  }

  return null;
}

function runEmailJob(type, productKey, overrideEnv = null) {
  return new Promise((resolve, reject) => {
    const scriptDir = join(__dirname, 'morning-briefing');
    const args      = type === 'product' ? ['product.js', productKey] : ['index.js'];
    const env       = overrideEnv ?? { ...process.env, PATH: process.env.PATH };
    const child     = spawn('node', args, { cwd: scriptDir, env });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    child.on('close', code => {
      if (code === 0) resolve(out.trim());
      else reject(new Error(out.trim() || `exited with code ${code}`));
    });
  });
}

async function resolveRecipients(type, emails) {
  if (!type || type === 'default') return null;

  if (type === 'all') {
    const { data, error } = await supabase.from('test_form').select('email').eq('subscribed', true);
    if (error) throw new Error('Failed to fetch subscribers: ' + error.message);
    return (data || []).map(r => r.email).filter(Boolean);
  }

  if (type === 'custom' || type === 'selected') {
    const arr = Array.isArray(emails) ? emails : (emails ? [emails] : []);
    return arr.filter(Boolean);
  }

  return null;
}

// ── Cron: fire due schedules every minute ─────────────────────────────────────

cron.schedule('* * * * *', async () => {
  const now = new Date();
  const { data: due, error } = await supabase
    .from('scheduled_emails')
    .select('*')
    .eq('is_active', true)
    .lte('next_run', now.toISOString());

  if (error || !due?.length) return;

  for (const s of due) {
    console.log(`[cron] Firing: "${s.label}" (${s.type})`);
    const recipients = await resolveRecipients(s.recipient_type, s.recipient_emails).catch(() => null);
    const jobEnv = { ...process.env, PATH: process.env.PATH };
    if (recipients?.length) jobEnv.RESEND_TO = recipients.join(',');
    runEmailJob(s.type, s.product_key, jobEnv)
      .then(o  => console.log(`[cron] OK: "${s.label}" — ${o.slice(0, 80)}`))
      .catch(e => console.error(`[cron] Failed: "${s.label}":`, e.message));

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
  }
});

// ── Schedule CRUD endpoints ───────────────────────────────────────────────────

app.get('/schedules', async (req, res) => {
  const { data, error } = await supabase
    .from('scheduled_emails')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ ok: false, error: error.message });
  res.json({ ok: true, data });
});

app.post('/schedules', async (req, res) => {
  const {
    label, type, product_key,
    schedule_type,
    send_hour = 8, send_minute = 0, send_weekday,
    run_once_at,
  } = req.body;

  if (!label || !type || !schedule_type)
    return res.status(400).json({ ok: false, error: 'label, type, and schedule_type are required' });
  if (type === 'product' && !product_key)
    return res.status(400).json({ ok: false, error: 'product_key required for product type' });

  let next_run;
  if (schedule_type === 'once') {
    if (!run_once_at)
      return res.status(400).json({ ok: false, error: 'run_once_at required for once schedule' });
    next_run = new Date(run_once_at).toISOString();
  } else {
    next_run = computeNextRun(
      schedule_type,
      Number(send_hour),
      Number(send_minute),
      send_weekday != null ? Number(send_weekday) : undefined,
    ).toISOString();
  }

  const recipient_type   = req.body.recipient_type   || 'all';
  const recipient_emails = req.body.recipient_emails || null;

  const { data, error } = await supabase
    .from('scheduled_emails')
    .insert({ label, type, product_key, schedule_type, send_hour, send_minute, send_weekday, run_once_at, next_run, recipient_type, recipient_emails })
    .select()
    .single();

  if (error) return res.status(500).json({ ok: false, error: error.message });
  res.json({ ok: true, data });
});

app.delete('/schedules/:id', async (req, res) => {
  const { error } = await supabase
    .from('scheduled_emails')
    .delete()
    .eq('id', req.params.id);
  if (error) return res.status(500).json({ ok: false, error: error.message });
  res.json({ ok: true });
});

app.listen(3001, () => {
  console.log('Contact server running → http://localhost:3001');
  console.log('Supabase project: https://uvcdffktunyhrrsbcpdm.supabase.co');
  console.log('Waiting for POST /contact …');
});
