// K2K : gestion du risque, dans l'esprit des outils des grands gérants (Aladdin) :
// taille de position calculée à partir du risque accepté, stress test et liens entre marchés.
(function (root) {
  'use strict';

  // Valeur d'un mouvement de 1 (en prix) pour 1 lot. Standards MT5 les plus courants ; à vérifier chez ton courtier.
  const SPEC = {
    XAUUSD: { per: 100, unit: 'lot', note: '1 lot = 100 onces' },
    NAS100: { per: 1, unit: 'lot', note: '1 lot = 1 $ par point' },
    EURUSD: { per: 100000, unit: 'lot', note: '1 lot = 100 000 €' },
    BTC: { per: 1, unit: 'BTC', note: 'taille en BTC' },
    ETH: { per: 1, unit: 'ETH', note: 'taille en ETH' },
    SOL: { per: 1, unit: 'SOL', note: 'taille en SOL' },
    BNB: { per: 1, unit: 'BNB', note: 'taille en BNB' },
    XRP: { per: 1, unit: 'XRP', note: 'taille en XRP' },
  };

  // Taille de position : le risque en $ divisé par la perte d'un lot entre l'entrée et le stop.
  function size(sym, capital, pct, entry, stop) {
    const s = SPEC[sym] || { per: 1, unit: 'unité' };
    const riskUsd = capital * pct / 100;
    const perLot = Math.abs(entry - stop) * s.per;
    if (!perLot || !riskUsd) return null;
    const raw = riskUsd / perLot;
    const step = s.unit === 'lot' ? 0.01 : raw >= 100 ? 1 : raw >= 1 ? 0.01 : 0.0001;
    const lots = Math.floor(raw / step) * step;
    return { lots, unit: s.unit, note: s.note, riskUsd, lossUsd: lots * perLot, notional: lots * s.per * entry, per: s.per };
  }

  const pnl = (z, from, to, dir) => (to - from) * dir * z.lots * z.per;

  // Scénarios de stress : ce que coûte la position si le marché part violemment contre toi.
  function stress(z, p, atr4h) {
    const out = [{ name: 'Stop touché', loss: pnl(z, p.entry, p.stop, p.dir) }];
    if (atr4h) {
      out.push({ name: 'Stop qui glisse (½ bougie 4h)', loss: pnl(z, p.entry, p.stop - p.dir * atr4h * 0.5, p.dir) });
      out.push({ name: 'Choc 2× bougie 4h sans stop', loss: pnl(z, p.entry, p.entry - p.dir * atr4h * 2, p.dir) });
      out.push({ name: 'Choc 3× (annonce, week-end)', loss: pnl(z, p.entry, p.entry - p.dir * atr4h * 3, p.dir) });
    }
    return out;
  }

  // Corrélation des rendements 4h sur les 100 dernières bougies.
  function corr(a, b) {
    const ma = new Map(a.map(k => [k.time, k.close]));
    const pairs = [];
    for (let i = 1; i < b.length; i++) {
      const x0 = ma.get(b[i - 1].time), x1 = ma.get(b[i].time);
      if (x0 && x1) pairs.push([Math.log(x1 / x0), Math.log(b[i].close / b[i - 1].close)]);
    }
    const n = pairs.length;
    if (n < 30) return null;
    const mx = pairs.reduce((s, p) => s + p[0], 0) / n, my = pairs.reduce((s, p) => s + p[1], 0) / n;
    let sxy = 0, sx = 0, sy = 0;
    for (const [x, y] of pairs) { sxy += (x - mx) * (y - my); sx += (x - mx) ** 2; sy += (y - my) ** 2; }
    return sx && sy ? sxy / Math.sqrt(sx * sy) : null;
  }

  const cache = {};
  async function candles4h(sym) {
    const c = cache[sym];
    if (c && Date.now() - c.at < 10 * 60000) return c.data;
    const data = await root.Prices.fetchLive(sym, '4h', 120);
    cache[sym] = { at: Date.now(), data };
    return data;
  }
  async function links(sym, own) {
    const others = Object.keys(root.Prices.LIVE).filter(s => s !== sym);
    const got = await Promise.allSettled(others.map(candles4h));
    const out = [];
    got.forEach((r, i) => { if (r.status === 'fulfilled' && r.value) { const v = corr(own, r.value); if (v != null) out.push({ sym: others[i], v }); } });
    return out.sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
  }

  // Note K2K sur 100 : institutions, alignement des unités, confluences et ratio, comme un comité d'investissement.
  function grade(p, frames, cotBias) {
    if (!p || p.status === 'wait') return null;
    const tfs = ['4h', '1h', '30m', '15m', '5m'].filter(t => frames[t]);
    const aligned = tfs.filter(t => Math.sign(frames[t].smc.score) === p.dir).length / (tfs.length || 1);
    const cot = cotBias == null ? 0.5 : Math.max(0, Math.min(1, 0.5 + p.dir * cotBias / 100));
    const rr = Math.min(1, (p.rr2 || 0) / 4);
    const parts = [
      { k: 'Institutions (COT)', v: cot, w: 25 },
      { k: 'Unités alignées', v: aligned, w: 25 },
      { k: 'Confluences', v: p.confluence / 100, w: 30 },
      { k: 'Ratio gain / risque', v: rr, w: 20 },
    ];
    return { total: Math.round(parts.reduce((s, x) => s + x.v * x.w, 0)), parts };
  }

  const api = { SPEC, size, stress, corr, links, grade };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Risk = api;
})(typeof self !== 'undefined' ? self : this);
