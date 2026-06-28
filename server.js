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
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import puppeteer from 'puppeteer';
import dotenv from 'dotenv';
dotenv.config();

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
  const now = new Date();

  if (scheduleType === 'daily') {
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, minute, 0, 0));
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
    return next;
  }

  if (scheduleType === 'weekly') {
    const diff = ((weekday - now.getUTCDay()) + 7) % 7;
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + diff, hour, minute, 0, 0));
    if (next <= now) next.setUTCDate(next.getUTCDate() + 7);
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

// ── KIE Image Generation ─────────────────────────────────────────────────────
const KIE_API_KEY = process.env.KIE_API_KEY;

app.post('/generate-image', async (req, res) => {
  const { prompt, aspectRatio = '16:9', resolution = '1K', filename } = req.body || {};
  if (!prompt) return res.status(400).json({ ok: false, error: 'prompt required' });
  if (!KIE_API_KEY) return res.status(500).json({ ok: false, error: 'KIE_API_KEY not configured' });

  try {
    const taskRes = await fetch('https://api.kie.ai/api/v1/jobs/createTask', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${KIE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'nano-banana-2', input: { prompt, aspect_ratio: aspectRatio, resolution, output_format: 'jpg' } }),
    });
    const taskJson = await taskRes.json();
    if (taskJson.code !== 200 || !taskJson.data?.taskId) {
      return res.status(500).json({ ok: false, error: 'KIE task creation failed', detail: taskJson });
    }
    const taskId = taskJson.data.taskId;

    let imageUrl = null;
    for (let i = 0; i < 72; i++) {
      await new Promise(r => setTimeout(r, 5000));
      const statusRes = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${taskId}`, {
        headers: { 'Authorization': `Bearer ${KIE_API_KEY}` },
      });
      const s = await statusRes.json();
      const d = s.data || {};
      const state = (d.state || d.status || '').toLowerCase();
      if (state === 'success' || state === 'completed') {
        try { imageUrl = JSON.parse(d.resultJson).resultUrls?.[0]; } catch {}
        imageUrl = imageUrl || d.output?.url || d.result?.url || d.url;
        if (imageUrl) break;
        return res.status(500).json({ ok: false, error: 'Task done but no URL', data: d });
      }
      if (state === 'failed' || state === 'error') {
        return res.status(500).json({ ok: false, error: 'KIE task failed', data: d });
      }
    }
    if (!imageUrl) return res.status(500).json({ ok: false, error: 'Timeout waiting for image' });

    const imgBuf = await (await fetch(imageUrl)).arrayBuffer();
    const genDir = join(__dirname, 'images', 'generated');
    mkdirSync(genDir, { recursive: true });
    const fname = filename || `gen-${Date.now()}-${taskId.slice(0, 8)}.jpg`;
    writeFileSync(join(genDir, fname), Buffer.from(imgBuf));

    res.json({ ok: true, imageUrl: `/images/generated/${fname}`, taskId });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Shared design rules for prompt building ───────────────────────────────────
const DESIGN_RULES = `
DESIGN RULES (frontend-design skill):
- Typography: distinctive editorial serif + refined sans pairing (e.g. Cormorant + DM Sans, Fraunces + Outfit, Playfair Display + Syne). NEVER Inter, Roboto, Arial.
- Colors: custom brand palette derived from the theme. CSS custom properties for every color. Never default blue/indigo/purple.
- Shadows: layered, color-tinted (not flat). Multiple shadow layers with low opacity.
- Texture: subtle grain/noise overlay for depth.
- Layout: intentional asymmetry, overlap, or diagonal flow. Massive display headings (clamp 5–9vw).
- Animations: transform and opacity only. Staggered reveal on load.
- Interactive states: :hover, :focus-visible, :active on every button and link.
- No placeholder images, no lorem ipsum. Realistic brand-specific copy and CSS-only visuals.
`;

// Maps theme keywords to visual direction descriptors
function buildConceptDescription(concept, theme, section, extra) {
  const t = (theme || '').toLowerCase();
  const colorMood =
    t.includes('dark') || t.includes('moody') ? 'near-black grounds with warm amber and raw umber accents' :
    t.includes('light') || t.includes('minimal') ? 'pure white with one strong accent color and generous negative space' :
    t.includes('glass') || t.includes('frosted') ? 'translucent layers, cool blue-white tints, layered blur surfaces' :
    t.includes('luxury') || t.includes('gold') ? 'deep charcoal or midnight navy with champagne gold accents' :
    t.includes('neon') || t.includes('cyber') || t.includes('futur') ? 'pitch black with electric neon accent, high contrast' :
    t.includes('warm') || t.includes('earthy') || t.includes('organic') ? 'warm cream, terracotta, and muted sage' :
    t.includes('bold') || t.includes('dynamic') || t.includes('kinetic') ? 'saturated brand color block with high-contrast typography' :
    'custom brand palette with one dominant hue and complementary neutral';

  const typeFeel =
    t.includes('editorial') || t.includes('luxury') || t.includes('minimal') ? 'condensed display serif at monumental scale with fine-weight sans body' :
    t.includes('bold') || t.includes('dynamic') || t.includes('kinetic') ? 'extended grotesque in ultra-heavy weight with tight tracking' :
    t.includes('organic') || t.includes('warm') || t.includes('earthy') ? 'humanist serif paired with soft rounded sans' :
    t.includes('glass') || t.includes('cyber') || t.includes('futur') ? 'geometric sans with variable weight, sharp and technical' :
    'editorial display serif paired with clean geometric sans';

  const sec = (section || '').toLowerCase();
  const layoutIntent =
    sec.includes('hero') ? 'asymmetric full-viewport hero, image bleeding to one edge, headline dominant left' :
    sec.includes('pric') ? 'three-column pricing grid, featured tier visually elevated, clear CTA hierarchy' :
    sec.includes('feat') ? 'alternating text-image rows with subtle background shifts per row' :
    sec.includes('about') ? 'editorial two-column layout with large pull quote and team photography' :
    sec.includes('contact') ? 'split-panel contact form, left brand message, right clean form inputs' :
    'asymmetric layout with intentional negative space and one full-bleed visual element';

  const atmosphere = `A ${theme || 'contemporary'} ${section || 'homepage'} experience for ${concept || 'a modern brand'} — ${colorMood.split(' with ')[0]}, ${typeFeel.split(' paired')[0].toLowerCase()}, built for impact.`;

  return `Brand Concept: ${concept || 'modern brand'}
Visual Theme: ${theme || 'contemporary modern'}
Key Section: ${section || 'Hero / Homepage'}${extra ? `\nExtra Context: ${extra}` : ''}

Visual Direction:
- Color mood: ${colorMood}
- Typography feel: ${typeFeel}
- Layout intent: ${layoutIntent}
- Atmosphere: ${atmosphere}`;
}

function buildKiePrompt(conceptDesc) {
  return `Full desktop website screenshot at 1440x900px, showing a live production-quality website.

${conceptDesc}

${DESIGN_RULES}

The screenshot must show:
- A complete nav bar with logo and links
- A bold hero with massive display typography (not generic, not centered by default)
- Real brand-specific copy — no lorem ipsum, no placeholder text
- Custom color palette matching the theme — no default blues or purples
- Realistic UI components with depth, shadows, and texture
- At least one supporting section visible below the fold
- Zero gray placeholder boxes

Photorealistic browser screenshot. Looks like a real, active, shipped website.`;
}

// ── Master Prompt — Claude creative brief from user inputs ───────────────────
app.post('/master-prompt', async (req, res) => {
  const { concept = '', theme = '', section = '', extra = '' } = req.body || {};
  if (!KIE_API_KEY) return res.status(500).json({ ok: false, error: 'KIE_API_KEY not configured' });

  const system = `You are a creative director at a world-class design agency. Write a vivid, specific design brief (3–5 sentences) for both an AI image generator and a frontend developer to create a website. Cover: visual atmosphere, color palette, typography style, layout composition, and one defining UI detail. Be evocative and precise. Output only the brief — no labels, no markdown, no bullet points.`;

  const user = `Concept: ${concept || 'modern brand'}
Theme: ${theme || 'contemporary'}
Section: ${section || 'Homepage'}${extra ? `\nExtra: ${extra}` : ''}`;

  try {
    const r = await fetch('https://api.kie.ai/claude/v1/messages', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${KIE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 300,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });
    const json = await r.json();
    const masterPrompt = json.content?.[0]?.text?.trim();
    if (!masterPrompt) throw new Error(json.error?.message || 'No content returned');
    res.json({ ok: true, masterPrompt });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Concept Generator — KIE Nano Banana 2 image ───────────────────────────────
app.post('/generate-concept', async (req, res) => {
  const { concept = '', theme = '', section = '', extra = '', masterPrompt = null } = req.body || {};
  if (!concept && !theme && !section) {
    return res.status(400).json({ ok: false, error: 'At least one field required' });
  }
  if (!KIE_API_KEY) return res.status(500).json({ ok: false, error: 'KIE_API_KEY not configured' });

  const slug = ((concept || theme || section).toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')).slice(0, 28);
  const fname = `${slug}-${Date.now()}.jpg`;
  const genDir = join(__dirname, 'images', 'generated');
  mkdirSync(genDir, { recursive: true });

  const conceptDesc = masterPrompt || buildConceptDescription(concept, theme, section, extra);
  try {
    // 1. Create KIE task
    const taskRes = await fetch('https://api.kie.ai/api/v1/jobs/createTask', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${KIE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'nano-banana-2', input: { prompt: buildKiePrompt(conceptDesc), aspect_ratio: '16:9', resolution: '1K', output_format: 'jpg' } }),
    });
    const taskJson = await taskRes.json();
    if (taskJson.code !== 200 || !taskJson.data?.taskId) {
      return res.status(500).json({ ok: false, error: 'KIE task creation failed', detail: taskJson });
    }
    const taskId = taskJson.data.taskId;

    // 2. Poll for completion
    let imageUrl = null;
    for (let i = 0; i < 72; i++) {
      await new Promise(r => setTimeout(r, 5000));
      const s = await (await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${taskId}`, {
        headers: { 'Authorization': `Bearer ${KIE_API_KEY}` },
      })).json();
      const d = s.data || {};
      const state = (d.state || d.status || '').toLowerCase();
      if (state === 'success' || state === 'completed') {
        try { imageUrl = JSON.parse(d.resultJson).resultUrls?.[0]; } catch {}
        imageUrl = imageUrl || d.output?.url || d.result?.url || d.url;
        if (imageUrl) break;
        return res.status(500).json({ ok: false, error: 'Task done but no URL', data: d });
      }
      if (state === 'failed' || state === 'error') {
        return res.status(500).json({ ok: false, error: 'KIE task failed', data: d });
      }
    }
    if (!imageUrl) return res.status(500).json({ ok: false, error: 'Timeout waiting for image' });

    // 3. Download and save
    const imgBuf = await (await fetch(imageUrl)).arrayBuffer();
    writeFileSync(join(genDir, fname), Buffer.from(imgBuf));

    const imagePath = join(genDir, fname);
    res.json({ ok: true, imageUrl: `/images/generated/${fname}`, imagePath, conceptDesc, taskId });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Export Concept as HTML — Claude Sonnet 4.6 via KIE API ───────────────────
