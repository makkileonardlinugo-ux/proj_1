'use strict';

// ─── Config ───────────────────────────────────────────────────
const API_BASE    = 'http://localhost:3002';
const FLASK_BASE  = 'http://localhost:5001';
const TIMEOUT_MS  = 35000;

// ─── State ────────────────────────────────────────────────────
const state = {
  ideas:               [],   // { id, rank, idea, articleTitle, sourceUrl, platform, date, selected }
  nextId:              1,
  currentBrowseItems:  [],
  currentBrowseCard:   null,
};

// ─── Utilities ────────────────────────────────────────────────

function uid() { return state.nextId++; }

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtDate(raw) {
  if (!raw) return '';
  try {
    const d = new Date(raw);
    if (isNaN(d)) return String(raw).slice(0, 10);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return String(raw).slice(0, 10); }
}

function platformLabel(p) {
  return { google_news: 'Google News', reddit: 'Reddit', hacker_news: 'Hacker News' }[p] || p || '';
}

function csvCell(val) {
  const s = String(val ?? '').replace(/"/g, '""');
  return /[,"\r\n]/.test(s) ? `"${s}"` : s;
}

// ─── Fetch with timeout + structured errors ───────────────────

async function apiFetch(url, label = 'Request') {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) {
      // Server returned HTTP error
      let msg = `HTTP ${res.status}`;
      try {
        const j = await res.json();
        if (j.error) msg = j.error;
      } catch { /* ignore */ }
      throw new ApiError(msg, 'http_error', res.status);
    }
    const data = await res.json();
    return data;
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof ApiError) throw err;
    if (err.name === 'AbortError') throw new ApiError(`${label} timed out after ${TIMEOUT_MS / 1000}s`, 'timeout');
    if (err.message?.includes('Failed to fetch') || err.message?.includes('NetworkError')) {
      throw new ApiError('Cannot connect to server. Is it running on port 3002?', 'connection');
    }
    throw new ApiError(err.message || 'Unknown error', 'error');
  }
}

class ApiError extends Error {
  constructor(message, code, status) {
    super(message);
    this.code   = code;
    this.status = status;
  }
}

// ─── Nav status badge ─────────────────────────────────────────

function setNavStatus(s) {
  const badge = document.getElementById('nav-status');
  if (!badge) return;
  const map = {
    idle:    ['badge-idle',    'IDLE'],
    running: ['badge-running', 'RUNNING'],
    success: ['badge-success', 'COMPLETE'],
    error:   ['badge-error',   'ERROR'],
  };
  const [cls, label] = map[s] || map.idle;
  badge.className = `badge ${cls}`;
  badge.textContent = label;
}

// ─── Status bar ───────────────────────────────────────────────

function setStatusBar({ sbState, query, resultCount } = {}) {
  const el = id => document.getElementById(id);
  if (sbState !== undefined && el('sb-state')) {
    el('sb-state').textContent  = sbState;
    el('sb-state').className    = 'statusbar-val' + (sbState !== 'IDLE' && sbState !== '--' ? ' active' : '');
  }
  if (query !== undefined && el('sb-query'))       el('sb-query').textContent = query || '--';
  if (resultCount !== undefined && el('sb-count')) el('sb-count').textContent = resultCount;
  if (el('sb-ideas')) el('sb-ideas').textContent = state.ideas.length;
}

// ─── State display ────────────────────────────────────────────

function showState(name) {
  ['loading', 'empty', 'error', 'list'].forEach(s => {
    const el = document.getElementById(`tf-${s}-state`);
    if (el) el.classList.remove('visible');
  });
  const target = document.getElementById(`tf-${name}-state`);
  if (target) target.classList.add('visible');
}

// ─── Search ───────────────────────────────────────────────────

let lastQuery = '';

function setSearching(active) {
  const btn = document.getElementById('tf-search-btn');
  const inp = document.getElementById('tf-search-input');
  if (btn) { btn.disabled = active; btn.textContent = active ? '... RUNNING' : '▶ RUN'; }
  if (inp) inp.disabled = active;
}

