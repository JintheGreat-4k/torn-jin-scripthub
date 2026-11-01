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
