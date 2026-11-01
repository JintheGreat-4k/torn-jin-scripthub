import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSource } from './helpers/load-source.mjs';

const L = loadSource('src/modules/chain-alarm/logic.js', [
  'normalize', 'normalizeSettings', 'newTracker', 'applyApi', 'remainingS', 'newAlarm', 'evalAlarm',
  'fmtClock', 'fmtChainMax', 'SOURCES', 'DEFAULTS', 'HYSTERESIS_S', 'EXPIRE_GRACE_MS',
]);
const chain = (current, timeout, extra = {}) => ({ current, max: 100, timeout, cooldown: 0, modifier: 1, ...extra });

test('normalize: v1 user/bars, v2 user/bars, faction chain, unwrapped', () => {
  const c = { current: 12, maximum: 25, timeout: 200, cooldown: 0, modifier: 1.1 };
  const want = { current: 12, max: 25, timeout: 200, cooldown: 0, modifier: 1.1 };
  assert.deepEqual(L.normalize({ chain: c }), want);
  assert.deepEqual(L.normalize({ bars: { chain: c } }), want);
  assert.deepEqual(L.normalize(c), want);
  assert.deepEqual(L.normalize({ chain: { current: 3, max: 10, timeout: 50 } }).max, 10);
});

test('normalize: v2 null chain means no chain; timeout is clamped', () => {
  assert.deepEqual(L.normalize({ bars: { chain: null } }), { current: 0, max: 0, timeout: 0, cooldown: 0, modifier: 1 });
  assert.equal(L.normalize({ chain: { current: 1, timeout: 9999 } }).timeout, 300);
  assert.equal(L.normalize({ chain: { current: 1, timeout: -5 } }).timeout, 0);
});

test('normalize: API errors carry apiCode, garbage throws', () => {
  assert.throws(() => L.normalize({ error: { code: 2, error: 'Incorrect Key' } }), (e) => e.apiCode === 2 && /Incorrect Key/.test(e.message));
  assert.throws(() => L.normalize(null), /invalid/);
  assert.throws(() => L.normalize({ foo: 1 }), /No chain data/);
});

test('normalizeSettings: defaults, unknown source, bounds', () => {
  assert.deepEqual(L.normalizeSettings(undefined), { ...L.DEFAULTS });
  const s = L.normalizeSettings({ source: 'nope', thresholdMin: -1, minChain: 7.8, intervalS: 1, soundUrl: '  x.mp3 ' });
  assert.equal(s.source, L.DEFAULTS.source);
  assert.equal(s.thresholdMin, L.DEFAULTS.thresholdMin);
  assert.equal(s.minChain, 7);
  assert.equal(s.intervalS, 5);
  assert.equal(s.soundUrl, 'x.mp3');
  for (const src of Object.values(L.SOURCES)) assert.ok(!/key=/.test(src.path), 'sources must not embed the key');
});

test('applyApi: start, hit, keep smaller timer, update', () => {
  const t = L.newTracker();
  assert.equal(L.applyApi(t, chain(10, 200), 0).event, 'start');
  assert.equal(t.deadline, 200000);
  assert.equal(L.applyApi(t, chain(11, 300), 1000).event, 'hit');
  assert.equal(t.deadline, 301000);
  // same length, cached response with a higher timer -> never move the deadline up
  assert.equal(L.applyApi(t, chain(11, 300), 10000).event, 'kept');
  assert.equal(t.deadline, 301000);
  // same length, smaller timer -> take it
  assert.equal(L.applyApi(t, chain(11, 250), 20000).event, 'update');
  assert.equal(t.deadline, 270000);
});

test('applyApi: stale cache responses are ignored', () => {
  const t = L.newTracker();
  L.applyApi(t, chain(20, 290), 0);
  assert.equal(L.applyApi(t, chain(19, 280), 5000).event, 'stale');
  assert.equal(t.current, 20);
  // "no chain" while our timer still has far more than the cache window left -> stale
  assert.equal(L.applyApi(t, chain(0, 0), 10000).event, 'stale');
  assert.equal(t.active, true);
});

test('applyApi: plausible end and new chain after expiry', () => {
  const t = L.newTracker();
  L.applyApi(t, chain(20, 40), 0);
  assert.equal(L.applyApi(t, chain(0, 0), 10000).event, 'ended');   // <= 35 s left -> plausible
  assert.equal(t.active, false);
  assert.equal(L.applyApi(t, chain(0, 0), 11000).event, 'none');

  const u = L.newTracker();
  L.applyApi(u, chain(30, 10), 0);
  assert.equal(L.applyApi(u, chain(2, 290), 20000).event, 'start');  // expired + smaller = new chain
  assert.equal(u.current, 2);
});

test('remainingS', () => {
  const t = L.newTracker();
  assert.equal(L.remainingS(t, 0), null);
  L.applyApi(t, chain(5, 100), 0);
  assert.equal(L.remainingS(t, 40000), 60);
  assert.equal(L.remainingS(t, 999999), 0);
});

test('evalAlarm: threshold, min chain, hysteresis, grace period', () => {
  const cfg = { thresholdMin: 2, minChain: 10 };
  const t = L.newTracker();
  const a = L.newAlarm();
  L.applyApi(t, chain(50, 200), 0);
  assert.equal(L.evalAlarm(a, t, cfg, 0), null);                 // 200 s left > 120 s
  assert.equal(L.evalAlarm(a, t, cfg, 81000), 'on');            // 119 s left
  assert.equal(a.on, true);
  // timer back up a little, still inside hysteresis -> stays on
  t.deadline = 81000 + (120 + L.HYSTERESIS_S - 1) * 1000;
  assert.equal(L.evalAlarm(a, t, cfg, 81000), null);
  t.deadline = 81000 + (120 + L.HYSTERESIS_S + 1) * 1000;
  assert.equal(L.evalAlarm(a, t, cfg, 81000), 'off');
  // expired: keeps ringing during the grace period, then stops
  L.evalAlarm(a, t, cfg, t.deadline - 1000);
  assert.equal(a.on, true);
  assert.equal(L.evalAlarm(a, t, cfg, t.deadline + L.EXPIRE_GRACE_MS - 1), null);
  assert.equal(L.evalAlarm(a, t, cfg, t.deadline + L.EXPIRE_GRACE_MS), 'off');
});

test('evalAlarm: no alarm below the minimum chain length', () => {
  const t = L.newTracker();
  const a = L.newAlarm();
  L.applyApi(t, chain(5, 30), 0);
  assert.equal(L.evalAlarm(a, t, { thresholdMin: 2, minChain: 10 }, 0), null);
  assert.equal(L.evalAlarm(a, t, { thresholdMin: 2, minChain: 5 }, 0), 'on');
});

test('formatters', () => {
  assert.equal(L.fmtClock(null), '--:--');
  assert.equal(L.fmtClock(0), '00:00');
  assert.equal(L.fmtClock(119.2), '02:00');
  assert.equal(L.fmtClock(65), '01:05');
  assert.equal(L.fmtChainMax(2500), '2,500');
  assert.equal(L.fmtChainMax(10000), '10k');
});
