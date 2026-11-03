// ==UserScript==
// @name         Torn Jin Scripthub
// @namespace    https://github.com/JintheGreat-4k/torn-jin-scripthub
// @version      1.0.0
// @description  One userscript, many Torn tools: switch individual modules (Stock ROI, Chain Alarm, ...) on and off from a single hub. Uses the official Torn API only.
// @author       JintheGreat-4k
// @match        https://www.torn.com/*
// @match        https://torn.com/*
// @run-at       document-idle
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @grant        GM_registerMenuCommand
// @connect      api.torn.com
// @connect      *
// @homepageURL  https://github.com/JintheGreat-4k/torn-jin-scripthub
// @supportURL   https://github.com/JintheGreat-4k/torn-jin-scripthub/issues
// @updateURL    https://raw.githubusercontent.com/JintheGreat-4k/torn-jin-scripthub/main/dist/torn-jin-scripthub.user.js
// @downloadURL  https://raw.githubusercontent.com/JintheGreat-4k/torn-jin-scripthub/main/dist/torn-jin-scripthub.user.js
// ==/UserScript==

// GENERATED FILE – do not edit. Edit the sources in src/ and run `npm run build`.
// Modules: stock-roi@1.1.0, chain-alarm@1.1.0

(function () {
  'use strict';
  const HUB_META = {"name":"Torn Jin Scripthub","version":"1.0.0","repo":"JintheGreat-4k/torn-jin-scripthub"};

// ===== src/hub/core.js =====
// Hub core: storage, Torn API access, module registry/lifecycle and the hub UI.
// Bundle scope provides HUB_META (injected by tools/build.mjs).
// See docs/architecture.md for the full picture.

const Hub = (() => {
  // Torn PDA replaces this placeholder with the user's API key when it injects the script.
  const PDA_KEY = '###PDA-APIKEY###';
  const LOG_PREFIX = '[JinHub]';
  const has = {
    getValue: typeof GM_getValue === 'function',
    setValue: typeof GM_setValue === 'function',
    deleteValue: typeof GM_deleteValue === 'function',
    addListener: typeof GM_addValueChangeListener === 'function',
    removeListener: typeof GM_removeValueChangeListener === 'function',
    xhr: typeof GM_xmlhttpRequest === 'function',
    notification: typeof GM_notification === 'function',
    menu: typeof GM_registerMenuCommand === 'function',
  };

  // ---------------------------------------------------------------------------
  // Storage: GM storage (shared across all Torn tabs of this script),
  // falling back to localStorage (Torn PDA / managers without GM_* support).
  // ---------------------------------------------------------------------------
  const LS_PREFIX = 'jinhub:';
  const store = {
    get(key, def) {
      if (has.getValue) {
        try { return GM_getValue(key, def); } catch (e) { /* fall through */ }
      }
      try {
        const v = localStorage.getItem(LS_PREFIX + key);
        return v === null ? def : JSON.parse(v);
      } catch (e) { return def; }
    },
    set(key, value) {
      if (has.setValue) {
        try { GM_setValue(key, value); return; } catch (e) { /* fall through */ }
      }
      try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(value)); } catch (e) { /* full / blocked */ }
    },
    del(key) {
      if (has.deleteValue) {
        try { GM_deleteValue(key); return; } catch (e) { /* fall through */ }
      }
      try { localStorage.removeItem(LS_PREFIX + key); } catch (e) { /* ignore */ }
    },
    // fn(newValue, oldValue, remote) – remote = change came from another tab. Returns unsubscribe.
    onChange(key, fn) {
      if (has.addListener) {
        try {
          const id = GM_addValueChangeListener(key, (name, oldV, newV, remote) => fn(newV, oldV, !!remote));
          return () => { if (has.removeListener) try { GM_removeValueChangeListener(id); } catch (e) { /* ignore */ } };
        } catch (e) { /* fall through */ }
      }
      const handler = (ev) => {
        if (ev.key !== LS_PREFIX + key) return;
        const parse = (s) => { try { return s === null ? undefined : JSON.parse(s); } catch (e) { return undefined; } };
        fn(parse(ev.newValue), parse(ev.oldValue), true);
      };
      window.addEventListener('storage', handler);
      return () => window.removeEventListener('storage', handler);
    },
    scoped(prefix) {
      return {
        get: (k, d) => store.get(prefix + k, d),
        set: (k, v) => store.set(prefix + k, v),
        del: (k) => store.del(prefix + k),
        onChange: (k, fn) => store.onChange(prefix + k, fn),
      };
    },
  };

  // ---------------------------------------------------------------------------
  // API key
  // ---------------------------------------------------------------------------
  const isPda = () => !!PDA_KEY && !PDA_KEY.startsWith('#');
  function getApiKey() {
    if (isPda()) return PDA_KEY;
    return String(store.get('hub:apiKey', '') || '').trim();
  }
  const keyListeners = new Set();
  const emitKeyChange = () => keyListeners.forEach((fn) => { try { fn(getApiKey()); } catch (e) { console.error(e); } });
  function setApiKey(v) {
    store.set('hub:apiKey', String(v || '').trim());
    emitKeyChange();
  }

  // ---------------------------------------------------------------------------
  // HTTP: GM_xmlhttpRequest (no CORS/CSP limits) with a fetch() fallback.
  // Resolves { status, text, response } – never rejects on HTTP status codes.
  // ---------------------------------------------------------------------------
  function request({ url, method = 'GET', timeout = 15000, responseType, headers, data } = {}) {
    if (has.xhr) {
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method, url, timeout, headers, data, responseType,
          onload: (r) => resolve({ status: r.status, text: responseType ? '' : r.responseText, response: r.response }),
          onerror: () => reject(new Error('Network error')),
          ontimeout: () => reject(new Error('Request timed out')),
        });
      });
    }
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), timeout) : null;
    return fetch(url, { method, headers, body: data, signal: ctl && ctl.signal })
      .then(async (r) => {
        const response = responseType === 'arraybuffer' ? await r.arrayBuffer()
          : responseType === 'blob' ? await r.blob() : null;
        const text = response ? '' : await r.text();
        return { status: r.status, text, response: response || text };
      })
      .catch((e) => { throw new Error(e && e.name === 'AbortError' ? 'Request timed out' : 'Network error'); })
      .finally(() => { if (timer) clearTimeout(timer); });
  }

  class ApiError extends Error {
    constructor(message, code) { super(message); this.name = 'ApiError'; this.apiCode = code; }
  }

  // Builds a Torn API URL. `path` is relative to https://api.torn.com/ (e.g. "user/?selections=bars",
  // "v2/faction/chain"). Throws ApiError('NO_KEY') when no key is configured.
  function apiUrl(path, { key, comment } = {}) {
    const k = key || getApiKey();
    if (!k) throw new ApiError('No API key set – open the Scripthub (🧩 tab) and enter your key.', 'NO_KEY');
    const base = /^https?:/.test(path) ? path : 'https://api.torn.com/' + String(path).replace(/^\/+/, '');
    const sep = base.includes('?') ? '&' : '?';
    const c = comment ? `&comment=${encodeURIComponent(comment)}` : '';
    return `${base}${sep}key=${encodeURIComponent(k)}${c}`;
  }

  // Fetches and parses a Torn API endpoint. Throws ApiError for Torn error payloads (e.apiCode).
  async function api(path, opts = {}) {
    const r = await request({ url: apiUrl(path, opts), timeout: opts.timeout || 15000 });
    let json;
    try { json = JSON.parse(r.text); } catch (e) { throw new ApiError(`Unreadable API response (HTTP ${r.status})`, 'PARSE'); }
    if (json && json.error) throw new ApiError(`API error ${json.error.code}: ${json.error.error}`, json.error.code);
    return json;
  }

  // ---------------------------------------------------------------------------
  // Notifications
  // ---------------------------------------------------------------------------
  function notify({ title, text, timeout = 15000, onclick } = {}) {
    try {
      if (has.notification) { GM_notification({ title, text, timeout, onclick }); return; }
      if (typeof Notification === 'function' && Notification.permission === 'granted') {
        const n = new Notification(title, { body: text });
        if (onclick) n.onclick = onclick;
        setTimeout(() => n.close(), timeout);
      }
    } catch (e) { /* notifications are best effort */ }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function el(html) {
    const t = document.createElement('template');
    t.innerHTML = String(html).trim();
    return t.content.firstElementChild;
  }

  // ---------------------------------------------------------------------------
  // Module registry & lifecycle
  // ---------------------------------------------------------------------------
  const modules = new Map();   // id -> record

  // Called by the generated bundle once per module. The returned object is the module's `MODULE`;
  // the module code assigns MODULE.start = (ctx) => { ...; return optionalCleanup; }.
  function define(meta) {
    if (modules.has(meta.id)) throw new Error(`${LOG_PREFIX} duplicate module id "${meta.id}"`);
    const rec = { meta, start: null, run: null, status: 'off', error: null };
    modules.set(meta.id, rec);
    return rec;
  }

  function createContext(rec) {
    const { meta } = rec;
    const cleanups = [];
    let alive = true;
    const addCleanup = (fn) => { if (alive) cleanups.push(fn); else fn(); };
    const timers = new Set();
    const ctx = {
      id: meta.id,
      meta,
      get alive() { return alive; },
      store: (() => {
        const s = store.scoped(`mod:${meta.id}:`);
        return { ...s, onChange: (k, fn) => { const off = s.onChange(k, fn); addCleanup(off); return off; } };
      })(),
      getApiKey,
      isPda,
      // fn(newKey) runs when the API key is saved in this or another tab.
      onApiKeyChange(fn) {
        keyListeners.add(fn);
        addCleanup(() => keyListeners.delete(fn));
      },
      apiUrl: (path, o = {}) => apiUrl(path, { comment: meta.apiComment || meta.id, ...o }),
      api: (path, o = {}) => api(path, { comment: meta.apiComment || meta.id, ...o }),
      request,
      notify,
      esc,
      el,
      openHub: () => ui.open(true),
      log: (...a) => console.log(`${LOG_PREFIX}[${meta.id}]`, ...a),
      warn: (...a) => console.warn(`${LOG_PREFIX}[${meta.id}]`, ...a),
      onCleanup: addCleanup,
      addStyle(css) {
        const s = document.createElement('style');
        s.dataset.jinhub = meta.id;
        s.textContent = css;
        (document.head || document.documentElement).appendChild(s);
        addCleanup(() => s.remove());
        return s;
      },
      mount(node, parent = document.body) {
        parent.appendChild(node);
        addCleanup(() => node.remove());
        return node;
      },
      on(target, type, fn, opts) {
        target.addEventListener(type, fn, opts);
        addCleanup(() => target.removeEventListener(type, fn, opts));
      },
      setInterval(fn, ms) {
        const h = setInterval(fn, ms);
        addCleanup(() => clearInterval(h));
        return h;
      },
      setTimeout(fn, ms) {
        const h = setTimeout(() => { timers.delete(h); fn(); }, ms);
        timers.add(h);
        return h;
      },
      // Adds a tab to the hub's launcher dock on the left screen edge.
      addLauncher({ label, title, onClick }) {
        const b = ui.addLauncher(meta.id, { label, title, onClick });
        addCleanup(() => b.remove());
        return b;
      },
    };
    addCleanup(() => { timers.forEach(clearTimeout); timers.clear(); });
    return {
      ctx,
      dispose() {
        if (!alive) return;
        alive = false;
        while (cleanups.length) {
          const fn = cleanups.pop();
          try { fn(); } catch (e) { console.error(`${LOG_PREFIX}[${meta.id}] cleanup failed`, e); }
        }
      },
    };
  }

  const enabledMap = () => store.get('hub:enabled', {}) || {};
  function isEnabled(rec) {
    const m = enabledMap();
    return Object.prototype.hasOwnProperty.call(m, rec.meta.id) ? !!m[rec.meta.id] : !!rec.meta.defaultEnabled;
  }
  function pageMatches(rec) {
    const inc = rec.meta.include;
    if (!inc || !inc.length) return true;
    return inc.some((re) => { try { return new RegExp(re).test(location.href); } catch (e) { return false; } });
  }

  function startModule(rec) {
    if (rec.run) return;
    rec.error = null;
    if (!pageMatches(rec)) { rec.status = 'other-page'; return; }
    if (typeof rec.start !== 'function') { rec.status = 'error'; rec.error = 'Module has no start()'; return; }
    const run = createContext(rec);
    rec.run = run;
    rec.status = 'running';
    const fail = (e) => {
      console.error(`${LOG_PREFIX}[${rec.meta.id}] failed to start`, e);
      run.dispose();
      if (rec.run === run) rec.run = null;
      rec.status = 'error';
      rec.error = (e && e.message) || String(e);
      ui.render();
    };
    try {
      const ret = rec.start(run.ctx);
      if (typeof ret === 'function') run.ctx.onCleanup(ret);
      else if (ret && typeof ret.then === 'function') {
        ret.then((fn) => { if (typeof fn === 'function') run.ctx.onCleanup(fn); }, fail);
      }
    } catch (e) { fail(e); }
  }

  function stopModule(rec) {
    if (rec.run) { rec.run.dispose(); rec.run = null; }
    rec.status = 'off';
    rec.error = null;
  }

  function setEnabled(id, on) {
    const rec = modules.get(id);
    if (!rec) return;
    store.set('hub:enabled', { ...enabledMap(), [id]: !!on });
    apply(rec);
    ui.render();
  }

  // Brings a module's running state in line with its stored enabled flag.
  function apply(rec) {
    if (isEnabled(rec)) { if (!rec.run) startModule(rec); }
    else if (rec.run || rec.status !== 'off') stopModule(rec);
  }

  // ---------------------------------------------------------------------------
  // UI: launcher dock (left edge) + hub panel
  // ---------------------------------------------------------------------------
  const ui = (() => {
    const CSS = `
    #jinhub-dock{position:fixed;left:0;top:38%;z-index:999990;display:flex;flex-direction:column;gap:6px;pointer-events:none}
    #jinhub-dock .jinhub-tab{pointer-events:auto;background:#1f2430;color:#cde;border:1px solid #4a5a7a;border-left:0;
      border-radius:0 6px 6px 0;padding:8px 5px;cursor:pointer;font:bold 12px Arial,sans-serif;writing-mode:vertical-rl;
      box-shadow:2px 2px 6px rgba(0,0,0,.4);user-select:none}
    #jinhub-dock .jinhub-tab:hover{background:#2a3242}
    #jinhub-dock .jinhub-tab.hub{color:#fc6;border-color:#a83}
    #jinhub-panel{position:fixed;top:60px;left:50%;transform:translateX(-50%);z-index:2147483100;width:min(560px,96vw);
      max-height:84vh;overflow:auto;display:none;background:#1b1d22;color:#ddd;border:1px solid #555;border-radius:8px;
      box-shadow:0 8px 30px rgba(0,0,0,.6);font:13px/1.4 Arial,sans-serif}
    #jinhub-panel.open{display:block}
    #jinhub-panel *{box-sizing:border-box}
    #jinhub-panel .hd{display:flex;align-items:center;gap:8px;padding:9px 12px;background:#262a33;border-bottom:1px solid #3a3f4a;
      border-radius:8px 8px 0 0;position:sticky;top:0}
    #jinhub-panel .hd b{font-size:15px;color:#fff}
    #jinhub-panel .hd .v{color:#999;font-size:11px;margin-right:auto}
    #jinhub-panel button{background:#3a3f4c;color:#eee;border:1px solid #666;border-radius:4px;padding:4px 10px;cursor:pointer;font-size:12px}
    #jinhub-panel button:hover{background:#4a5060}
    #jinhub-panel section{padding:10px 12px;border-bottom:1px solid #30343d}
    #jinhub-panel h3{margin:0 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#9ab}
    #jinhub-panel .key{display:flex;gap:6px}
    #jinhub-panel .key input{flex:1;min-width:0;background:#111;color:#eee;border:1px solid #555;border-radius:4px;padding:4px 6px}
    #jinhub-panel small,#jinhub-panel .muted{color:#888}
    #jinhub-panel .mod{display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-top:1px solid #2a2d35}
    #jinhub-panel .mod:first-of-type{border-top:0}
    #jinhub-panel .mod .info{flex:1;min-width:0}
    #jinhub-panel .mod .name{font-weight:bold;color:#fff}
    #jinhub-panel .mod .name .ver{font-weight:normal;color:#888;font-size:11px;margin-left:4px}
    #jinhub-panel .mod .desc{color:#bbb;font-size:12px;margin-top:2px}
    #jinhub-panel .mod .meta{font-size:11px;margin-top:3px;display:flex;gap:10px;flex-wrap:wrap}
    #jinhub-panel .mod .meta a{color:#8ab4f8;text-decoration:none}
    #jinhub-panel .st-running{color:#6d6}#jinhub-panel .st-error{color:#f77}#jinhub-panel .st-off{color:#888}
    #jinhub-panel .st-other-page{color:#cb6}
    #jinhub-panel .sw{position:relative;flex:0 0 38px;height:20px;margin-top:2px;cursor:pointer}
    #jinhub-panel .sw input{opacity:0;width:0;height:0;position:absolute}
    #jinhub-panel .sw span{position:absolute;inset:0;background:#555;border-radius:20px;transition:.15s}
    #jinhub-panel .sw span:before{content:"";position:absolute;width:16px;height:16px;left:2px;top:2px;background:#eee;border-radius:50%;transition:.15s}
    #jinhub-panel .sw input:checked+span{background:#3a8a3a}
    #jinhub-panel .sw input:checked+span:before{transform:translateX(18px)}
    #jinhub-panel .sw input:focus-visible+span{outline:2px solid #8ab4f8}
    #jinhub-panel .ft{padding:8px 12px;font-size:11px;color:#888;display:flex;gap:12px;flex-wrap:wrap}
    #jinhub-panel .ft a{color:#8ab4f8;text-decoration:none}
    `;
    let dock = null, panel = null, keyMsg = '';

    function init() {
      const style = document.createElement('style');
      style.id = 'jinhub-style';
      style.textContent = CSS;
      (document.head || document.documentElement).appendChild(style);

      dock = el('<div id="jinhub-dock"></div>');
      const hubTab = el('<div class="jinhub-tab hub" title="Torn Jin Scripthub – modules & settings">🧩 Hub</div>');
      hubTab.addEventListener('click', () => open(!panel.classList.contains('open')));
      dock.appendChild(hubTab);
      document.body.appendChild(dock);

      panel = el('<div id="jinhub-panel" role="dialog" aria-label="Torn Jin Scripthub"></div>');
      document.body.appendChild(panel);
      panel.addEventListener('click', onClick);
      panel.addEventListener('change', onChange);
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && panel.classList.contains('open')) open(false); });

      if (has.menu) {
        try { GM_registerMenuCommand('Open Torn Jin Scripthub', () => open(true)); } catch (e) { /* ignore */ }
      }
    }

    function addLauncher(id, { label, title, onClick: handler }) {
      const b = el(`<div class="jinhub-tab" data-mod="${esc(id)}"></div>`);
      b.textContent = label;
      if (title) b.title = title;
      b.addEventListener('click', handler);
      dock.appendChild(b);
      return b;
    }

    function open(on) {
      if (!panel) return;
      panel.classList.toggle('open', !!on);
      if (on) render();
    }

    const STATUS = {
      running: '● running',
      off: '○ off',
      error: '⚠ error',
      'other-page': '◌ enabled – not active on this page',
    };

    function render() {
      if (!panel || !panel.classList.contains('open')) return;
      const pda = isPda();
      const key = pda ? '' : store.get('hub:apiKey', '');
      const repo = `https://github.com/${HUB_META.repo}`;
      const mods = [...modules.values()].map((rec) => {
        const m = rec.meta;
        const on = isEnabled(rec);
        const st = rec.status;
        return `
        <div class="mod" data-id="${esc(m.id)}">
          <label class="sw" title="${on ? 'Disable' : 'Enable'} ${esc(m.name)}">
            <input type="checkbox" data-toggle="${esc(m.id)}" ${on ? 'checked' : ''}><span></span>
          </label>
          <div class="info">
            <div class="name">${m.icon ? esc(m.icon) + ' ' : ''}${esc(m.name)}<span class="ver">v${esc(m.version)}</span></div>
            <div class="desc">${esc(m.description)}</div>
            <div class="meta">
              <span class="st-${esc(st)}">${esc(STATUS[st] || st)}${rec.error ? ': ' + esc(rec.error) : ''}</span>
              ${m.docsUrl ? `<a href="${esc(m.docsUrl)}" target="_blank" rel="noopener">Docs ↗</a>` : ''}
            </div>
          </div>
        </div>`;
      }).join('');

      panel.innerHTML = `
        <div class="hd"><b>🧩 Jin Scripthub</b><span class="v">v${esc(HUB_META.version)}</span>
          <button data-a="close" title="Close (Esc)">✕</button></div>
        <section>
          <h3>Torn API key</h3>
          ${pda
            ? '<div class="muted">Provided automatically by Torn PDA.</div>'
            : `<div class="key"><input type="password" data-k="apikey" autocomplete="off" placeholder="16-character key" value="${esc(key)}">
               <button data-a="savekey">Save</button></div>`}
          <small>${esc(keyMsg) || 'One key for all modules. A <b>Limited Access</b> key covers every module. Stored locally in your browser and only sent to api.torn.com.'}</small>
        </section>
        <section>
          <h3>Modules</h3>
          ${mods || '<div class="muted">No modules bundled.</div>'}
        </section>
        <div class="ft">
          <a href="${repo}" target="_blank" rel="noopener">GitHub ↗</a>
          <a href="${repo}/issues" target="_blank" rel="noopener">Report an issue ↗</a>
          <span>Changes apply instantly and sync to all open Torn tabs.</span>
        </div>`;
    }

    function onClick(e) {
      const b = e.target.closest('button[data-a]');
      if (!b) return;
      if (b.dataset.a === 'close') open(false);
      if (b.dataset.a === 'savekey') {
        const v = panel.querySelector('[data-k="apikey"]').value.trim();
        setApiKey(v);
        keyMsg = !v ? 'API key removed.' : /^[A-Za-z0-9]{16}$/.test(v) ? 'Saved.' : 'Saved – note: Torn keys are normally 16 letters/digits.';
        render();
        setTimeout(() => { keyMsg = ''; render(); }, 4000);
      }
    }

    function onChange(e) {
      const t = e.target;
      if (t && t.dataset && t.dataset.toggle) setEnabled(t.dataset.toggle, t.checked);
    }

    return { init, open, render, addLauncher };
  })();

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  function boot() {
    const root = document.documentElement;
    if (root.hasAttribute('data-jinhub')) {
      console.warn(`${LOG_PREFIX} another copy of the Scripthub is already running in this tab – this copy stays idle.`);
      return;
    }
    root.setAttribute('data-jinhub', HUB_META.version);

    const go = () => {
      ui.init();
      modules.forEach((rec) => { if (isEnabled(rec)) startModule(rec); });
      // Toggles made in another tab apply here too.
      store.onChange('hub:enabled', (nv, ov, remote) => {
        if (!remote) return;
        modules.forEach(apply);
        ui.render();
      });
      store.onChange('hub:apiKey', (nv, ov, remote) => { if (remote) emitKeyChange(); });
      if (!getApiKey()) ui.open(true);
    };
    if (document.body) go();
    else window.addEventListener('DOMContentLoaded', go, { once: true });
  }

  return { define, boot, store, api, apiUrl, request, getApiKey, notify, setEnabled, modules, ApiError };
})();

