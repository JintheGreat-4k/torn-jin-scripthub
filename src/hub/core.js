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
