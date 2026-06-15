import { createToken, cors } from './_lib/helpers.js';

export default function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).end();

  const { username, password } = req.body || {};

  if (
    username === process.env.DASHBOARD_USERNAME &&
    password === process.env.DASHBOARD_PASSWORD
  ) {
    return res.json({ ok: true, token: createToken(username) });
  }

  res.status(401).json({ ok: false, error: 'Incorrect username or password.' });
}
