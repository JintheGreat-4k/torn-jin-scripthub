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
