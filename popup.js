'use strict';

const ENDPOINTS = {
  v4: 'https://api.ipify.org?format=json',
  v6: 'https://api6.ipify.org?format=json',
  any: 'https://api64.ipify.org?format=json', // whichever protocol this browser prefers
};

// Rating prompt tuning
const RATE_MIN_DAYS = 2;       // used on at least this many separate days
const RATE_MIN_LOOKUPS = 3;    // and at least this many successful lookups
const RATE_IGNORED_WAIT_DAYS = 2;  // if shown and ignored, wait this long before showing again
const RATE_LATER_WAIT_DAYS = 14;   // "Maybe later"
const RATE_MAX_IMPRESSIONS = 3;    // stop after this many ignored showings
const DAY_MS = 24 * 60 * 60 * 1000;

const $ = (id) => document.getElementById(id);
const DETAIL_KEYS = ['city', 'region', 'country', 'postal', 'loc', 'org', 'timezone'];

let busy = false;
let hasData = false;

/* ---------- Network ---------- */

async function fetchJson(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { cache: 'no-store', signal: controller.signal });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

function mapIpApi(d) {
  return {
    ip: d.ip ?? '',
    city: d.city ?? '',
    region: d.region ?? '',
    country: d.country_name ?? d.country ?? '',
    postal: d.postal ?? '',
    loc: d.latitude != null && d.longitude != null ? `${d.latitude}, ${d.longitude}` : '',
    org: d.org ?? d.org_name ?? '',
    timezone: d.timezone ?? '',
  };
}

function mapIpInfo(d) {
  return {
    ip: d.ip ?? '',
    city: d.city ?? '',
    region: d.region ?? '',
    country: d.country ?? '',
    postal: d.postal ?? '',
    loc: d.loc ?? '',
    org: d.org ?? '',
    timezone: d.timezone ?? '',
  };
}

// Location / ISP / timezone: ipapi first, ipinfo as fallback
async function getGeo() {
  try {
    return { fields: mapIpApi(await fetchJson('https://ipapi.co/json/')), source: 'https://ipapi.co/' };
  } catch (e) {
    console.warn('ipapi failed:', e);
  }
  return { fields: mapIpInfo(await fetchJson('https://ipinfo.io/json')), source: 'https://ipinfo.io/' };
}

/* ---------- Rendering ---------- */

function setIp(id, value, emptyText = 'Not detected') {
  const el = $(id);
  const btn = document.querySelector(`.copy[data-target="${id}"]`);
  if (value) {
    // Allow line breaks after each colon so long IPv6 addresses wrap cleanly;
    // <wbr> adds no text, so copying still gives the exact address.
    el.replaceChildren();
    value.split(':').forEach((part, i, all) => {
      el.append(part + (i < all.length - 1 ? ':' : ''));
      if (i < all.length - 1) el.append(document.createElement('wbr'));
    });
    el.classList.remove('muted');
    btn.disabled = false;
  } else {
    el.textContent = emptyText;
    el.classList.add('muted');
    btn.disabled = true;
  }
}

function render(data) {
  setIp('ipv4', data.v4);
  setIp('ipv6', data.v6, 'No IPv6 on this network');
  // Badge the address your browser actually uses by default
  $('pref4').hidden = !(data.v4 && data.preferred === data.v4);
  $('pref6').hidden = !(data.v6 && data.preferred === data.v6);
  DETAIL_KEYS.forEach((k) => { $(k).textContent = data.fields?.[k] || '—'; });

  const source = data.source || 'https://ipapi.co/';
  $('apiLink').href = source;
  $('apiLink').textContent = source.replace(/^https?:\/\//, '').replace(/\/$/, '');

  $('loading').hidden = true;
  $('info').hidden = false;
  hasData = true;
}

function setError(msg) {
  $('error').hidden = !msg;
  $('error').textContent = msg || '';
}

/* ---------- Theme (System -> Light -> Dark) ---------- */

const THEME_CYCLE = ['system', 'light', 'dark'];
const THEME_ICON = { system: '🖥️', light: '☀️', dark: '🌙' };
const THEME_NAME = { system: 'System', light: 'Light', dark: 'Dark' };

function getTheme() {
  try {
    const t = localStorage.getItem('theme');
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch (e) {
    return 'system';
  }
}

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;

  const btn = $('themeToggle');
  btn.textContent = THEME_ICON[theme];
  btn.setAttribute('aria-label', `Theme: ${THEME_NAME[theme]}`);
  btn.title = `Theme: ${THEME_NAME[theme]} (click to change)`;
}

function initTheme() {
  applyTheme(getTheme());
  $('themeToggle').addEventListener('click', () => {
    const next = THEME_CYCLE[(THEME_CYCLE.indexOf(getTheme()) + 1) % THEME_CYCLE.length];
    try {
      if (next === 'system') localStorage.removeItem('theme');
      else localStorage.setItem('theme', next);
    } catch (e) { /* ignore */ }
    applyTheme(next);
  });
}

/* ---------- Copy ---------- */

function initCopy() {
  document.querySelectorAll('.copy').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const value = $(btn.dataset.target).textContent;
      if (btn.disabled || !value) return;
      try {
        await navigator.clipboard.writeText(value);
        const original = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = original; }, 1200);
      } catch (err) {
        console.error('Copy failed:', err);
        setError('Unable to copy. Please select the address and copy it manually.');
      }
    });
  });
}

