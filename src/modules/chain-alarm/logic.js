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