app.post('/export-concept', async (req, res) => {
  const { concept = '', theme = '', section = '', extra = '', imagePath = null, masterPrompt = null } = req.body || {};
  if (!KIE_API_KEY) return res.status(500).json({ ok: false, error: 'KIE_API_KEY not configured' });

  const slug = ((concept || theme || section).toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')).slice(0, 28);
  const genDir  = join(__dirname, 'images', 'generated');
  mkdirSync(genDir, { recursive: true });
  const htmlFilePath = join(genDir, `${slug}-${Date.now()}.html`);
  const htmlUrl  = `/images/generated/${htmlFilePath.split(/[\\/]/).pop()}`;

  const conceptDesc = masterPrompt || buildConceptDescription(concept, theme, section, extra);

  // Try to read the image as base64 for vision input
  let imageBlock = null;
  if (imagePath) {
    try {
      const data = readFileSync(imagePath).toString('base64');
      imageBlock = { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } };
    } catch (e) {
      console.warn('/export-concept: could not read imagePath, proceeding without image:', e.message);
    }
  }

  const systemPrompt = imageBlock
    ? `You are an elite frontend designer. A screenshot of the target website design is attached — match it exactly. Output a complete HTML file that replicates the layout, color palette, typography style, spacing, and overall atmosphere shown. No markdown, no code fences. Start with <!DOCTYPE html> and end with </html>. CSS under 60 lines. Body MUST have nav + hero + one section with real visible content.`
    : `You are an elite frontend designer. Output a complete HTML file. No markdown, no code fences. Start with <!DOCTYPE html> and end with </html>. CSS under 60 lines. Body MUST have nav + hero + one section with real visible content — never empty or skeleton-only.`;

  // Build user message: image first (Anthropic convention), then text
  const userContent = [];
  if (imageBlock) userContent.push(imageBlock);
  userContent.push({
    type: 'text',
    text: `Build a website matching this concept:\n${conceptDesc}\n\n${imageBlock ? 'Match the attached screenshot precisely — same layout, colors, fonts, and atmosphere.' : 'Bold, distinctive, not generic.'} Google Fonts only (editorial serif + clean sans). CSS custom properties for all colors. placehold.co for images. Complete document, nothing truncated.`,
  });

  try {
    const claudeRes = await fetch('https://api.kie.ai/claude/v1/messages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${KIE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: userContent }],
      }),
    });
    const claudeJson = await claudeRes.json();
    let html = claudeJson.content?.[0]?.text?.trim() || '';
    if (!html) {
      const errMsg = claudeJson.error?.message || claudeJson.message || claudeJson.detail || JSON.stringify(claudeJson).slice(0, 200);
      throw new Error('KIE Claude: ' + errMsg);
    }
    html = html.replace(/^```html\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
    if (!html.toLowerCase().startsWith('<!doctype') && !html.toLowerCase().startsWith('<html')) {
      const idx = html.toLowerCase().indexOf('<!doctype');
      if (idx > -1) html = html.slice(idx);
      else throw new Error('Claude did not return valid HTML');
    }
    writeFileSync(htmlFilePath, html, 'utf8');
    res.json({ ok: true, htmlUrl });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Ask about Makki (Gemini proxy) ───────────────────────────────────────────
const ASK_SYSTEM = `You are a warm, confident AI on Makki Leonard Linugo's portfolio. You are his advocate. Speak about Makki in third person. Keep answers to 2-4 sentences. Sound like a real person talking about someone they know well, not a database lookup. Never say "provided information", "based on the data", or "explicitly stated" — just talk naturally.

TONE RULES:
- Never say Makki cannot do something. Never doubt him. Never hedge with "that's outside his world" or "that's a very different field." You are his advocate, not a liability filter.
- When someone asks "can Makki do X?" — always say yes, then back it up. Connect it to his fast-learning nature, his adaptability, his psychology background, his creative skills, or his track record of exceeding expectations in every role he has held.
- If someone pushes back and says "so he can't learn it?" — double down. Say something like: "Makki is exactly the kind of person who figures things out. Give him a direction and he will own it."
- For genuinely wild hypotheticals (build a rocket, fly a plane) — be fun and confident. Say something like "Honestly? Give Makki a goal and a reason, and he will find a way. That is just who he is." Do not shut the question down.
- Never lean on his manufacturing background as the main thing. His most recent and relevant work is healthcare support, data operations, and customer communication.
- Sound like a proud colleague who has seen Makki outperform expectations repeatedly. Not a database. Not a recruiter reading a checklist.

PROFILE: Makki Leonard Linugo — 24 years old, based in Santa Rosa, Philippines. A sharp, adaptable professional with 5+ years of experience across data operations, healthcare support, and customer communication. Psychology graduate. Speaks English and Filipino fluently.

AVAILABILITY: Open to remote work — full-time, part-time, freelance, or project-based. Open to any industry. Looking for a stable long-term role where he can grow and add real value.

WORK EXPERIENCE:
- Concentrix Corporation, Advisor I - Healthcare (Jul 2024 - Mar 2026): Delivered personalized healthcare support, guided members through insurance, benefits and claims, managed high-volume inbound calls, coordinated with internal teams to resolve complex cases.
- Philkostat, Production Staff (Jul 2021 - May 2024): Data entry and inventory management using ERP systems, processed export documentation, monitored product lot numbers, streamlined workflows.
- Daiwa Seiko Philippines, Machine Operator (Jan 2021 - Jun 2021): Operated precision machinery, maintained strict quality and safety standards.
- Panasonic Philippines, Production Operator (Jul 2020 - Dec 2020): Assembly line work, trained new employees on procedures and safety.

EDUCATION: BA Psychology, Trimex Colleges (2020-2024).

SKILLS: Microsoft Office Suite, Google Workspace, Data Entry & ERP Systems, CRM Systems, Customer Communication, Email & Calendar Management, Photoshop & Video Editing, Python & CSS (Basic), PC Troubleshooting, Critical Thinking & Adaptability.

PROJECTS: Built BlinkRead — a personal app he created on his own, showing he takes initiative and builds things even outside of work.

WORK STYLE: 60% async, 40% real-time. Thrives on creative tasks. Known as a top performer everywhere he has worked. Picks up new tools fast — learned CRM systems on the job with no prior experience.

PERSONALITY: Practices stoicism. Reads psychology and philosophy. Loves anime and video games. Always learning something new. Calm under pressure, consistent across very different environments.

VALUES: Goes beyond what is asked — recognized at every company for exceeding expectations. Delivers fast with multiple options. Surfaces improvements before being asked. Approach: Plan, Execute, Deliver.

WHY HIRE MAKKI: He does not just do the job — he improves it. Every team he has been part of has seen him go above and beyond without being asked. He is the kind of person you hire once and keep.`;

app.post('/ask', async (req, res) => {
  const { history } = req.body || {};
  if (!Array.isArray(history) || history.length === 0) {
    return res.status(400).json({ error: 'history is required' });
  }
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY not set in .env' });

  const MODELS = [
    'gemini-2.5-flash',
    'gemini-3.1-flash-lite',
    'gemini-2.5-flash-lite',
    'gemini-3-flash-preview',
  ];
  const body = JSON.stringify({ system_instruction: { parts: [{ text: ASK_SYSTEM }] }, contents: history });

  for (const model of MODELS) {
    try {
      const upstream = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-goog-api-key': apiKey }, body }
      );
      const data  = await upstream.json();
      const reply = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (reply) return res.json({ reply });
    } catch (_) {}
  }
  return res.status(502).json({ error: 'No response from Gemini' });
});

app.listen(3001, () => {
  console.log('Contact server running → http://localhost:3001');
  console.log('Supabase project: https://uvcdffktunyhrrsbcpdm.supabase.co');
  console.log('Waiting for POST /contact …');
});
