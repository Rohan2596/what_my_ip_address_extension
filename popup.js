'use strict';

// DOM references
const DOM = {
  loading: document.getElementById('loading'),
  info: document.getElementById('info'),
  error: document.getElementById('error'),
  apiLink: document.getElementById('apiLink'),
  refresh: document.getElementById('refresh'),
  copyIp: document.getElementById('copyIp'),
  set(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text ?? '—';
  },
};

/**
 * Fetch JSON data safely with timeout and no-cache.
 */
async function fetchJson(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { cache: 'no-store', signal: controller.signal });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Retrieve IP information from APIs (ipapi -> ipinfo fallback).
 */
async function getIpInfo() {
  showLoading(true);
  setError(null);

  try {
    const data = await fetchJson('https://ipapi.co/json/');
    populate(mapIpApi(data), 'https://ipapi.co/');
    saveCache(mapIpApi(data), 'https://ipapi.co/');
    return;
  } catch (e) {
    console.warn('ipapi failed:', e);
  }

  try {
    const data = await fetchJson('https://ipinfo.io/json');
    populate(mapIpInfo(data), 'https://ipinfo.io/');
    saveCache(mapIpInfo(data), 'https://ipinfo.io/');
    return;
  } catch (e) {
    console.warn('ipinfo failed:', e);
  }

  showLoading(false);
  setError('Unable to fetch IP information. Please check your connection or try again later.');
}

/**
 * Data mappers for APIs
 */
function mapIpApi(data) {
  return {
    ip: data.ip ?? '',
    version: data.version ?? '',
    city: data.city ?? '',
    region: data.region ?? '',
    country: data.country_name ?? data.country ?? '',
    postal: data.postal ?? '',
    loc: data.latitude && data.longitude ? `${data.latitude}, ${data.longitude}` : (data.loc ?? ''),
    org: data.org ?? data.org_name ?? '',
    timezone: data.timezone ?? '',
  };
}

function mapIpInfo(data) {
  return {
    ip: data.ip ?? '',
    version: data.version ?? '',
    city: data.city ?? '',
    region: data.region ?? '',
    country: data.country ?? '',
    postal: data.postal ?? '',
    loc: data.loc ?? '',
    org: data.org ?? '',
    timezone: data.timezone ?? '',
  };
}

/**
 * Update UI with data
 */
function populate(fields, apiSource) {
  Object.entries(fields).forEach(([key, value]) => DOM.set(key, value || '—'));

  DOM.apiLink.href = apiSource;
  DOM.apiLink.textContent = apiSource.replace(/^https?:\/\//, '');

  // Copy button
  DOM.copyIp.onclick = async () => {
    if (!fields.ip) return;
    try {
      await navigator.clipboard.writeText(fields.ip);
      const b = DOM.copyIp;
      const original = b.textContent;
      b.textContent = 'Copied!';
      b.setAttribute('aria-live', 'assertive');
      setTimeout(() => {
        b.textContent = original;
        b.removeAttribute('aria-live');
      }, 1200);
    } catch (err) {
      console.error('Copy failed:', err);
      setError('Unable to copy IP. Please try again.');
    }
  };

  showLoading(false);
  DOM.info.hidden = false;
  DOM.error.hidden = true;
}

/**
 * UI state helpers
 */
function showLoading(show) {
  DOM.loading.hidden = !show;
  DOM.info.hidden = show;
}

function setError(msg) {
  if (!msg) {
    DOM.error.hidden = true;
    DOM.error.textContent = '';
    return;
  }
  DOM.error.hidden = false;
  DOM.error.textContent = msg;
  DOM.error.setAttribute('role', 'alert');
}

/**
 * Local caching for faster next load
 */
async function saveCache(fields, source) {
  try {
    await chrome.storage.local.set({
      lastIpInfo: { fields, source, timestamp: Date.now() },
    });
  } catch (err) {
    console.warn('Cache save failed:', err);
  }
}

/**
 * Initialize popup
 */
async function init() {
  DOM.refresh.addEventListener('click', getIpInfo);

  try {
    const cached = await chrome.storage.local.get(['lastIpInfo']);
    if (cached?.lastIpInfo?.fields) {
      populate(cached.lastIpInfo.fields, cached.lastIpInfo.source || 'https://ipapi.co/');
    }
  } catch (err) {
    console.warn('Cache read failed:', err);
  }

  // Always refresh live
  await getIpInfo();
}

init();
