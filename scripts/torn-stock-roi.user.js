// ==UserScript==
// @name         Torn Stock ROI (API)
// @namespace    https://github.com/JintheGreat-4k/torn-jin-scripthub
// @version      1.0.0
// @description  Zeigt alle Torn-Aktien sortiert nach Profitabilität (Dividenden-ROI, nächster Block, P/L) direkt im Browser – per Torn API, ohne Sheet.
// @match        https://www.torn.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      api.torn.com
// @run-at       document-idle
// @homepageURL  https://github.com/JintheGreat-4k/torn-jin-scripthub
// @supportURL   https://github.com/JintheGreat-4k/torn-jin-scripthub/issues
// @updateURL    https://raw.githubusercontent.com/JintheGreat-4k/torn-jin-scripthub/main/scripts/torn-stock-roi.user.js
// @downloadURL  https://raw.githubusercontent.com/JintheGreat-4k/torn-jin-scripthub/main/scripts/torn-stock-roi.user.js
// ==/UserScript==

(function () {
  'use strict';

  // Torn PDA ersetzt diesen Platzhalter automatisch durch deinen Key
  const PDA_KEY = '###PDA-APIKEY###';
  const CACHE_MS = 5 * 60 * 1000;   // API-Daten 5 Min. cachen
  const DAYS_PER_YEAR = 365;

  // ---------- Speicher (Tampermonkey oder Fallback localStorage) ----------
  const store = {
    get(k, d) {
      try { if (typeof GM_getValue === 'function') return GM_getValue(k, d); } catch (e) {}
      try { const v = localStorage.getItem('tsr_' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; }
    },
    set(k, v) {
      try { if (typeof GM_setValue === 'function') return GM_setValue(k, v); } catch (e) {}
      try { localStorage.setItem('tsr_' + k, JSON.stringify(v)); } catch (e) {}
    },
  };

  // Werte für Dinge ohne Marktpreis. 0 = "auto" wo möglich (Energy via Xanax/250, Points via Points-Markt)
  const DEFAULT_SETTINGS = { energy: 0, nerve: 0, happy: 0, points: 0, property: 0, overrides: {} };
  const settings = () => Object.assign({}, DEFAULT_SETTINGS, store.get('settings', {}));

  function getKey() {
    if (PDA_KEY && !PDA_KEY.startsWith('#')) return PDA_KEY;
    return store.get('apikey', '');
  }

  // ---------- Formatierung ----------
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
  const fmtN = (n) => (n == null || !isFinite(n) ? '–' : Math.round(n).toLocaleString('de-CH'));
  const fmtPct = (n) => (n == null || !isFinite(n) ? '–' : (n * 100).toFixed(2) + '%');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  // ---------- API ----------
  async function api(path, key) {
    const sep = path.includes('?') ? '&' : '?';
    const r = await fetch(`https://api.torn.com/${path}${sep}key=${encodeURIComponent(key)}&comment=StockROI`);
    const j = await r.json();
    if (j && j.error) throw new Error(`API-Fehler ${j.error.code}: ${j.error.error}`);
    return j;
  }

  async function loadData(force) {
    const key = getKey();
    if (!key) throw new Error('Kein API-Key gesetzt – oben auf ⚙ klicken.');
    const cached = store.get('cache', null);
    if (!force && cached && Date.now() - cached.ts < CACHE_MS) return cached;

    const [torn, user, pm] = await Promise.all([
      api('torn/?selections=stocks,items', key),
      api('user/?selections=stocks', key).catch((e) => ({ _err: e.message })),
      api('market/?selections=pointsmarket', key).catch(() => null),
    ]);

    // Points: günstigstes Angebot
    let pointsPrice = null;
    if (pm && pm.pointsmarket) {
      const costs = Object.values(pm.pointsmarket).map((x) => x.cost).filter((x) => x > 0);
      if (costs.length) pointsPrice = Math.min(...costs);
    }

    // Item-Preise nach normalisiertem Namen
    const items = {};
    for (const it of Object.values(torn.items || {})) {
      const mv = it.market_value ?? it.value?.market_price ?? 0;
      if (it.name) items[norm(it.name)] = { name: it.name, mv };
    }

    const data = {
      ts: Date.now(),
      stocks: Object.values(torn.stocks || {}),
      userStocks: user && !user._err ? (Array.isArray(user.stocks) ? user.stocks : Object.values(user.stocks || {})) : [],
      userErr: user && user._err ? user._err : null,
      items,
      pointsPrice,
    };
    store.set('cache', data);
    return data;
  }

  // ---------- Dividenden bewerten ----------
  function valueBenefit(stock, data, cfg) {
    const b = stock.benefit || {};
    const desc = String(b.description || '');
    const acr = stock.acronym;

    if (cfg.overrides && cfg.overrides[acr] > 0) return { value: +cfg.overrides[acr], note: 'manuell' };
    if (b.type && b.type !== 'active') return { value: null, note: 'passiv' };

    let m;
    if ((m = desc.match(/^\$\s*([\d,.]+)/))) return { value: +m[1].replace(/[,.]/g, ''), note: 'Cash' };

    if ((m = desc.match(/([\d,]+)\s*x\s+(.+)$/i))) {
      const qty = +m[1].replace(/,/g, '');
      const it = data.items[norm(m[2])];
      if (it && it.mv > 0) return { value: qty * it.mv, note: 'Item-Markt' };
      if (/property/i.test(m[2]) && cfg.property > 0) return { value: qty * cfg.property, note: 'manuell' };
      return { value: null, note: 'kein Preis – ⚙' };
    }
    if (/property/i.test(desc)) return cfg.property > 0 ? { value: +cfg.property, note: 'manuell' } : { value: null, note: 'Wert in ⚙' };

    if ((m = desc.match(/([\d,]+)\s*points?/i))) {
      const p = cfg.points > 0 ? cfg.points : data.pointsPrice;
      return p ? { value: +m[1].replace(/,/g, '') * p, note: cfg.points > 0 ? 'manuell' : 'Points-Markt' } : { value: null, note: 'Wert in ⚙' };
    }
    if ((m = desc.match(/([\d,]+)\s*energy/i))) {
      let per = cfg.energy;
      if (!(per > 0)) { const x = data.items[norm('Xanax')]; per = x && x.mv ? x.mv / 250 : 0; }
      return per > 0 ? { value: +m[1].replace(/,/g, '') * per, note: cfg.energy > 0 ? 'manuell' : '≈ Xanax/250' } : { value: null, note: 'Wert in ⚙' };
    }
    if ((m = desc.match(/([\d,]+)\s*nerve/i)))
      return cfg.nerve > 0 ? { value: +m[1].replace(/,/g, '') * cfg.nerve, note: 'manuell' } : { value: null, note: 'Wert in ⚙' };
    if ((m = desc.match(/([\d,]+)\s*happ/i)))
      return cfg.happy > 0 ? { value: +m[1].replace(/,/g, '') * cfg.happy, note: 'manuell' } : { value: null, note: 'Wert in ⚙' };

    return { value: null, note: 'unbekannt – ⚙' };
  }

  function buildRows(data) {
    const cfg = settings();
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
      const price = s.current_price ?? s.market?.price ?? 0;
      const b = s.benefit || {};
      const req = b.requirement || 0;
      const freq = b.frequency || 0;
      const { value, note } = valueBenefit(s, data, cfg);
      const yearly = value != null && freq > 0 ? (value * DAYS_PER_YEAR) / freq : null;

      const own = owned[id] || { shares: 0, cost: 0 };
      // Block n braucht req * 2^(n-1) zusätzliche Aktien -> Total für n Blöcke = req * (2^n - 1)
      const blocks = req > 0 ? Math.floor(Math.log2(own.shares / req + 1) + 1e-9) : 0;
      const nextBlockShares = req * Math.pow(2, blocks);
      const missing = Math.max(0, req * (Math.pow(2, blocks + 1) - 1) - own.shares);
      const isPassive = b.type && b.type !== 'active';

      return {
        id, acr: s.acronym, name: s.name, price, desc: b.description, freq, req, value, note, isPassive,
        blockCost: req * price,
        roi: yearly != null && req * price > 0 ? yearly / (req * price) : null,
        blocks, ownedShares: own.shares,
        nextCost: missing * price, missing,
        nextRoi: !isPassive && yearly != null ? yearly / (nextBlockShares * price) : null,
        income: yearly != null && !isPassive ? yearly * blocks : 0,
        worth: own.shares * price,
        pl: own.shares ? own.shares * price - own.cost : null,
      };
    });
  }

  // ---------- UI ----------
  const CSS = `
  #tsr-btn{position:fixed;left:0;top:45%;z-index:999998;background:#1f2b1f;color:#9f9;border:1px solid #4a4;border-left:0;
    border-radius:0 6px 6px 0;padding:8px 6px;cursor:pointer;font:bold 13px Arial;writing-mode:vertical-rl;}
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
  #tsr-body{overflow:auto}
  #tsr-body table{width:100%;border-collapse:collapse}
  #tsr-body th{font-size:12px;position:sticky;top:0;background:#262626;color:#ccc;text-align:right;padding:5px 6px;cursor:pointer;white-space:nowrap;border-bottom:1px solid #444}
  #tsr-body th.l,#tsr-body td.l{text-align:left}
  #tsr-body th.sorted{color:#9f9}
  #tsr-body td{color:#ddd;font-size:12px;padding:4px 6px;text-align:right;border-bottom:1px solid #2a2a2a;white-space:nowrap}
  #tsr-body tr:hover td{background:#242c24}
  #tsr-body tr.own td:first-child{border-left:3px solid #4a4}
  #tsr-body .dim{color:#777}
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
    { k: 'acr', t: 'Aktie', l: 1 },
    { k: 'price', t: 'Kurs' },
    { k: 'desc', t: 'Dividende', l: 1 },
    { k: 'value', t: 'Wert/Ausz.' },
    { k: 'freq', t: 'Tage' },
    { k: 'req', t: 'Block (Aktien)' },
    { k: 'blockCost', t: 'Block-Kosten' },
    { k: 'roi', t: 'ROI p.a. (1. Block)' },
    { k: 'blocks', t: 'Besitz' },
    { k: 'missing', t: 'Fehlt f. nächsten' },
    { k: 'nextCost', t: 'Kosten nächster' },
    { k: 'nextRoi', t: 'ROI nächster' },
    { k: 'pl', t: 'P/L' },
  ];

  let sortKey = store.get('sortKey', 'nextRoi');
  let sortDir = store.get('sortDir', -1);
  let activeOnly = store.get('activeOnly', false);
  let current = null;

  function el(html) { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; }

  function init() {
    if (document.getElementById('tsr-panel')) return;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const btn = el('<div id="tsr-btn" title="Stock ROI">📈 Stocks</div>');
    const panel = el(`
      <div id="tsr-panel">
        <div id="tsr-head">
          <b>📈 Torn Stock ROI</b>
          <label><input type="checkbox" id="tsr-active"> nur aktive Dividenden</label>
          <span id="tsr-age" class="dim"></span>
          <button id="tsr-reload" title="Neu laden">⟳</button>
          <button id="tsr-cfg" title="Einstellungen">⚙</button>
          <button id="tsr-close" title="Schliessen">✕</button>
        </div>
        <div id="tsr-set"></div>
        <div id="tsr-sum"></div>
        <div id="tsr-body"><div id="tsr-msg">Lade…</div></div>
      </div>`);
    document.body.appendChild(btn);
    document.body.appendChild(panel);

    const open = (o) => {
      panel.classList.toggle('open', o);
      store.set('open', o);
      if (o) refresh(false);
    };
    btn.onclick = () => open(!panel.classList.contains('open'));
    panel.querySelector('#tsr-close').onclick = () => open(false);
    panel.querySelector('#tsr-reload').onclick = () => refresh(true);
    panel.querySelector('#tsr-cfg').onclick = toggleSettings;
    const cb = panel.querySelector('#tsr-active');
    cb.checked = activeOnly;
    cb.onchange = () => { activeOnly = cb.checked; store.set('activeOnly', activeOnly); render(); };

    // Auf der Aktien-Seite automatisch öffnen, sonst letzten Zustand merken
    if (/sid=stocks/.test(location.href) || store.get('open', false)) open(true);
    if (!getKey()) toggleSettings();
  }

  function toggleSettings() {
    const box = document.getElementById('tsr-set');
    if (box.classList.contains('open')) { box.classList.remove('open'); return; }
    const c = settings();
    const isPda = PDA_KEY && !PDA_KEY.startsWith('#');
    box.innerHTML = `
      <div class="g">
        <label>API-Key (Limited Access)<input id="tsr-k" type="password" value="${esc(isPda ? '' : store.get('apikey', ''))}" ${isPda ? 'disabled placeholder="via Torn PDA"' : ''}></label>
        <label>$ pro Energy <small>0 = Xanax/250</small><input id="tsr-e" type="number" value="${c.energy}"></label>
        <label>$ pro Nerve<input id="tsr-n" type="number" value="${c.nerve}"></label>
        <label>$ pro Happy<input id="tsr-h" type="number" value="${c.happy}"></label>
        <label>$ pro Point <small>0 = Points-Markt</small><input id="tsr-p" type="number" value="${c.points}"></label>
        <label>$ pro Property (HRG)<input id="tsr-pr" type="number" value="${c.property}"></label>
      </div>
      <label>Manuelle Werte pro Auszahlung (überschreibt alles), Format: <code>ACR=Betrag</code>, kommagetrennt, z.B. <code>HRG=400000000, TCC=60000000</code>
        <textarea id="tsr-o">${esc(Object.entries(c.overrides || {}).map(([k, v]) => k + '=' + v).join(', '))}</textarea></label>
      <div style="margin-top:6px"><button id="tsr-save">Speichern</button>
      <small> Key wird nur lokal im Browser gespeichert und nur an api.torn.com gesendet.</small></div>`;
    box.classList.add('open');
    box.querySelector('#tsr-save').onclick = () => {
      if (!isPda) store.set('apikey', box.querySelector('#tsr-k').value.trim());
      const overrides = {};
      box.querySelector('#tsr-o').value.split(/[,;\n]/).forEach((p) => {
        const m = p.match(/^\s*([A-Za-z]+)\s*=\s*([\d.,kmb]+)\s*$/i);
        if (!m) return;
        let v = m[2].toLowerCase().replace(/,/g, '');
        const mult = v.endsWith('b') ? 1e9 : v.endsWith('m') ? 1e6 : v.endsWith('k') ? 1e3 : 1;
        overrides[m[1].toUpperCase()] = parseFloat(v) * mult;
      });
      store.set('settings', {
        energy: +box.querySelector('#tsr-e').value || 0,
        nerve: +box.querySelector('#tsr-n').value || 0,
        happy: +box.querySelector('#tsr-h').value || 0,
        points: +box.querySelector('#tsr-p').value || 0,
        property: +box.querySelector('#tsr-pr').value || 0,
        overrides,
      });
      box.classList.remove('open');
      refresh(true);
    };
  }

  async function refresh(force) {
    const body = document.getElementById('tsr-body');
    if (!current || force) body.innerHTML = '<div id="tsr-msg">Lade Daten von der Torn API…</div>';
    try {
      current = await loadData(force);
      render();
    } catch (e) {
      body.innerHTML = `<div id="tsr-msg">⚠ ${esc(e.message)}</div>`;
    }
  }

  function render() {
    if (!current) return;
    const rows = buildRows(current).filter((r) => !activeOnly || !r.isPassive);
    rows.sort((a, b) => {
      let x = a[sortKey], y = b[sortKey];
      const xn = x == null || x === '', yn = y == null || y === '';
      if (xn && yn) return 0;
      if (xn) return 1;              // leere Werte immer nach unten
      if (yn) return -1;
      if (typeof x === 'string') return x.localeCompare(y) * sortDir;
      return (x - y) * sortDir;
    });

    const mine = rows.filter((r) => r.ownedShares > 0);
    const worth = mine.reduce((a, r) => a + r.worth, 0);
    const pl = mine.reduce((a, r) => a + (r.pl || 0), 0);
    const income = mine.reduce((a, r) => a + r.income, 0);
    document.getElementById('tsr-sum').innerHTML = `
      <span>Portfolio: <b>${fmt$(worth)}</b></span>
      <span>P/L: <b class="${pl >= 0 ? 'pos' : 'neg'}">${fmt$(pl)}</b></span>
      <span>Dividenden p.a.: <b>${fmt$(income)}</b> (${fmtPct(worth ? income / worth : null)})</span>
      ${current.userErr ? `<span class="neg">User-Stocks: ${esc(current.userErr)}</span>` : ''}`;
    document.getElementById('tsr-age').textContent = 'Stand: ' + new Date(current.ts).toLocaleTimeString('de-CH');

    const head = COLS.map((c) => `<th data-k="${c.k}" class="${c.l ? 'l' : ''} ${c.k === sortKey ? 'sorted' : ''}">${c.t}${c.k === sortKey ? (sortDir < 0 ? ' ▼' : ' ▲') : ''}</th>`).join('');
    const body = rows.map((r, i) => {
      const plCls = r.pl == null ? 'dim' : r.pl >= 0 ? 'pos' : 'neg';
      return `<tr class="${r.ownedShares > 0 ? 'own' : ''}">
        <td class="l dim">${i + 1}</td>
        <td class="l" title="${esc(r.name)}"><b>${esc(r.acr)}</b></td>
        <td>${fmtPrice(r.price)}</td>
        <td class="l">${esc(r.desc)}${r.isPassive ? ' <span class="dim">(passiv)</span>' : ''}</td>
        <td title="${esc(r.note)}">${r.value != null ? fmt$(r.value) : `<span class="dim">${esc(r.note)}</span>`}</td>
        <td>${r.freq || '–'}</td>
        <td>${fmtN(r.req)}</td>
        <td>${fmt$(r.blockCost)}</td>
        <td class="${r.roi != null ? 'hot' : 'dim'}">${fmtPct(r.roi)}</td>
        <td title="${fmtN(r.ownedShares)} Aktien">${r.blocks ? r.blocks + '× BB' : '<span class="dim">–</span>'}</td>
        <td>${r.isPassive && r.blocks ? '<span class="dim">✓</span>' : fmtN(r.missing)}</td>
        <td>${r.isPassive && r.blocks ? '<span class="dim">–</span>' : fmt$(r.nextCost)}</td>
        <td class="${r.nextRoi != null ? 'hot' : 'dim'}">${fmtPct(r.nextRoi)}</td>
        <td class="${plCls}">${r.pl == null ? '–' : fmt$(r.pl)}</td>
      </tr>`;
    }).join('');

    const wrap = document.getElementById('tsr-body');
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

  if (document.body) init();
  else window.addEventListener('DOMContentLoaded', init);
})();
