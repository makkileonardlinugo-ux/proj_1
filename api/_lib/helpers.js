import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import Groq from 'groq-sdk';
import { createHmac } from 'crypto';

export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
);

export const resend = new Resend(process.env.RESEND_API_KEY);
export const groq   = new Groq({ apiKey: process.env.GROQ_API_KEY || '' });

export const FROM_EMAIL        = process.env.RESEND_FROM || 'onboarding@resend.dev';
export const GOOGLE_SHEETS_URL = process.env.GOOGLE_SHEETS_URL || 'https://script.google.com/macros/s/AKfycbwdwiErveMWLnGnOSzOJL5Pe7uw2xqqHz497WzpNLtwyIz5vX1ZyFoLtZqu591njdO1/exec';

// ── Token auth (HMAC-SHA256, no external deps) ────────────────────────────────

export function createToken(username) {
  const secret  = process.env.DASHBOARD_PASSWORD;
  const payload = Buffer.from(JSON.stringify({ u: username, t: Date.now() })).toString('base64url');
  const sig     = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyToken(token) {
  if (!token) return false;
  const secret = process.env.DASHBOARD_PASSWORD;
  const dot    = token.lastIndexOf('.');
  if (dot === -1) return false;
  const payload  = token.slice(0, dot);
  const sig      = token.slice(dot + 1);
  const expected = createHmac('sha256', secret).update(payload).digest('base64url');
  if (expected !== sig) return false;
  try {
    const { t } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return Date.now() - t < 24 * 60 * 60 * 1000; // 24-hour sessions
  } catch {
    return false;
  }
}

// Returns false and writes 401 if not authenticated; returns true if OK.
export function requireAuth(req, res) {
  const auth  = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!verifyToken(token)) {
    res.status(401).json({ ok: false, error: 'Unauthorized' });
    return false;
  }
  return true;
}

// ── CORS ──────────────────────────────────────────────────────────────────────

export function cors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.status(200).end(); return true; }
  return false;
}

// ── Shared helpers ────────────────────────────────────────────────────────────

export async function resolveRecipients(type, emails) {
  if (!type || type === 'default') return null;

  if (type === 'all') {
    const { data, error } = await supabase
      .from('test_form').select('email').eq('subscribed', true);
    if (error) throw new Error('Failed to fetch subscribers: ' + error.message);
    return (data || []).map(r => r.email).filter(Boolean);
  }

  if (type === 'custom' || type === 'selected') {
    const arr = Array.isArray(emails) ? emails : (emails ? [emails] : []);
    return arr.filter(Boolean);
  }

  return null;
}

export function computeNextRun(scheduleType, hour, minute, weekday) {
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
