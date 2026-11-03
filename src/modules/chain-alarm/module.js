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