/* ---------- Rating prompt ---------- */

const RATE_DEFAULTS = { lookups: 0, days: 0, lastDay: '', shown: 0, snoozeUntil: 0, done: false };

async function getRateState() {
  const { rateState } = await chrome.storage.local.get('rateState');
  return { ...RATE_DEFAULTS, ...(rateState || {}) };
}

const saveRateState = (state) => chrome.storage.local.set({ rateState: state });

function localDay() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

async function recordSuccessAndMaybePrompt() {
  try {
    const state = await getRateState();
    state.lookups += 1;
    const today = localDay();
    if (state.lastDay !== today) {
      state.days += 1;
      state.lastDay = today;
    }

    const eligible =
      !state.done &&
      state.days >= RATE_MIN_DAYS &&
      state.lookups >= RATE_MIN_LOOKUPS &&
      Date.now() >= state.snoozeUntil;

    if (eligible) {
      // Count the impression up front: closing the popup without choosing
      // is treated as "ignored", so we back off instead of nagging.
      state.shown += 1;
      state.snoozeUntil = Date.now() + RATE_IGNORED_WAIT_DAYS * DAY_MS;
      if (state.shown >= RATE_MAX_IMPRESSIONS) state.done = true;
      await saveRateState(state);
      showRatePrompt();
      return;
    }
    await saveRateState(state);
  } catch (err) {
    console.warn('Rate state failed:', err);
  }
}

function showRatePrompt() {
  const box = $('ratePrompt');
  // Opens the reviews tab of this extension's own store listing
  $('rateYes').href = `https://chromewebstore.google.com/detail/${chrome.runtime.id}/reviews`;
  box.hidden = false;

  const finish = async (changes) => {
    box.hidden = true;
    try {
      const state = await getRateState();
      await saveRateState({ ...state, ...changes });
    } catch (err) {
      console.warn('Rate state failed:', err);
    }
  };

  $('rateYes').onclick = () => finish({ done: true });
  $('rateNo').onclick = () => finish({ done: true });
  $('rateLater').onclick = () => finish({ snoozeUntil: Date.now() + RATE_LATER_WAIT_DAYS * DAY_MS });
}

/* ---------- Main flow ---------- */

async function saveCache(data) {
  try {
    await chrome.storage.local.set({ lastIpInfo: { ...data, timestamp: Date.now() } });
  } catch (err) {
    console.warn('Cache save failed:', err);
  }
}

async function refresh() {
  if (busy) return;
  busy = true;
  $('refresh').disabled = true;
  setError(null);
  if (!hasData) $('loading').hidden = false;

  const [r4, r6, r64, rg] = await Promise.allSettled([
    fetchJson(ENDPOINTS.v4),
    fetchJson(ENDPOINTS.v6),
    fetchJson(ENDPOINTS.any),
    getGeo(),
  ]);

  // Diagnostics: right-click the popup > Inspect > Console to see these
  [['ipv4', r4], ['ipv6', r6], ['universal', r64]].forEach(([name, r]) => {
    if (r.status === 'rejected') console.warn(`${name} lookup failed:`, r.reason);
    else console.info(`${name} lookup returned:`, r.value.ip);
  });

  // Validate by format: some networks (e.g. NAT64) answer the IPv6 endpoint with an IPv4 address
  const isV4 = (x) => /^\d{1,3}(\.\d{1,3}){3}$/.test(x || '');
  const isV6 = (x) => typeof x === 'string' && x.includes(':');
  const val = (r) => (r.status === 'fulfilled' ? r.value.ip : '');
  let v4 = isV4(val(r4)) ? val(r4) : '';
  let v6 = isV6(val(r6)) ? val(r6) : '';
  const preferred = isV4(val(r64)) || isV6(val(r64)) ? val(r64) : '';
  const geo = rg.status === 'fulfilled' ? rg.value : null;

  // If a dedicated endpoint failed, the universal one can fill the gap
  if (preferred) {
    if (preferred.includes(':') && !v6) v6 = preferred;
    else if (!preferred.includes(':') && !v4) v4 = preferred;
  }

  // If the IP services failed, use whatever address the geo lookup returned
  if (!v4 && !v6 && geo?.fields.ip) {
    if (geo.fields.ip.includes(':')) v6 = geo.fields.ip;
    else v4 = geo.fields.ip;
  }

  if (v4 || v6 || geo) {
    const data = { v4, v6, preferred, fields: geo?.fields || {}, source: geo?.source };
    render(data);
    saveCache(data);
    await recordSuccessAndMaybePrompt();
  } else {
    $('loading').hidden = true;
    setError(hasData
      ? 'Could not refresh. Showing your last result.'
      : 'Unable to fetch IP information. Check your connection and try again.');
  }

  $('refresh').disabled = false;
  busy = false;
}

async function init() {
  initTheme();
  initCopy();
  $('refresh').addEventListener('click', refresh);

  // Show the last result instantly, then refresh live
  try {
    const { lastIpInfo } = await chrome.storage.local.get('lastIpInfo');
    if (lastIpInfo) render(lastIpInfo);
  } catch (err) {
    console.warn('Cache read failed:', err);
  }
  refresh();
}

init();
