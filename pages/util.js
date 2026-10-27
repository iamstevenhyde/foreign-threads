// Small helpers shared by all three pages. No game rules live here.
import { BUILD } from './build.js?v=c89ef327';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// h('div.card', {onclick: fn, dataset: {a: 1}}, child, 'text')
export function h(tagSpec, attrs, ...kids) {
  const m = /^([a-z0-9]*)((?:[.#][^.#]+)*)$/i.exec(tagSpec) || [null, 'div', ''];
  const el = document.createElement(m[1] || 'div');
  const cls = [];
  for (const t of m[2].match(/[.#][^.#]+/g) || []) { if (t[0] === '#') el.id = t.slice(1); else cls.push(t.slice(1)); }
  if (cls.length) el.className = cls.join(' ');
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'class') el.className += (el.className ? ' ' : '') + v;
    else if (k in el && k !== 'list') { try { el[k] = v; } catch (e) { el.setAttribute(k, v); } }
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

export const svgNS = 'http://www.w3.org/2000/svg';
export function s(tag, attrs, ...kids) {
  const el = document.createElementNS(svgNS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v !== null && v !== undefined) el.setAttribute(k, v);
  for (const kid of kids.flat()) if (kid) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return el;
}

// Money. The engine speaks in millions of dollars.
export const fmtM = n => (n < 0 ? '-' : '') + '$' + Math.round(Math.abs(n)).toLocaleString('en-US') + 'M';
export const fmtSigned = n => (n < 0 ? '-' : '+') + '$' + Math.round(Math.abs(n)).toLocaleString('en-US') + 'M';
export const fmtBig = n => (Math.abs(n) >= 1000 ? '$' + (n / 1000).toFixed(1) + 'B' : fmtM(n));
export const pct = (x, d = 0) => (x >= 0 ? '+' : '-') + Math.abs(x * 100).toFixed(d) + '%';
export const mmss = ms => {
  const t = Math.max(0, Math.ceil(ms / 1000));
  return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
};
export const wordCount = t => (String(t || '').trim().match(/\S+/g) || []).length;
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

// URL params. The game id lives in the URL (?g=WW-7K2M) so a reload or stale tab finds the same game.
export const params = () => new URLSearchParams(location.search);
export function setParam(k, v) {
  const p = params();
  if (v === null || v === undefined) p.delete(k); else p.set(k, v);
  history.replaceState(null, '', location.pathname + (p.toString() ? '?' + p.toString() : '') + location.hash);
}
export const safeGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
export const safeSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private window */ } };
export const safeDel = k => { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } };
export const safeSessionGet = k => { try { return sessionStorage.getItem(k); } catch (e) { return null; } };
export const safeSessionSet = (k, v) => { try { sessionStorage.setItem(k, v); } catch (e) { /* ignore */ } };

// Mode: file:// and localhost open in local mode, other http(s) hosts open live. ?local=1 or ?live=1 forces either.
export function pageMode() {
  const p = params();
  if (p.get('live') === '1') return 'live';
  if (p.get('local') === '1') return 'local';
  // file:// and localhost open in local mode (no Supabase). Anything else is live.
  return location.protocol === 'file:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1' ? 'local' : 'live';
}

export const uid = (n = 12) => {
  const a = 'abcdefghjkmnpqrstuvwxyz23456789'; let o = '';
  for (let i = 0; i < n; i++) o += a[Math.floor(Math.random() * a.length)];
  return o;
};
// Codes avoid 0, O, 1, I (spec 05 section 3.2).
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const makeCode = (n = 4) => { let o = ''; for (let i = 0; i < n; i++) o += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]; return o; };
export const makeGameId = () => 'WW-' + makeCode(4);

export function toast(msg, ms = 3500) {
  let box = document.getElementById('toasts');
  if (!box) { box = h('div'); box.id = 'toasts'; document.body.append(box); }
  const t = h('div.toast', msg); box.append(t);
  setTimeout(() => t.remove(), ms);
}
export function download(name, text, type = 'application/json') {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a); a.click(); a.remove();
}

// A plain-words version of a startup error. The common one before class: the Supabase tables have not been created yet.
export function friendlyError(e) {
  const m = String((e && e.message) || e);
  if (/ww_games|schema cache|relation .* does not exist/i.test(m)) return 'The Supabase tables for this game have not been created yet. In Supabase, open project ziszzyvlevgsjiazgogr, SQL editor, paste the whole file pages/schema.sql, press Run, then reload this page. To try the game on one laptop without Supabase, add ?local=1 to the address.';
  return m;
}

// A small build id in the corner of every page (10/27), so the host can see which build this tab loaded. Added once, never blocks anything.
export const buildLabel = () => 'build ' + BUILD.id + (BUILD.date ? ' / ' + BUILD.date : '');
if (typeof document !== 'undefined' && document.body && !document.getElementById('buildid')) {
  const el = document.createElement('div'); el.id = 'buildid'; el.textContent = buildLabel();
  el.style.cssText = 'position:fixed;right:6px;bottom:3px;font:10px/1 monospace;opacity:.55;z-index:1;pointer-events:none;color:#6b665c';
  document.body.appendChild(el);
}
