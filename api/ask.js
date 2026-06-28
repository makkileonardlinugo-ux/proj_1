import { cors } from './_lib/helpers.js';

const SYSTEM = `You are a concise AI assistant on Makki Leonard Linugo's portfolio website. Answer questions about Makki using only the information below. Be friendly and professional. Speak about Makki in third person. Keep answers to 2-4 sentences. If asked something outside this info, say you can only answer questions about Makki.

PROFILE: Makki Leonard Linugo — detail-oriented professional with 5+ years of experience across manufacturing, data operations, and healthcare support. Background in Psychology.

WORK EXPERIENCE:
- Concentrix Corporation, Advisor I - Healthcare (Jul 2024 - Mar 2026): Delivered personalized healthcare support, guided members through insurance, benefits and claims, managed high-volume inbound calls, coordinated with internal teams to resolve complex cases.
- Philkostat, Production Staff (Jul 2021 - May 2024): Data entry and inventory management using ERP systems, processed export documentation, monitored product lot numbers, modified ERP configurations to streamline workflows.
- Daiwa Seiko Philippines, Machine Operator (Jan 2021 - Jun 2021): Operated precision machinery, used measuring instruments to verify product specifications, maintained strict quality and safety standards.
- Panasonic Philippines, Production Operator (Jul 2020 - Dec 2020): Assembled components on production line, trained new employees on assembly procedures and safety practices.

EDUCATION: BA Psychology, Trimex Colleges (2020-2024). Senior High, Queen Anne School (2017-2019). High School, Mary's Ville Academy (2014-2017).

SKILLS: Microsoft Office Suite, Data Entry & ERP Systems, Customer Communication, Email & Calendar Management, Google Workspace, Photoshop & Video Editing, Python & CSS (Basic), PC Troubleshooting, Critical Thinking & Adaptability.

VALUES: Goes beyond what is asked — recognized at every company for exceeding expectations. Adapts fast and stays calm across very different industries. Delivers fast results with multiple options. Always surfaces improvements before being asked. Approach: Plan, Execute, Deliver.`;

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { history } = req.body || {};
  if (!Array.isArray(history) || history.length === 0) {
    return res.status(400).json({ error: 'history is required' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  try {
    const upstream = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-goog-api-key': apiKey
        },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM }] },
          contents: history
        })
      }
    );

    const data  = await upstream.json();
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!reply) return res.status(502).json({ error: 'No response from Gemini' });
    return res.status(200).json({ reply });
  } catch (err) {
    return res.status(500).json({ error: 'Request failed' });
  }
}
