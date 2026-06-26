'use strict';

/* ─── Config ───────────────────────────────────────────────── */
const API_BASE = 'http://localhost:5000';
const TIMEOUT_MS = 30000;

/* ─── DOM refs ─────────────────────────────────────────────── */
const navEl         = document.getElementById('nav');
const mobileBtn     = document.getElementById('nav-mobile-btn');
const mobileMenu    = document.getElementById('nav-mobile-menu');
const tfInput       = document.getElementById('tf-input');
const tfBtn         = document.getElementById('tf-btn');
const resultsSection = document.getElementById('tf-results-section');
const resultsHeader  = document.getElementById('tf-results-header');
const queryDisplay   = document.getElementById('tf-query-display');
const resultsSub     = document.getElementById('tf-results-sub');
const loadingEl      = document.getElementById('tf-loading');
const gridEl         = document.getElementById('tf-grid');
const emptyEl        = document.getElementById('tf-empty');
const errorEl        = document.getElementById('tf-error');
const retryBtn       = document.getElementById('tf-retry-btn');
const retryEmpty     = document.getElementById('tf-retry-empty');

/* ─── Nav scroll ───────────────────────────────────────────── */
(function initNavScroll() {
  const sentinel = document.createElement('div');
  sentinel.style.cssText = 'position:absolute;top:0;height:1px;width:1px;pointer-events:none';
  document.body.prepend(sentinel);
  new IntersectionObserver(
    ([e]) => navEl.classList.toggle('scrolled', !e.isIntersecting),
    { threshold: 0, rootMargin: '-1px 0px 0px 0px' }
  ).observe(sentinel);
})();

/* ─── Mobile nav ───────────────────────────────────────────── */
mobileBtn.addEventListener('click', () => {
  const open = mobileMenu.classList.toggle('open');
  mobileBtn.classList.toggle('open', open);
  mobileBtn.setAttribute('aria-expanded', String(open));
  mobileMenu.setAttribute('aria-hidden', String(!open));
  document.body.style.overflow = open ? 'hidden' : '';
});

mobileMenu.querySelectorAll('a').forEach(a => {
  a.addEventListener('click', closeMobileMenu);
});

function closeMobileMenu() {
  mobileMenu.classList.remove('open');
  mobileBtn.classList.remove('open');
  mobileBtn.setAttribute('aria-expanded', 'false');
  mobileMenu.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

/* ─── Chip clicks ──────────────────────────────────────────── */
document.querySelectorAll('.tf-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    tfInput.value = chip.dataset.query || '';
    doSearch();
  });
});

/* ─── Keyboard & button events ─────────────────────────────── */
tfInput.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
tfBtn.addEventListener('click', doSearch);
retryBtn.addEventListener('click', doSearch);
retryEmpty.addEventListener('click', () => { tfInput.focus(); resultsHeader.classList.remove('visible'); });

/* ─── Main search ──────────────────────────────────────────── */
async function doSearch() {
  const query = tfInput.value.trim();
  if (!query) {
    pulseSearchBox();
    return;
  }

  // Show header
  queryDisplay.textContent = query;
  resultsSub.textContent = '';
  resultsHeader.classList.add('visible');

  setLoading(true);
  showState('loading');

  // Smooth-scroll to results
  setTimeout(() => {
    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 120);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await fetch(
      `${API_BASE}/api/trends?q=${encodeURIComponent(query)}`,
      { signal: controller.signal }
    );
    clearTimeout(timer);

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();

    if (!data.success) {
      showState('error');
      return;
    }

    if (!data.results || data.results.length === 0) {
      showState('empty');
      return;
    }

    renderResults(data.results);
    const count = data.results.length;
    resultsSub.textContent = `${count} trending result${count !== 1 ? 's' : ''} found`;
    showState('results');

  } catch (err) {
    if (err.name === 'AbortError') {
      resultsSub.textContent = 'Request timed out after 30 s.';
    }
    console.error('[TrendFinder] Search error:', err);
    showState('error');
  } finally {
    setLoading(false);
  }
}

/* ─── State management ─────────────────────────────────────── */
function showState(state) {
  loadingEl.classList.toggle('visible', state === 'loading');
  gridEl.classList.toggle('visible',   state === 'results');
  emptyEl.classList.toggle('visible',  state === 'empty');
  errorEl.classList.toggle('visible',  state === 'error');
}

function setLoading(on) {
  tfBtn.disabled   = on;
  tfInput.disabled = on;
  const label = tfBtn.querySelector('.btn-label');
  if (label) label.textContent = on ? 'Searching...' : 'Search Trends';
}

/* ─── Render results ───────────────────────────────────────── */
function renderResults(results) {
  gridEl.innerHTML = '';

  results.forEach((item, idx) => {
    const card = document.createElement('article');
    card.className = 'tf-card';
    card.setAttribute('role', 'listitem');
    card.style.animationDelay = `${idx * 80}ms`;

    const imgHtml  = buildImage(item);
    const src      = escHtml(item.source || 'Web');
    const title    = escHtml(item.title  || 'Untitled');
    const descHtml = item.description
      ? `<p class="tf-card-desc">${escHtml(item.description)}</p>`
      : '';
    const safeHref = sanitizeUrl(item.url);

    card.innerHTML = `
      ${imgHtml}
      <div class="tf-card-body">
        <span class="tf-card-source">${src}</span>
        <h3 class="tf-card-title">${title}</h3>
        ${descHtml}
        <a
          href="${safeHref}"
          target="_blank"
          rel="noopener noreferrer"
          class="btn btn-ghost tf-card-link"
          aria-label="Open ${escHtml(item.title)} in new tab"
        >
          Open Source
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
            <polyline points="15 3 21 3 21 9"/>
            <line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
        </a>
      </div>
    `;

    gridEl.appendChild(card);
  });
}

function buildImage(item) {
  if (item.image && item.image.startsWith('http')) {
    return `
      <div class="tf-card-img">
        <img
          src="${escHtml(item.image)}"
          alt="${escHtml(item.title)}"
          loading="lazy"
          onerror="this.closest('.tf-card-img').innerHTML='${placeholderIconEscaped()}'"
        />
      </div>`;
  }
  return `
    <div class="tf-card-img tf-card-img-placeholder">
      ${placeholderIconHtml()}
    </div>`;
}

function placeholderIconHtml() {
  return `<svg class="tf-placeholder-icon" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="1.2" aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="2"/>
    <circle cx="8.5" cy="8.5" r="1.5"/>
    <polyline points="21 15 16 10 5 21"/>
  </svg>`;
}

// Pre-escaped version for use inside an onerror attribute string
function placeholderIconEscaped() {
  return placeholderIconHtml()
    .replace(/"/g, '&quot;')
    .replace(/'/g, "\\'");
}

/* ─── Utilities ────────────────────────────────────────────── */
function escHtml(str) {
  if (typeof str !== 'string') return '';
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function sanitizeUrl(url) {
  if (!url || typeof url !== 'string') return '#';
  try {
    const p = new URL(url);
    if (p.protocol !== 'http:' && p.protocol !== 'https:') return '#';
    return p.href;
  } catch {
    return '#';
  }
}

function pulseSearchBox() {
  const box = document.getElementById('tf-search-box');
  tfInput.focus();
  box.style.borderColor = 'rgba(198,165,89,0.85)';
  box.style.boxShadow   = '0 0 0 3px rgba(198,165,89,0.2)';
  setTimeout(() => {
    box.style.borderColor = '';
    box.style.boxShadow   = '';
  }, 1400);
}
