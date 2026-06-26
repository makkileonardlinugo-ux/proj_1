require('dotenv').config();
const express = require('express');
const path    = require('path');
const { spawn } = require('child_process');

const app  = express();
const PORT = process.env.PORT || 4000;

app.use(express.json());
app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'youtube-analyst.html'));
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', configured: !!process.env.YOUTUBE_API_KEY });
});

app.get('/api/analyze/stream', (req, res) => {
  const { channel, startDate, endDate, maxResults } = req.query;
  if (!channel) return res.status(400).json({ error: 'channel is required' });

  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  const pyArgs = [
    path.join(__dirname, 'pipeline.py'),
    '--channel', channel,
    '--max-results', maxResults || '25',
  ];
  if (startDate) pyArgs.push('--start-date', startDate);
  if (endDate)   pyArgs.push('--end-date',   endDate);

  const py = spawn('python', pyArgs, { cwd: __dirname });

  // Kill and report if pipeline hangs for more than 2 minutes
  const timeout = setTimeout(() => {
    py.kill();
    send({ step: 'error', status: 'error', message: 'Pipeline timed out after 2 minutes' });
    res.end();
  }, 120000);

  let buffer = '';
  let stderrBuf = '';

  py.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try { send(JSON.parse(line)); }
      catch { console.error('[pipeline] non-JSON:', line); }
    }
  });

  py.stderr.on('data', (chunk) => {
    stderrBuf += chunk.toString();
  });

  py.on('close', (code) => {
    clearTimeout(timeout);
    if (buffer.trim()) {
      try { send(JSON.parse(buffer)); } catch {}
    }
    if (code !== 0 && stderrBuf.trim()) {
      // Surface the actual Python traceback to the frontend
      const lastLine = stderrBuf.trim().split('\n').pop();
      send({ step: 'error', status: 'error', message: lastLine || 'Unknown error' });
      console.error('[pipeline stderr]\n' + stderrBuf);
    }
    send({
      step: 'done',
      status:  code === 0 ? 'success' : 'error',
      message: code === 0 ? 'Pipeline complete' : `Exited with code ${code}`,
    });
    res.end();
  });

  req.on('close', () => { clearTimeout(timeout); py.kill(); });
});

app.listen(PORT, () => {
  console.log(`\n  YT Analyst running at http://localhost:${PORT}\n`);
});