async function doSearch(query) {
  query = (query || '').trim();
  if (!query) return;
  lastQuery = query;

  setSearching(true);
  setNavStatus('running');
  setStatusBar({ sbState: 'SEARCHING', query });

  const header = document.getElementById('tf-results-header');
  const meta   = document.getElementById('tf-results-meta');
  if (header) header.style.display = 'none';

  const list = document.getElementById('tf-results-list');
  if (list) list.replaceChildren();

  showState('loading');

  try {
    const data = await apiFetch(
      `${API_BASE}/api/trending?q=${encodeURIComponent(query)}`,
      'Search'
    );

    if (!data.success) {
      throw new ApiError(data.error || 'Search failed', 'api_error');
    }

    if (!Array.isArray(data.results) || data.results.length === 0) {
      showState('empty');
      setNavStatus('idle');
      return;
    }

    renderResults(data.results, query);
    setNavStatus('success');
    setStatusBar({ sbState: 'COMPLETE', resultCount: data.results.length });

  } catch (err) {
    showError(err);
    setNavStatus('error');
    setStatusBar({ sbState: 'ERROR' });
  } finally {
    setSearching(false);
  }
}

function showError(err) {
  const msgEl = document.getElementById('tf-error-msg');
  if (msgEl) {
    if (err.code === 'connection') {
      msgEl.textContent = 'Cannot connect to the API server. Run: node serve.mjs (port 3002) and python server.py (port 5001).';
    } else if (err.code === 'timeout') {
      msgEl.textContent = `Request timed out after ${TIMEOUT_MS / 1000}s. The server may be overloaded.`;
    } else if (err.code === 'http_error') {
      msgEl.textContent = `Server error (${err.status}): ${err.message}`;
    } else {
      msgEl.textContent = err.message || 'An unexpected error occurred.';
    }
  }
  showState('error');
}

function renderResults(results, query) {
  const header = document.getElementById('tf-results-header');
  const meta   = document.getElementById('tf-results-meta');
  const list   = document.getElementById('tf-results-list');

  if (meta)   meta.textContent = `(${results.length} result${results.length !== 1 ? 's' : ''} for "${query}")`;
  if (header) header.style.display = '';

  showState('list');
  if (!list) return;
  list.replaceChildren();

  results.forEach((item, i) => {
    const card = buildCard(item);
    card.style.animationDelay = `${i * 60}ms`;
    list.appendChild(card);
  });
}

// ─── Card builder ─────────────────────────────────────────────