// ===== module: stock-roi (src/modules/stock-roi) =====
(function (MODULE) {
// --- logic.js ---
// Stock ROI – pure logic (no DOM, no GM). Tested in tests/stock-roi.test.mjs.

const DAYS_PER_YEAR = 365;

// Values for payouts without a market price. 0 = "auto" where possible
// (energy via Xanax / 250, points via the points market).
const DEFAULT_SETTINGS = { energy: 0, nerve: 0, happy: 0, points: 0, property: 0, overrides: {} };

const fmt$ = (n) => {
  if (n == null || !isFinite(n)) return '–';
  const a = Math.abs(n), s = n < 0 ? '-' : '';
  if (a >= 1e12) return s + '$' + (a / 1e12).toFixed(2) + 't';
  if (a >= 1e9) return s + '$' + (a / 1e9).toFixed(2) + 'b';
  if (a >= 1e6) return s + '$' + (a / 1e6).toFixed(2) + 'm';
  if (a >= 1e3) return s + '$' + (a / 1e3).toFixed(1) + 'k';
  return s + '$' + a.toFixed(2);
};
const fmtPrice = (n) => (n == null || !isFinite(n) ? '–' : '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const fmtN = (n) => (n == null || !isFinite(n) ? '–' : Math.round(n).toLocaleString('en-US'));
const fmtPct = (n) => (n == null || !isFinite(n) ? '–' : (n * 100).toFixed(2) + '%');
const normName = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// "HRG=400m, TCC=60000000" -> { HRG: 400000000, TCC: 60000000 }
function parseOverrides(text) {
  const out = {};
  String(text || '').split(/[,;\n]/).forEach((p) => {
    const m = p.match(/^\s*([A-Za-z]+)\s*=\s*([\d.,]+\s*[kmb]?)\s*$/i);
    if (!m) return;
    const v = m[2].toLowerCase().replace(/[,\s]/g, '');
    const mult = v.endsWith('b') ? 1e9 : v.endsWith('m') ? 1e6 : v.endsWith('k') ? 1e3 : 1;
    const n = parseFloat(v) * mult;
    if (n > 0) out[m[1].toUpperCase()] = n;
  });
  return out;
}

// Turns raw API responses into the cached data shape used by buildRows().
function prepareData(torn, user, pointsmarket, now) {
  let pointsPrice = null;
  if (pointsmarket && pointsmarket.pointsmarket) {
    const costs = Object.values(pointsmarket.pointsmarket).map((x) => x.cost).filter((x) => x > 0);
    if (costs.length) pointsPrice = Math.min(...costs);
  }
  const items = {};
  for (const it of Object.values((torn && torn.items) || {})) {
    const mv = it.market_value ?? (it.value && it.value.market_price) ?? 0;
    if (it.name) items[normName(it.name)] = { name: it.name, mv };
  }
  const userOk = user && !user._err;
  return {
    ts: now,
    stocks: Object.values((torn && torn.stocks) || {}),
    userStocks: userOk ? (Array.isArray(user.stocks) ? user.stocks : Object.values(user.stocks || {})) : [],
    userErr: user && user._err ? user._err : null,
    items,
    pointsPrice,
  };
}

// Estimates the $ value of one payout of a stock's benefit. Returns { value|null, note }.
function valueBenefit(stock, data, cfg) {
  const b = stock.benefit || {};
  const desc = String(b.description || '');
  const acr = stock.acronym;
  const num = (s) => +String(s).replace(/,/g, '');

  if (cfg.overrides && cfg.overrides[acr] > 0) return { value: +cfg.overrides[acr], note: 'manual' };
  if (b.type && b.type !== 'active') return { value: null, note: 'passive' };

  let m;
  if ((m = desc.match(/^\$\s*([\d,.]+)/))) return { value: +m[1].replace(/[,.]/g, ''), note: 'cash' };

  if ((m = desc.match(/([\d,]+)\s*x\s+(.+)$/i))) {
    const qty = num(m[1]);
    const it = data.items[normName(m[2])];
    if (it && it.mv > 0) return { value: qty * it.mv, note: 'item market' };
    if (/property/i.test(m[2]) && cfg.property > 0) return { value: qty * cfg.property, note: 'manual' };
    return { value: null, note: 'no price – ⚙' };
  }
  if (/property/i.test(desc)) return cfg.property > 0 ? { value: +cfg.property, note: 'manual' } : { value: null, note: 'set value in ⚙' };

  if ((m = desc.match(/([\d,]+)\s*points?/i))) {
    const p = cfg.points > 0 ? cfg.points : data.pointsPrice;
    return p ? { value: num(m[1]) * p, note: cfg.points > 0 ? 'manual' : 'points market' } : { value: null, note: 'set value in ⚙' };
  }
  if ((m = desc.match(/([\d,]+)\s*energy/i))) {
    let per = cfg.energy;
    if (!(per > 0)) { const x = data.items[normName('Xanax')]; per = x && x.mv ? x.mv / 250 : 0; }
    return per > 0 ? { value: num(m[1]) * per, note: cfg.energy > 0 ? 'manual' : '≈ Xanax / 250' } : { value: null, note: 'set value in ⚙' };
  }
  if ((m = desc.match(/([\d,]+)\s*nerve/i)))
    return cfg.nerve > 0 ? { value: num(m[1]) * cfg.nerve, note: 'manual' } : { value: null, note: 'set value in ⚙' };
  if ((m = desc.match(/([\d,]+)\s*happ/i)))
    return cfg.happy > 0 ? { value: num(m[1]) * cfg.happy, note: 'manual' } : { value: null, note: 'set value in ⚙' };

  return { value: null, note: 'unknown – ⚙' };
}

// Number of benefit blocks held. Block n needs req * 2^(n-1) additional shares,
// so n blocks need req * (2^n - 1) shares in total.
function blocksHeld(shares, req) {
  return req > 0 ? Math.floor(Math.log2(shares / req + 1) + 1e-9) : 0;
}

function buildRows(data, cfg) {
  const owned = {};
  for (const s of data.userStocks) {
    const id = s.stock_id ?? s.id;
    const tx = Object.values(s.transactions || {});
    owned[id] = {
      shares: s.total_shares ?? s.shares ?? 0,
      cost: tx.reduce((a, t) => a + (t.shares || 0) * (t.bought_price ?? t.price ?? 0), 0),
    };
  }

  return data.stocks.map((s) => {
    const id = s.stock_id ?? s.id;
    const price = s.current_price ?? (s.market && s.market.price) ?? 0;
    const b = s.benefit || {};
    const req = b.requirement || 0;
    const freq = b.frequency || 0;
    const { value, note } = valueBenefit(s, data, cfg);
    const yearly = value != null && freq > 0 ? (value * DAYS_PER_YEAR) / freq : null;

    const own = owned[id] || { shares: 0, cost: 0 };
    const blocks = blocksHeld(own.shares, req);
    const nextBlockShares = req * Math.pow(2, blocks);
    const missing = Math.max(0, req * (Math.pow(2, blocks + 1) - 1) - own.shares);
    const isPassive = !!b.type && b.type !== 'active';

    return {
      id, acr: s.acronym, name: s.name, price, desc: b.description, freq, req, value, note, isPassive,
      blockCost: req * price,
      roi: yearly != null && req * price > 0 ? yearly / (req * price) : null,
      blocks, ownedShares: own.shares,
      nextCost: missing * price, missing,
      nextRoi: !isPassive && yearly != null && nextBlockShares * price > 0 ? yearly / (nextBlockShares * price) : null,
      income: yearly != null && !isPassive ? yearly * blocks : 0,
      worth: own.shares * price,
      pl: own.shares ? own.shares * price - own.cost : null,
    };
  });
}

// Sorts rows in place; empty values always go last regardless of direction.
function sortRows(rows, key, dir) {
  return rows.sort((a, b) => {
    const x = a[key], y = b[key];
    const xn = x == null || x === '', yn = y == null || y === '';
    if (xn && yn) return 0;
    if (xn) return 1;
    if (yn) return -1;
    if (typeof x === 'string') return x.localeCompare(y) * dir;
    return (x - y) * dir;
  });
}
// --- module.js ---
// Stock ROI – UI. Uses the helpers from logic.js (same module scope).

MODULE.start = (ctx) => {
  const CACHE_MS = 5 * 60 * 1000;   // cache API data for 5 minutes
  const { esc, store } = ctx;
  const settings = () => Object.assign({}, DEFAULT_SETTINGS, store.get('settings', {}));

  async function loadData(force) {
    if (!ctx.getApiKey()) throw new Error('No API key set – click “API key…” or open the 🧩 Hub tab.');
    const cached = store.get('cache', null);
    if (!force && cached && Date.now() - cached.ts < CACHE_MS) return cached;

    const [torn, user, pm] = await Promise.all([
      ctx.api('torn/?selections=stocks,items'),
      ctx.api('user/?selections=stocks').catch((e) => ({ _err: e.message })),
      ctx.api('market/?selections=pointsmarket').catch(() => null),
    ]);
    const data = prepareData(torn, user, pm, Date.now());
    store.set('cache', data);
    return data;
  }

  const CSS = `
  #tsr-panel{position:fixed;top:70px;left:50%;transform:translateX(-50%);z-index:999999;width:min(1150px,97vw);max-height:82vh;
    display:none;flex-direction:column;background:#1b1b1b;color:#ddd;border:1px solid #444;border-radius:8px;
    box-shadow:0 8px 30px rgba(0,0,0,.6);font:12px Arial,sans-serif;}
  #tsr-panel.open{display:flex}
  #tsr-head{display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid #333;flex-wrap:wrap}
  #tsr-head b{font-size:14px;color:#fff;margin-right:auto}
  #tsr-head button,#tsr-set button{background:#333;color:#ddd;border:1px solid #555;border-radius:4px;padding:3px 8px;cursor:pointer}
  #tsr-head button:hover{background:#444}
  #tsr-head label{cursor:pointer;user-select:none}
  #tsr-sum{padding:6px 10px;border-bottom:1px solid #333;display:flex;gap:18px;flex-wrap:wrap;color:#aaa}
  #tsr-sum span b{color:#fff}
  #tsr-sum .pos{color:#6d6}#tsr-sum .neg{color:#e66}
  #tsr-body{overflow:auto}
  #tsr-body table{width:100%;border-collapse:collapse}
  #tsr-body th{font-size:12px;position:sticky;top:0;background:#262626;color:#ccc;text-align:right;padding:5px 6px;cursor:pointer;white-space:nowrap;border-bottom:1px solid #444}
  #tsr-body th.l,#tsr-body td.l{text-align:left}
  #tsr-body th.sorted{color:#9f9}
  #tsr-body td{color:#ddd;font-size:12px;padding:4px 6px;text-align:right;border-bottom:1px solid #2a2a2a;white-space:nowrap}
  #tsr-body tr:hover td{background:#242c24}
  #tsr-body tr.own td:first-child{border-left:3px solid #4a4}
  #tsr-panel .dim{color:#777}
  #tsr-body .pos{color:#6d6}#tsr-body .neg{color:#e66}
  #tsr-body .hot{color:#9f9;font-weight:bold}
  #tsr-msg{padding:20px;text-align:center;color:#aaa}
  #tsr-set{display:none;padding:10px;border-bottom:1px solid #333;background:#202020}
  #tsr-set.open{display:block}
  #tsr-set .g{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:8px}
  #tsr-set label{display:flex;flex-direction:column;gap:2px;color:#aaa}
  #tsr-set input,#tsr-set textarea{background:#111;color:#eee;border:1px solid #555;border-radius:4px;padding:3px 5px;width:150px}
  #tsr-set textarea{width:100%;height:46px;font-family:monospace}
  #tsr-set small{color:#777}
  `;

  const COLS = [
    { k: 'rank', t: '#', l: 1, nosort: 1 },
    { k: 'acr', t: 'Stock', l: 1 },
    { k: 'price', t: 'Price' },
    { k: 'desc', t: 'Dividend', l: 1 },
    { k: 'value', t: 'Value/payout' },
    { k: 'freq', t: 'Days' },
    { k: 'req', t: 'Block (shares)' },
    { k: 'blockCost', t: 'Block cost' },
    { k: 'roi', t: 'ROI p.a. (1st block)' },
    { k: 'blocks', t: 'Owned' },
    { k: 'missing', t: 'Missing for next' },
    { k: 'nextCost', t: 'Next block cost' },
    { k: 'nextRoi', t: 'Next block ROI' },
    { k: 'pl', t: 'P/L' },
  ];

  let sortKey = store.get('sortKey', 'nextRoi');
  let sortDir = store.get('sortDir', -1);
  let activeOnly = store.get('activeOnly', false);
  let current = null;

  ctx.addStyle(CSS);
  const panel = ctx.mount(ctx.el(`
    <div id="tsr-panel">
      <div id="tsr-head">
        <b>📈 Torn Stock ROI</b>
        <label><input type="checkbox" id="tsr-active"> active dividends only</label>
        <span id="tsr-age" class="dim"></span>
        <button id="tsr-reload" title="Reload from the API">⟳</button>
        <button id="tsr-cfg" title="Settings">⚙</button>
        <button id="tsr-close" title="Close">✕</button>
      </div>
      <div id="tsr-set"></div>
      <div id="tsr-sum"></div>
      <div id="tsr-body"><div id="tsr-msg">Loading…</div></div>
    </div>`));
  const $ = (sel) => panel.querySelector(sel);

  const open = (o) => {
    panel.classList.toggle('open', o);
    store.set('open', o);
    if (o) refresh(false);
  };
  ctx.addLauncher({ label: '📈 Stocks', title: 'Stock ROI', onClick: () => open(!panel.classList.contains('open')) });
  $('#tsr-close').onclick = () => open(false);
  $('#tsr-reload').onclick = () => refresh(true);
  $('#tsr-cfg').onclick = toggleSettings;
  const cb = $('#tsr-active');
  cb.checked = activeOnly;
  cb.onchange = () => { activeOnly = cb.checked; store.set('activeOnly', activeOnly); render(); };
  ctx.onApiKeyChange(() => { if (panel.classList.contains('open')) refresh(true); });

  // Open automatically on the stock market page, otherwise restore the last state.
  if (/sid=stocks/.test(location.href) || store.get('open', false)) open(true);

  function toggleSettings() {
    const box = $('#tsr-set');
    if (box.classList.contains('open')) { box.classList.remove('open'); return; }
    const c = settings();
    box.innerHTML = `
      <div class="g">
        <label>$ per energy <small>0 = Xanax / 250</small><input id="tsr-e" type="number" value="${c.energy}"></label>
        <label>$ per nerve<input id="tsr-n" type="number" value="${c.nerve}"></label>
        <label>$ per happy<input id="tsr-h" type="number" value="${c.happy}"></label>
        <label>$ per point <small>0 = points market</small><input id="tsr-p" type="number" value="${c.points}"></label>
        <label>$ per property (HRG)<input id="tsr-pr" type="number" value="${c.property}"></label>
      </div>
      <label>Manual value per payout (overrides everything), format <code>ACR=amount</code>, comma separated, e.g. <code>HRG=400m, TCC=60m</code>
        <textarea id="tsr-o">${esc(Object.entries(c.overrides || {}).map(([k, v]) => k + '=' + v).join(', '))}</textarea></label>
      <div style="margin-top:6px"><button id="tsr-save">Save</button> <button id="tsr-key">API key…</button>
      <small> The API key is shared by all modules and managed in the 🧩 Hub.</small></div>`;
    box.classList.add('open');
    box.querySelector('#tsr-key').onclick = () => ctx.openHub();
    box.querySelector('#tsr-save').onclick = () => {
      store.set('settings', {
        energy: +box.querySelector('#tsr-e').value || 0,
        nerve: +box.querySelector('#tsr-n').value || 0,
        happy: +box.querySelector('#tsr-h').value || 0,
        points: +box.querySelector('#tsr-p').value || 0,
        property: +box.querySelector('#tsr-pr').value || 0,
        overrides: parseOverrides(box.querySelector('#tsr-o').value),
      });
      box.classList.remove('open');
      refresh(true);
    };
  }

  async function refresh(force) {
    const body = $('#tsr-body');
    if (!current || force) body.innerHTML = '<div id="tsr-msg">Loading data from the Torn API…</div>';
    try {
      const data = await loadData(force);
      if (!ctx.alive) return;
      current = data;
      render();
    } catch (e) {
      if (!ctx.alive) return;
      body.innerHTML = `<div id="tsr-msg">⚠ ${esc(e.message)}</div>`;
    }
  }

  function render() {
    if (!current) return;
    const rows = sortRows(buildRows(current, settings()).filter((r) => !activeOnly || !r.isPassive), sortKey, sortDir);

    const mine = rows.filter((r) => r.ownedShares > 0);
    const worth = mine.reduce((a, r) => a + r.worth, 0);
    const pl = mine.reduce((a, r) => a + (r.pl || 0), 0);
    const income = mine.reduce((a, r) => a + r.income, 0);
    $('#tsr-sum').innerHTML = `
      <span>Portfolio: <b>${fmt$(worth)}</b></span>
      <span>P/L: <b class="${pl >= 0 ? 'pos' : 'neg'}">${fmt$(pl)}</b></span>
      <span>Dividends p.a.: <b>${fmt$(income)}</b> (${fmtPct(worth ? income / worth : null)})</span>
      ${current.userErr ? `<span class="neg">Your stocks: ${esc(current.userErr)}</span>` : ''}`;
    $('#tsr-age').textContent = 'As of ' + new Date(current.ts).toLocaleTimeString();

    const head = COLS.map((c) => `<th data-k="${c.k}" class="${c.l ? 'l' : ''} ${c.k === sortKey ? 'sorted' : ''}">${c.t}${c.k === sortKey ? (sortDir < 0 ? ' ▼' : ' ▲') : ''}</th>`).join('');
    const body = rows.map((r, i) => {
      const plCls = r.pl == null ? 'dim' : r.pl >= 0 ? 'pos' : 'neg';
      return `<tr class="${r.ownedShares > 0 ? 'own' : ''}">
        <td class="l dim">${i + 1}</td>
        <td class="l" title="${esc(r.name)}"><b>${esc(r.acr)}</b></td>
        <td>${fmtPrice(r.price)}</td>
        <td class="l">${esc(r.desc)}${r.isPassive ? ' <span class="dim">(passive)</span>' : ''}</td>
        <td title="${esc(r.note)}">${r.value != null ? fmt$(r.value) : `<span class="dim">${esc(r.note)}</span>`}</td>
        <td>${r.freq || '–'}</td>
        <td>${fmtN(r.req)}</td>
        <td>${fmt$(r.blockCost)}</td>
        <td class="${r.roi != null ? 'hot' : 'dim'}">${fmtPct(r.roi)}</td>
        <td title="${fmtN(r.ownedShares)} shares">${r.blocks ? r.blocks + '× BB' : '<span class="dim">–</span>'}</td>
        <td>${r.isPassive && r.blocks ? '<span class="dim">✓</span>' : fmtN(r.missing)}</td>
        <td>${r.isPassive && r.blocks ? '<span class="dim">–</span>' : fmt$(r.nextCost)}</td>
        <td class="${r.nextRoi != null ? 'hot' : 'dim'}">${fmtPct(r.nextRoi)}</td>
        <td class="${plCls}">${r.pl == null ? '–' : fmt$(r.pl)}</td>
      </tr>`;
    }).join('');

    const wrap = $('#tsr-body');
    wrap.innerHTML = `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
    wrap.querySelectorAll('th').forEach((th) => {
      const col = COLS.find((c) => c.k === th.dataset.k);
      if (col.nosort) return;
      th.onclick = () => {
        if (sortKey === col.k) sortDir = -sortDir;
        else { sortKey = col.k; sortDir = col.l ? 1 : -1; }
        store.set('sortKey', sortKey); store.set('sortDir', sortDir);
        render();
      };
    });
  }
};
})(Hub.define({"id":"stock-roi","name":"Stock ROI","icon":"📈","version":"1.1.0","description":"All Torn stocks ranked by profitability: dividend ROI, cost and ROI of your next benefit block, portfolio P/L.","defaultEnabled":true,"apiComment":"StockROI","apiAccess":"Limited","include":[],"docsUrl":"https://github.com/JintheGreat-4k/torn-jin-scripthub/blob/main/docs/modules/stock-roi.md"}));

// ===== module: chain-alarm (src/modules/chain-alarm) =====
(function (MODULE) {
// --- logic.js ---
// Chain Alarm – pure logic (no DOM, no GM). Tested in tests/chain-alarm.test.mjs.

const HYSTERESIS_S = 15;        // alarm only turns off once the timer is this many seconds above the threshold
const EXPIRE_GRACE_MS = 3000;   // keep ringing this long after the local timer ran out
const MAX_TIMEOUT_S = 300;
const CACHE_WINDOW_MS = 35000;  // the Torn API caches responses for up to ~30 s

// Data sources – easy to extend. All are mapped to the same shape by normalize().
// `path` is relative to https://api.torn.com/; key and comment are appended by the hub.
const SOURCES = {
  v1_user_bars: { label: 'v1 user/bars (recommended, Minimal)', path: 'user/?selections=bars' },
  v2_user_bars: { label: 'v2 /user/bars (Minimal)', path: 'v2/user/bars' },
  v2_faction_chain: { label: 'v2 /faction/chain (Public)', path: 'v2/faction/chain' },
  v1_faction_chain: { label: 'v1 faction/chain (Public, was buggy)', path: 'faction/?selections=chain' },
};

const DEFAULTS = { source: 'v1_user_bars', thresholdMin: 2, minChain: 10, intervalS: 10, soundUrl: '' };

function normalizeSettings(raw) {
  const s = Object.assign({}, DEFAULTS, raw || {});
  if (!SOURCES[s.source]) s.source = DEFAULTS.source;
  s.thresholdMin = +s.thresholdMin > 0 ? +s.thresholdMin : DEFAULTS.thresholdMin;
  s.minChain = +s.minChain >= 0 ? Math.floor(+s.minChain) : DEFAULTS.minChain;
  s.intervalS = Math.max(5, Math.round(+s.intervalS) || DEFAULTS.intervalS);
  s.soundUrl = String(s.soundUrl || '').trim();
  return s;
}

function normalize(data) {
  if (!data || typeof data !== 'object') throw new Error('Empty or invalid response');
  if (data.error) {
    const e = new Error(`API error ${data.error.code}: ${data.error.error}`);
    e.apiCode = data.error.code;
    throw e;
  }
  let c;
  if (data.bars && 'chain' in data.bars) c = data.bars.chain;   // v2 user/bars
  else if ('chain' in data) c = data.chain;                     // v1 user/bars, faction chain
  else if ('current' in data) c = data;                         // already unwrapped
  else throw new Error('No chain data in the response');
  if (c === null) return { current: 0, max: 0, timeout: 0, cooldown: 0, modifier: 1 };  // v2: no chain
  const num = (v) => (Number.isFinite(+v) ? +v : 0);
  return {
    current: num(c.current),
    max: num(c.maximum ?? c.max),
    timeout: Math.min(MAX_TIMEOUT_S, Math.max(0, num(c.timeout))),
    cooldown: num(c.cooldown),     // informational only – says NOTHING about "active"
    modifier: num(c.modifier) || 1,
  };
}

function newTracker() {
  return { active: false, current: 0, max: 0, deadline: 0, lastUpdate: 0 };
}

// Applies a (possibly ~30 s old, cached) API response.
// Returns { event: 'start'|'hit'|'update'|'kept'|'stale'|'ended'|'none' }
function applyApi(t, n, now) {
  const isActive = n.current > 0 && n.timeout > 0;
  const expired = t.active && now >= t.deadline;
  t.lastUpdate = now;

  if (!isActive) {
    // A chain only ends by running out (or reaching the maximum). If the API reports the end while
    // our timer is still clearly running, it is an old cached response.
    const plausibleEnd = (t.deadline - now) <= CACHE_WINDOW_MS || (t.max > 0 && t.current >= t.max);
    if (t.active && !expired && n.current < t.current && !plausibleEnd) return { event: 'stale' };
    const was = t.active;
    t.active = false; t.current = n.current; t.deadline = 0; t.max = n.max;
    return { event: was ? 'ended' : 'none' };
  }

  const nd = now + n.timeout * 1000;
  if (n.max) t.max = n.max;
  if (!t.active) {
    t.active = true; t.current = n.current; t.deadline = nd;
    return { event: 'start' };
  }
  if (n.current < t.current && !expired) return { event: 'stale' };   // old cached response
  if (n.current !== t.current) {
    const hit = n.current > t.current;
    t.current = n.current; t.deadline = nd;
    return { event: hit ? 'hit' : 'start' };    // smaller + expired = new chain
  }
  // Same length: never move the timer up again, keep the smaller value
  if (nd < t.deadline) { t.deadline = nd; return { event: 'update' }; }
  return { event: 'kept' };
}

function remainingS(t, now) {
  return t.active ? Math.max(0, (t.deadline - now) / 1000) : null;
}

function newAlarm() { return { on: false, muted: false, notified: false }; }

// Alarm state machine with hysteresis. Returns 'on' | 'off' | null (no change)
function evalAlarm(a, t, cfg, now) {
  const thr = cfg.thresholdMin * 60;
  const eligible = t.active && t.current >= cfg.minChain && now < t.deadline + EXPIRE_GRACE_MS;
  const rem = remainingS(t, now);
  if (!a.on && eligible && rem <= thr) {
    a.on = true; a.notified = false;
    return 'on';
  }
  if (a.on && (!eligible || rem > thr + HYSTERESIS_S)) {
    a.on = false;
    return 'off';
  }
  return null;
}

function fmtClock(sec) {
  if (sec == null) return '--:--';
  const s = Math.ceil(sec);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
const fmtChainMax = (n) => (n >= 1000 && n % 1000 === 0 ? n / 1000 + 'k' : n.toLocaleString('en-US'));
// --- module.js ---
// Chain Alarm – runtime: leader election across tabs, polling, audio and the floating panel.
// Uses the helpers from logic.js (same module scope).

MODULE.start = (ctx) => {
  const VERSION = ctx.meta.version;
  const INST = Math.random().toString(36).slice(2, 10);   // instance id (per tab and copy)
  const TICK_MS = 500;
  const LEADER_STALE_MS = 6000;
  const { store } = ctx;

  // ---------------------------------------------------------------------------
  // Duplicate detection. Uses the same attribute as the old standalone "Torn Chain-Alarm"
  // userscript, so a leftover standalone copy and this module never ring twice in one tab.
  // ---------------------------------------------------------------------------
  const root = document.documentElement;
  const ATTR = 'data-torn-chain-alarm';
  const readAttr = () => (root.getAttribute(ATTR) || '').split(' ').filter(Boolean);
  const others = readAttr();
  const me = `${INST}@${VERSION}`;
  root.setAttribute(ATTR, others.concat(me).join(' '));
  const isDuplicate = others.length > 0;   // another copy was already running in this tab
  ctx.onCleanup(() => {
    const rest = readAttr().filter((x) => x !== me);
    if (rest.length) root.setAttribute(ATTR, rest.join(' ')); else root.removeAttribute(ATTR);
  });
  function duplicateInfo() {
    const all = readAttr();
    return all.length > 1 ? all.map((s) => 'v' + s.split('@')[1]).join(', ') : '';
  }

  const loadSettings = () => normalizeSettings(store.get('settings', {}));
  let S = loadSettings();

  // ---------------------------------------------------------------------------
  // Audio (WebAudio, usually only possible after a user click)
  // ---------------------------------------------------------------------------
  let actx = null;
  let customBuf = null, customBufUrl = '', customErr = '';
  let nextSoundAt = 0;

  function ensureAudio() {
    try {
      if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume().catch(() => {});
    } catch (e) { /* no audio */ }
  }
  const audioReady = () => !!actx && actx.state === 'running';
  ctx.onCleanup(() => { if (actx) actx.close().catch(() => {}); actx = null; });

  ['pointerdown', 'keydown', 'touchstart'].forEach((ev) =>
    ctx.on(document, ev, ensureAudio, { capture: true, passive: true }));
  // Some browsers allow audio without a click (media engagement) – trying does no harm
  ensureAudio();

  function beep() {
    const t0 = actx.currentTime;
    [0, 0.25, 0.5].forEach((dt, i) => {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = 'square';
      o.frequency.value = i === 2 ? 1320 : 880;
      g.gain.setValueAtTime(0.0001, t0 + dt);
      g.gain.exponentialRampToValueAtTime(0.35, t0 + dt + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.18);
      o.connect(g).connect(actx.destination);
      o.start(t0 + dt); o.stop(t0 + dt + 0.2);
    });
    return 1.2;   // seconds until the next sound
  }

  function loadCustomSound(url) {
    if (!url) { customBuf = null; customBufUrl = ''; customErr = ''; return; }
    if (url === customBufUrl) return;
    customBufUrl = url; customBuf = null; customErr = 'loading…';
    // Loaded via GM_xmlhttpRequest -> bypasses Torn's CSP
    ctx.request({ url, responseType: 'arraybuffer', timeout: 20000 }).then((r) => {
      if (!ctx.alive || customBufUrl !== url) return;
      if (r.status !== 200) { customErr = `HTTP ${r.status}`; return; }
      ensureAudio();
      if (!actx) { customErr = 'no AudioContext'; return; }
      actx.decodeAudioData(r.response.slice(0))
        .then((b) => { if (customBufUrl === url) { customBuf = b; customErr = ''; } })
        .catch(() => { customErr = 'unsupported format'; });
    }, (e) => { if (customBufUrl === url) customErr = e.message; });
  }

  function playSound() {
    if (!audioReady()) return 0;
    if (customBuf) {
      const src = actx.createBufferSource();
      src.buffer = customBuf; src.connect(actx.destination); src.start();
      return Math.max(1, customBuf.duration + 0.3);
    }
    return beep();
  }

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  let T = newTracker();
  let A = newAlarm();
  let isLeader = false;
  let status = 'Starting…', statusErr = false, rawText = '(no API response yet)';
  let nextPollAt = 0, inFlight = false, lastLeaderBeat = 0, lastShared = 0;
  let lastMuteReq = store.get('muteReq', 0);
  let tickerMode = '?', lastTickAt = 0;

  function setStatus(msg, err) { status = msg; statusErr = !!err; }

  // ---------------------------------------------------------------------------
  // Only one tab monitors: leader election via GM storage (heartbeat)
  // ---------------------------------------------------------------------------
  function leaderTick(now, force) {
    const L = store.get('leader', null);
    const mine = L && L.id === INST;
    const stale = !L || now - L.ts > LEADER_STALE_MS;
    const better = L && !mine && !L.audio && audioReady();  // prefer a tab with unlocked audio
    const was = isLeader;
    if (!isDuplicate && (force || mine || stale || better)) {
      store.set('leader', { id: INST, ts: now, audio: audioReady() });
      isLeader = true;
    } else {
      isLeader = false;
    }
    if (isLeader && !was) adoptShared(now);
  }

  // A new leader takes over the previous leader's state (incl. the "smaller timer" knowledge)
  function adoptShared(now) {
    const sh = store.get('shared', null);
    if (sh && now - sh.ts < 60000 && sh.tracker) {
      T = Object.assign(newTracker(), sh.tracker);
      A = Object.assign(newAlarm(), sh.alarm || {});
      rawText = sh.raw || rawText;
    }
    nextPollAt = 0;
  }

  function publishShared(now) {
    lastShared = now;
    store.set('shared', { ts: now, tracker: T, alarm: A, status, statusErr, raw: rawText });
  }

  function releaseLeadership() {
    const L = store.get('leader', null);
    if (L && L.id === INST) store.set('leader', null);
  }
  ctx.on(window, 'pagehide', releaseLeadership);
  ctx.onCleanup(releaseLeadership);

  // ---------------------------------------------------------------------------
  // API polling
  // ---------------------------------------------------------------------------
  function poll(now) {
    if (inFlight) return;
    let url;
    try { url = ctx.apiUrl(SOURCES[S.source].path); } catch (e) { setStatus(e.message, true); return; }
    inFlight = true;
    nextPollAt = now + S.intervalS * 1000;
    ctx.request({ url, timeout: 15000 }).then(
      (r) => { inFlight = false; if (ctx.alive) handleResponse(r.text, r.status); },
      (e) => { inFlight = false; setStatus(e.message, true); },
    );
  }

  function handleResponse(text, httpStatus) {
    const now = Date.now();
    const stamp = new Date().toLocaleTimeString();
    rawText = `${stamp} – ${S.source} – HTTP ${httpStatus}\n${String(text).slice(0, 1500)}`;
    let n;
    try {
      n = normalize(JSON.parse(text));
    } catch (e) {
      setStatus(e.message || 'Unreadable response', true);
      if (e.apiCode === 5) nextPollAt = now + 60000;                          // too many requests
      if ([2, 10, 13, 16, 18].includes(e.apiCode)) nextPollAt = now + 60000;  // key problems
      publishShared(now);
      return;
    }
    const prevCur = T.current;
    const r = applyApi(T, n, now);
    if (r.event === 'hit' || r.event === 'start') {
      A.muted = false;                     // "Stop alarm" only lasts until the next hit
      A.on = false;                        // hit -> re-evaluate the alarm
    }
    if (r.event === 'ended') { A.on = false; A.muted = false; }
    const extra = {
      start: 'Chain detected', hit: `Hit! (+${T.current - prevCur})`, update: 'Timer updated',
      kept: 'Cached value ignored (timer higher)', stale: 'Outdated response ignored',
      ended: 'Chain ended', none: n.cooldown > 0 ? 'No active chain (cooldown running)' : 'No active chain',
    }[r.event];
    setStatus(`${stamp}: ${extra}`, false);
    publishShared(now);
  }

  // ---------------------------------------------------------------------------
  // Main loop (driven by the worker)
  // ---------------------------------------------------------------------------
  function tick() {
    if (!ctx.alive) return;
    const now = Date.now();
    lastTickAt = now;
    S = loadSettings();
    if (now - lastLeaderBeat >= 2000) { lastLeaderBeat = now; leaderTick(now); }

    if (isLeader) {
      // Mute request from another tab?
      const mr = store.get('muteReq', 0);
      if (mr !== lastMuteReq) { lastMuteReq = mr; if (A.on) A.muted = true; }

      if (!ctx.getApiKey()) setStatus('No API key – set it in the 🧩 Hub', true);
      else if (now >= nextPollAt) poll(now);

      // Expired locally with no new info -> chain probably broken
      const ch = evalAlarm(A, T, S, now);
      if (ch === 'on' && !A.notified) {
        A.notified = true;
        ctx.notify({
          title: '⛓ Chain timer running out!',
          text: `Chain ${T.current}: only ${fmtClock(remainingS(T, now))} left – hit now!`,
          timeout: 20000,
          onclick: () => window.focus(),
        });
      }
      if (A.on && !A.muted && now >= nextSoundAt) {
        const dur = playSound();
        nextSoundAt = now + (dur ? dur * 1000 : 1000);
      }
      if (ch || now - lastShared >= 1000) publishShared(now);
    } else {
      // Display only – data comes from the monitoring tab
      const sh = store.get('shared', null);
      if (sh && sh.tracker) {
        T = Object.assign(newTracker(), sh.tracker);
        A = Object.assign(newAlarm(), sh.alarm || {});
        status = sh.status; statusErr = sh.statusErr; rawText = sh.raw;
      }
    }
    render(now);
  }

  // Web Worker as the clock (background tabs otherwise throttle setInterval to once per minute)
  let fallbackTimer = null;
  function useFallback(reason) {
    if (fallbackTimer) return;
    tickerMode = 'setInterval (' + reason + ')';
    fallbackTimer = ctx.setInterval(tick, TICK_MS);
  }
  try {
    const src = 'let t;onmessage=e=>{clearInterval(t);t=setInterval(()=>postMessage(0),e.data)}';
    const blobUrl = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    const w = new Worker(blobUrl);
    ctx.onCleanup(() => { w.terminate(); URL.revokeObjectURL(blobUrl); });
    w.onmessage = () => { if (!fallbackTimer) tick(); };
    w.onerror = () => useFallback('worker error');
    w.postMessage(TICK_MS);
    tickerMode = 'Web Worker';
    ctx.setTimeout(() => { if (Date.now() - lastTickAt > 3000) useFallback('worker silent'); }, 4000);
  } catch (e) {
    useFallback('worker blocked');
  }

  // ---------------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------------
  const ID = `tca-${INST}`;
  ctx.addStyle(`
  #${ID}{position:fixed;z-index:2147483000;width:270px;font:12px/1.35 Arial,sans-serif;color:#eee;
    background:#1e1f24;border:1px solid #555;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.5);user-select:none}
  #${ID}.tca-alarm{animation:tcaBlink-${INST} .8s steps(2,start) infinite;border-color:#f33}
  @keyframes tcaBlink-${INST}{0%{background:#1e1f24}50%{background:#8b0000}}
  #${ID} .h{display:flex;align-items:center;gap:6px;padding:6px 8px;cursor:move;touch-action:none;
    background:#2b2d35;border-radius:8px 8px 0 0;font-weight:bold}
  #${ID}.tca-col .h{border-radius:8px}
  #${ID} .h .v{font-weight:normal;color:#999;font-size:11px}
  #${ID} .h .r{margin-left:auto;font-size:11px;font-weight:normal}
  #${ID} .b{padding:8px}
  #${ID}.tca-col .b{display:none}
  #${ID} .big{display:flex;justify-content:space-between;align-items:baseline;font-size:15px}
  #${ID} .tm{font-size:26px;font-weight:bold;font-variant-numeric:tabular-nums}
  #${ID} .st{margin:4px 0;color:#aaa;cursor:help;word-break:break-word}
  #${ID} .st.err{color:#ff8080}
  #${ID} .warn{background:#5a1010;color:#fff;padding:4px 6px;border-radius:4px;margin:4px 0}
  #${ID} .hint{background:#4a3c00;color:#fff;padding:4px 6px;border-radius:4px;margin:4px 0}
  #${ID} label{display:flex;justify-content:space-between;align-items:center;gap:6px;margin:3px 0}
  #${ID} input[type=text],#${ID} input[type=number],#${ID} select{
    width:130px;background:#111;color:#eee;border:1px solid #555;border-radius:3px;padding:2px 4px;font-size:12px}
  #${ID} .btns{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}
  #${ID} button{flex:1 1 auto;background:#3a3d48;color:#eee;border:1px solid #666;border-radius:4px;padding:4px 6px;cursor:pointer;font-size:12px}
  #${ID} button:hover{background:#4a4e5c}
  #${ID} button.stop{background:#7a1a1a}
  #${ID} details{margin-top:6px}
  #${ID} summary{cursor:pointer;color:#bbb}
  #${ID} pre{white-space:pre-wrap;max-height:180px;overflow:auto;background:#111;padding:4px;margin:4px 0 0;font-size:10px;user-select:text}
  `);

  const srcOpts = Object.entries(SOURCES).map(([k, v]) => `<option value="${k}">${ctx.esc(v.label)}</option>`).join('');
  const P = ctx.mount(ctx.el(`
    <div id="${ID}">
      <div class="h"><span>⛓ Chain Alarm</span><span class="v">v${VERSION}</span><span class="r"></span><span class="arr">▾</span></div>
      <div class="b">
        <div class="dup warn" hidden></div>
        <div class="aud hint" hidden>🔇 Click anywhere on the page once to unlock sound.</div>
        <div class="big"><span class="ch">Chain –</span><span class="tm">--:--</span></div>
        <div class="st">…</div>
        <div class="btns">
          <button class="stop" data-a="stop">Stop alarm</button>
          <button data-a="test">Test sound</button>
        </div>
        <details class="cfg">
          <summary>Settings</summary>
          <label>Source <select data-k="source">${srcOpts}</select></label>
          <label>Alarm below (min) <input type="number" data-k="thresholdMin" min="0.5" max="5" step="0.5"></label>
          <label>From chain length <input type="number" data-k="minChain" min="0" step="1"></label>
          <label>Interval (sec) <input type="number" data-k="intervalS" min="5" step="1"></label>
          <label>Sound URL <input type="text" data-k="soundUrl" placeholder="optional (mp3/ogg/wav)"></label>
          <div class="btns">
            <button data-a="save">Save</button>
            <button data-a="compare">Test sources</button>
            <button data-a="key">API key…</button>
          </div>
          <pre class="cmp" hidden></pre>
        </details>
      </div>
    </div>`));
  const $ = (sel) => P.querySelector(sel);

  function fillForm() {
    P.querySelectorAll('[data-k]').forEach((el) => {
      const v = S[el.dataset.k];
      if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
    });
  }
  fillForm();
  loadCustomSound(S.soundUrl);

  P.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    const a = btn && btn.dataset.a;
    if (!a) return;
    ensureAudio();
    if (a === 'save') {
      const n = {};
      P.querySelectorAll('[data-k]').forEach((el) => {
        const k = el.dataset.k;
        n[k] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? +el.value : el.value.trim();
      });
      const next = normalizeSettings(n);
      const sourceChanged = next.source !== S.source;
      store.set('settings', next);
      S = loadSettings();
      fillForm();
      loadCustomSound(S.soundUrl);
      if (sourceChanged) { T = newTracker(); A = newAlarm(); }
      nextPollAt = 0;
      setStatus('Saved', false);
      leaderTick(Date.now());
    } else if (a === 'test') {
      ctx.setTimeout(() => {
        if (!audioReady()) setStatus('Sound blocked – please click again', true);
        else { playSound(); setStatus(customBuf ? 'Test: custom sound' : `Test: beep${S.soundUrl ? ' (custom sound: ' + customErr + ')' : ''}`, false); }
      }, 50);
    } else if (a === 'stop') {
      if (isLeader) { if (A.on) A.muted = true; publishShared(Date.now()); }
      else store.set('muteReq', Date.now());
      if (!A.on) setStatus('No alarm active', false);
    } else if (a === 'compare') {
      compareSources();
    } else if (a === 'key') {
      ctx.openHub();
    }
  });
  ctx.onApiKeyChange(() => { nextPollAt = 0; });

  // Query every source once and show the results side by side (4 requests)
  function compareSources() {
    const out = $('.cmp');
    out.hidden = false;
    if (!ctx.getApiKey()) { out.textContent = 'Set your API key in the 🧩 Hub first.'; return; }
    const lines = {};
    const show = () => { out.textContent = Object.keys(SOURCES).map((k) => lines[k] || `${k}: …`).join('\n\n'); };
    show();
    Object.entries(SOURCES).forEach(([k, src]) => {
      ctx.request({ url: ctx.apiUrl(src.path), timeout: 15000 }).then((r) => {
        let sum;
        try {
          const n = normalize(JSON.parse(r.text));
          sum = `length ${n.current}, timeout ${n.timeout}s, cooldown ${n.cooldown}s → ${n.current > 0 && n.timeout > 0 ? 'ACTIVE' : 'inactive'}`;
        } catch (e) { sum = e.message; }
        lines[k] = `${k}: ${sum}\n${String(r.text).slice(0, 400)}`;
        show();
      }, (e) => { lines[k] = `${k}: ${e.message}`; show(); });
    });
  }

  // ---- Drag / collapse ----
  const H = $('.h');
  const pos = store.get('pos', { x: null, y: 80, col: false });
  if (pos.col) P.classList.add('tca-col');
  function clampPlace(x, y) {
    const w = P.offsetWidth, h = P.offsetHeight;
    x = Math.max(0, Math.min(x, window.innerWidth - w));
    y = Math.max(0, Math.min(y, window.innerHeight - h));
    P.style.left = x + 'px'; P.style.top = y + 'px';
    return { x, y };
  }
  clampPlace(pos.x == null ? window.innerWidth - P.offsetWidth - 20 : pos.x, pos.y);
  ctx.on(window, 'resize', () => clampPlace(P.offsetLeft, P.offsetTop));

  let drag = null;
  H.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    drag = { sx: e.clientX, sy: e.clientY, ox: P.offsetLeft, oy: P.offsetTop, moved: false };
    H.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  H.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    drag.moved = true;
    clampPlace(drag.ox + dx, drag.oy + dy);
  });
  function endDrag() {
    if (!drag) return;
    if (!drag.moved) {
      P.classList.toggle('tca-col');
      clampPlace(P.offsetLeft, P.offsetTop);
    }
    drag = null;
    store.set('pos', { x: P.offsetLeft, y: P.offsetTop, col: P.classList.contains('tca-col') });
  }
  H.addEventListener('pointerup', endDrag);
  H.addEventListener('pointercancel', () => { if (drag) drag.moved = true; endDrag(); });

  // ---- Display ----
  function render(now) {
    const rem = remainingS(T, now);
    const thr = S.thresholdMin * 60;
    $('.ch').textContent = T.active
      ? `Chain ${T.current.toLocaleString('en-US')}${T.max ? ' / ' + fmtChainMax(T.max) : ''}`
      : (T.current > 0 ? `Chain ${T.current.toLocaleString('en-US')} (inactive)` : 'No chain');
    const tm = $('.tm');
    tm.textContent = T.active ? fmtClock(rem) : '--:--';
    tm.style.color = !T.active ? '#888' : rem <= thr ? '#ff5555' : rem <= thr + 60 ? '#ffcc44' : '#7CFC00';

    let st = status;
    if (T.active && now >= T.deadline) st = 'Timer ran out – chain probably broken (waiting for API)';
    if (A.on && A.muted) st = '🔕 Muted until the next hit · ' + st;
    if (T.active && T.current < S.minChain) st += ` · below minimum length ${S.minChain}, no alarm`;
    const stEl = $('.st');
    stEl.textContent = st;
    stEl.classList.toggle('err', statusErr);
    stEl.title = `Last API response:\n${rawText}\n\nClock: ${tickerMode} · tab id ${INST}`;

    P.classList.toggle('tca-alarm', A.on && !A.muted);
    $('.r').textContent = isDuplicate ? '⚠ disabled' : isLeader ? '● monitoring' : '○ other tab';
    $('.r').title = isLeader ? 'This tab polls the API and rings.' : 'Another Torn tab is monitoring and ringing.';

    const dup = duplicateInfo();
    const dEl = $('.dup');
    dEl.hidden = !dup;
    if (dup) dEl.textContent = `⚠ Chain Alarm is running more than once (${dup})! Remove the old standalone “Torn Chain-Alarm” script from Tampermonkey.` +
      (isDuplicate ? ' This copy is disabled.' : '');
    $('.aud').hidden = audioReady() || !isLeader;
  }

  if (isDuplicate) setStatus('Duplicate installation – this copy does not monitor.', true);
  tick();
};
})(Hub.define({"id":"chain-alarm","name":"Chain Alarm","icon":"⛓","version":"1.1.0","description":"Rings and notifies when your faction's chain timer drops below a threshold. API only, works in background tabs, one tab monitors for all.","defaultEnabled":false,"apiComment":"ChainAlarm","apiAccess":"Minimal","include":[],"docsUrl":"https://github.com/JintheGreat-4k/torn-jin-scripthub/blob/main/docs/modules/chain-alarm.md"}));

Hub.boot();
})();