function buildCard(item) {
  const card = document.createElement('article');
  card.className = 'tf-card';
  card.dataset.url      = item.url;
  card.dataset.platform = item.platform;

  const hasThumb = !!item.thumbnail;
  const rankStr  = String(item.rank).padStart(2, '0');
  const pLabel   = platformLabel(item.platform).toUpperCase();

  card.innerHTML = `
    <div class="tf-card-topbar">
      <span>&#9500;&#9472;[</span>
      <span class="tf-card-topbar-rank">#${rankStr}</span>
      <span>]&#9472;[</span>
      <span class="tf-card-topbar-platform">${escHtml(pLabel)}</span>
      <span>]&#9472;</span>
    </div>
    <div class="tf-card-inner">
      <div class="tf-card-thumb">
        ${hasThumb ? `<img src="${escHtml(item.thumbnail)}" alt="" loading="lazy"
            onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">` : ''}
        <div class="tf-card-thumb-placeholder"${hasThumb ? ' style="display:none"' : ''}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round"
              d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5
                 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 18.75h16.5
                 M21 12V6.75A2.25 2.25 0 0 0 18.75 4.5H5.25A2.25 2.25 0 0 0 3 6.75V18"/>
          </svg>
        </div>
      </div>
      <div class="tf-card-body">
        <div class="tf-card-meta">
          <span class="tf-card-source">${escHtml(item.source)}</span>
          ${item.published ? `<span class="tf-card-date">${escHtml(fmtDate(item.published))}</span>` : ''}
        </div>
        <div class="tf-card-title">
          <a href="${escHtml(item.url)}" target="_blank" rel="noopener noreferrer">
            ${escHtml(item.title)}
          </a>
        </div>
        ${item.description ? `<div class="tf-card-desc">${escHtml(item.description)}</div>` : ''}
        <div class="tf-card-actions">
          <button class="tf-extract-btn" aria-label="Extract ideas">&#9670; EXTRACT</button>
          ${item.is_redirect ? `<button class="btn-secondary" style="padding:6px 10px;font-size:6px;" aria-label="Browse and pick ideas">BROWSE &amp; PICK</button>` : ''}
        </div>
        <div class="tf-redirect-banner" aria-live="polite">
          <div class="tf-redirect-banner-top">
            <span class="tf-redirect-icon">!</span>
            <span class="tf-redirect-text">Google News redirect: direct extraction blocked</span>
          </div>
          <div class="tf-redirect-steps">
            1. Click OPEN to view the article in your browser.<br>
            2. Copy the final URL from the address bar.<br>
            3. Paste it below and press Enter.
          </div>
          <div class="tf-redirect-input-row">
            <input class="tf-redirect-url-input" type="url" placeholder="paste real article URL here...">
            <button class="tf-redirect-open-btn">OPEN</button>
          </div>
        </div>
      </div>
    </div>`;

  card._item = item;

  // Extract ideas button
  const extractBtn = card.querySelector('.tf-extract-btn');
  extractBtn?.addEventListener('click', () => extractFromCard(card, item));

  // Browse & Pick button
  const browseBtn = card.querySelector('.btn-secondary');
  browseBtn?.addEventListener('click', () => openBrowseModal(card, item));

  // Redirect: open article
  const openBtn = card.querySelector('.tf-redirect-open-btn');
  openBtn?.addEventListener('click', () => window.open(item.url, '_blank', 'noopener,noreferrer'));

  // Redirect: paste URL + Enter
  const pasteInput = card.querySelector('.tf-redirect-url-input');
  pasteInput?.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const url = pasteInput.value.trim();
      if (url) extractFromUrl(card, item, url);
    }
  });

  return card;
}

// ─── Extract ideas ────────────────────────────────────────────

async function extractFromCard(card, item) {
  await extractFromUrl(card, item, item.url);
}

async function extractFromUrl(card, item, url) {
  const btn = card.querySelector('.tf-extract-btn');
  if (!btn) return;

  // Validate URL before sending
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    markExtractBtn(btn, 'error', 'INVALID URL');
    btn.title = 'URL must start with http:// or https://';
    return;
  }

  markExtractBtn(btn, 'loading', '... EXTRACTING');

  try {
    const data = await apiFetch(
      `${API_BASE}/api/extract?url=${encodeURIComponent(url)}`,
      'Extract'
    );

    if (!data.success) {
      handleExtractError(btn, card, item, data);
      return;
    }

    if (!Array.isArray(data.items) || data.items.length === 0) {
      markExtractBtn(btn, 'error', 'NO IDEAS FOUND');
      btn.title = 'The article did not contain a rankable list.';
      return;
    }

    const added = addIdeasToPanel(data.items, item, data.title || item.title);
    markExtractBtn(btn, 'done', `+${added} IDEAS`);
    btn.disabled = true;

  } catch (err) {
    if (err.code === 'connection') {
      markExtractBtn(btn, 'error', 'SERVER DOWN');
      btn.title = 'Cannot reach the API server.';
    } else if (err.code === 'timeout') {
      markExtractBtn(btn, 'error', 'TIMED OUT');
      btn.title = 'Extraction took too long. Try again.';
    } else {
      markExtractBtn(btn, 'error', 'ERROR');
      btn.title = err.message || 'Extraction failed.';
    }
  }
}

function markExtractBtn(btn, state, label) {
  btn.className = `tf-extract-btn${state !== 'normal' ? ` ${state}` : ''}`;
  btn.textContent = label;
  btn.disabled = (state === 'loading' || state === 'done');
}

function handleExtractError(btn, card, item, data) {
  switch (data.error) {
    case 'redirect': {
      const banner = card.querySelector('.tf-redirect-banner');
      if (banner) banner.classList.add('visible');
      markExtractBtn(btn, 'error', 'REDIRECT');
      btn.title = 'Google News redirect. See banner below.';
      break;
    }
    case 'no_content':
      markExtractBtn(btn, 'error', 'NO CONTENT');
      btn.title = data.message || 'Could not extract text from this page.';
      break;
    case 'no_items':
      markExtractBtn(btn, 'error', 'NO LIST');
      btn.title = data.message || 'No ranked list found in the article.';
      break;
    case 'timeout':
      markExtractBtn(btn, 'error', 'TIMED OUT');
      btn.title = data.message || 'Fetch timed out.';
      break;
    case 'connection':
      markExtractBtn(btn, 'error', 'UNREACHABLE');
      btn.title = data.message || 'Could not connect to the article URL.';
      break;
    case 'http_error':
      markExtractBtn(btn, 'error', 'HTTP ERR');
      btn.title = data.message || 'HTTP error from article server.';
      break;
    default:
      markExtractBtn(btn, 'error', 'FAILED');
      btn.title = data.message || 'Extraction failed.';
  }
}

// ─── Idea panel ───────────────────────────────────────────────

function addIdeasToPanel(items, card, articleTitle) {
  const date = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  items.forEach(item => {
    state.ideas.push({
      id:           uid(),
      rank:         item.rank,
      idea:         item.idea,
      articleTitle: articleTitle || '',
      sourceUrl:    card.url,
      platform:     card.platform,
      date,
      selected:     false,
    });
  });
  renderPanel();
  return items.length;
}

function renderPanel() {
  const panelList     = document.getElementById('tf-panel-list');
  const panelEmpty    = document.getElementById('tf-panel-empty');
  const panelControls = document.getElementById('tf-panel-controls');
  const panelCount    = document.getElementById('tf-panel-count');

  const count = state.ideas.length;
  if (panelCount) panelCount.textContent = count;

  if (count === 0) {
    if (panelEmpty)    panelEmpty.style.display   = '';
    if (panelList)     panelList.style.display    = 'none';
    if (panelControls) panelControls.classList.remove('visible');
    return;
  }

  if (panelEmpty)    panelEmpty.style.display   = 'none';
  if (panelList)     panelList.style.display    = '';
  if (panelControls) panelControls.classList.add('visible');
  if (!panelList) return;

  setStatusBar({});
  panelList.replaceChildren();
  state.ideas.forEach(idea => {
    const div = document.createElement('div');
    div.className  = 'tf-idea-item';
    div.dataset.id = idea.id;
    div.innerHTML = `
      <input type="checkbox" class="tf-idea-cb" aria-label="Select idea"${idea.selected ? ' checked' : ''}>
      <div class="tf-idea-content">
        <span class="tf-idea-rank">#${idea.rank}</span>
        <span class="tf-idea-text">${escHtml(idea.idea)}</span>
        <span class="tf-idea-meta">${escHtml(idea.articleTitle)} // ${escHtml(platformLabel(idea.platform))}</span>
      </div>`;
    div.querySelector('.tf-idea-cb').addEventListener('change', e => {
      const found = state.ideas.find(x => x.id === idea.id);
      if (found) found.selected = e.target.checked;
    });
    panelList.appendChild(div);
  });
}

// ─── Panel controls ───────────────────────────────────────────

function initPanelControls() {
  const $ = id => document.getElementById(id);

  $('tf-panel-select-all')?.addEventListener('click', () => {
    state.ideas.forEach(x => x.selected = true);
    renderPanel();
  });

  $('tf-panel-deselect')?.addEventListener('click', () => {
    state.ideas.forEach(x => x.selected = false);
    renderPanel();
  });

  $('tf-panel-remove')?.addEventListener('click', () => {
    const before = state.ideas.length;
    state.ideas = state.ideas.filter(x => !x.selected);
    if (state.ideas.length === before) return; // nothing selected
    renderPanel();
  });

  $('tf-panel-dedup')?.addEventListener('click', () => {
    const seen = new Set();
    state.ideas = state.ideas.filter(x => {
      const key = x.idea.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    renderPanel();
  });

  $('tf-panel-clear')?.addEventListener('click', () => {
    if (!state.ideas.length) return;
    if (confirm('Clear all collected ideas?')) {
      state.ideas = [];
      renderPanel();
    }
  });

  $('tf-panel-preview')?.addEventListener('click', openPreviewModal);
  $('tf-panel-export')?.addEventListener('click', exportCSV);
}

// ─── Browse & Pick modal ──────────────────────────────────────

async function openBrowseModal(card, item) {
  const modal = document.getElementById('tf-browse-modal');
  const title = document.getElementById('tf-browse-modal-title');
  const body  = document.getElementById('tf-browse-list');
  if (!modal || !body) return;

  if (title) title.textContent = 'BROWSE & PICK';

  body.innerHTML = `<div class="tf-modal-state">
    <div class="tf-spinner"><div class="tf-spinner-ring"></div><div class="tf-spinner-ring"></div><div class="tf-spinner-ring"></div></div>
    <p>Fetching ideas...</p>
  </div>`;
  openModal(modal);

  try {
    const data = await apiFetch(
      `${API_BASE}/api/extract?url=${encodeURIComponent(item.url)}`,
      'Browse'
    );

    if (!data.success) {
      const msg = data.error === 'redirect'
        ? 'Google News redirect detected. Open the article in your browser, copy the final URL, and use EXTRACT with the pasted URL.'
        : (data.message || 'Could not extract ideas from this article.');
      body.innerHTML = `<div class="tf-modal-state"><p>${escHtml(msg)}</p></div>`;
      return;
    }

    if (!data.items?.length) {
      body.innerHTML = `<div class="tf-modal-state"><p>No ideas found in this article.</p></div>`;
      return;
    }

    state.currentBrowseItems = data.items;
    state.currentBrowseCard  = item;
    renderBrowseList(data.items, data.title || item.title);

  } catch (err) {
    let msg = 'Extraction failed.';
    if (err.code === 'connection') msg = 'Cannot connect to the API server.';
    else if (err.code === 'timeout') msg = 'Request timed out. Try again.';
    else if (err.message) msg = err.message;
    body.innerHTML = `<div class="tf-modal-state"><p>${escHtml(msg)}</p></div>`;
  }
}

function renderBrowseList(items, articleTitle) {
  const body   = document.getElementById('tf-browse-list');
  const addBtn = document.getElementById('tf-browse-add-btn');
  if (!body) return;

  body.innerHTML =
    `<div class="tf-browse-controls">
      <button class="tf-browse-ctrl-btn" id="browse-sel-all">SELECT ALL</button>
      <button class="tf-browse-ctrl-btn" id="browse-sel-none">NONE</button>
    </div>` +
    items.map((item, i) => `
      <label class="tf-browse-item">
        <input type="checkbox" data-index="${i}" checked>
        <span class="tf-browse-rank">${item.rank}</span>
        <span class="tf-browse-text">${escHtml(item.idea)}</span>
      </label>`).join('');

  body.querySelector('#browse-sel-all')?.addEventListener('click', () =>
    body.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true));
  body.querySelector('#browse-sel-none')?.addEventListener('click', () =>
    body.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false));

  if (addBtn) addBtn.onclick = () => {
    const checked = [...body.querySelectorAll('input[type="checkbox"]:checked')]
      .map(cb => items[parseInt(cb.dataset.index)]).filter(Boolean);
    if (!checked.length) { closeModal(document.getElementById('tf-browse-modal')); return; }
    addIdeasToPanel(checked, state.currentBrowseCard, articleTitle);
    closeModal(document.getElementById('tf-browse-modal'));
  };
}

// ─── Preview modal ────────────────────────────────────────────

function openPreviewModal() {
  const modal   = document.getElementById('tf-preview-modal');
  const tbody   = document.getElementById('tf-preview-tbody');
  const countEl = document.getElementById('tf-preview-count');
  if (!modal || !tbody) return;

  const count = state.ideas.length;
  if (countEl) countEl.textContent = `${count} idea${count !== 1 ? 's' : ''}`;

  if (!count) {
    tbody.innerHTML = `<tr><td colspan="6" class="tf-preview-empty">No ideas collected yet.</td></tr>`;
  } else {
    tbody.innerHTML = state.ideas.map(x => `
      <tr>
        <td class="tf-preview-rank">${x.rank}</td>
        <td class="tf-preview-idea">${escHtml(x.idea)}</td>
        <td>${escHtml(x.articleTitle)}</td>
        <td class="tf-preview-src">
          <a href="${escHtml(x.sourceUrl)}" target="_blank" rel="noopener noreferrer">link</a>
        </td>
        <td>${escHtml(platformLabel(x.platform))}</td>
        <td>${escHtml(x.date)}</td>
      </tr>`).join('');
  }

  openModal(modal);
}

// ─── CSV export ───────────────────────────────────────────────

function exportCSV() {
  if (!state.ideas.length) {
    alert('No ideas to export. Extract ideas from articles first.');
    return;
  }
  const headers = ['Rank', 'Idea', 'Article Title', 'Source URL', 'Platform', 'Date'];
  const rows    = state.ideas.map(x => [
    x.rank, csvCell(x.idea), csvCell(x.articleTitle),
    csvCell(x.sourceUrl), csvCell(platformLabel(x.platform)), csvCell(x.date),
  ].join(','));

  const csv  = '﻿' + [headers.join(','), ...rows].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), {
    href: url, download: `trend-ideas-${new Date().toISOString().slice(0,10)}.csv`,
  });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}

// ─── Modal helpers ────────────────────────────────────────────

function openModal(modal) {
  if (!modal) return;
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
  modal.querySelector('.tf-modal-close')?.focus();
}

function closeModal(modal) {
  if (!modal) return;
  modal.classList.remove('open');
  document.body.style.overflow = '';
}

function initModals() {
  document.querySelectorAll('.tf-modal').forEach(modal => {
    modal.querySelector('.tf-modal-close')?.addEventListener('click', () => closeModal(modal));
    modal.querySelector('.tf-modal-backdrop')?.addEventListener('click', () => closeModal(modal));
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape')
      document.querySelectorAll('.tf-modal.open').forEach(m => closeModal(m));
  });
}

// ─── Nav ─────────────────────────────────────────────────────

function initNav() {
  const mBtn  = document.querySelector('.nav-mobile-btn');
  const mMenu = document.querySelector('.nav-mobile-menu');
  if (mBtn && mMenu) {
    mBtn.addEventListener('click', () => {
      const open = mBtn.classList.toggle('open');
      mMenu.classList.toggle('open', open);
      mBtn.setAttribute('aria-expanded', open);
      document.body.style.overflow = open ? 'hidden' : '';
    });
    mMenu.querySelectorAll('a').forEach(a =>
      a.addEventListener('click', () => {
        mBtn.classList.remove('open');
        mMenu.classList.remove('open');
        document.body.style.overflow = '';
      })
    );
  }
}

// ─── Search events ────────────────────────────────────────────

function initSearch() {
  const inp     = document.getElementById('tf-search-input');
  const btn     = document.getElementById('tf-search-btn');
  const retryBtn = document.getElementById('tf-retry-btn');

  btn?.addEventListener('click', () => doSearch(inp?.value || ''));
  inp?.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(inp.value); });
  retryBtn?.addEventListener('click', () => { if (lastQuery) doSearch(lastQuery); });

  document.querySelectorAll('.tf-chip').forEach(chip =>
    chip.addEventListener('click', () => {
      const q = chip.dataset.q || chip.textContent.trim();
      if (inp) inp.value = q;
      doSearch(q);
    })
  );
}

// ─── Boot ─────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  initNav();
  initSearch();
  initPanelControls();
  initModals();
});
