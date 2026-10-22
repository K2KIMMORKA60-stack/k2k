// K2K : détection des empreintes Smart Money sur une série de bougies.
// Une bougie = { time (secondes UTC), open, high, low, close, volume }.
(function (root) {
  'use strict';

  // Sommets et creux de swing : une bougie plus haute (ou plus basse) que les `n` voisines de chaque côté.
  function swings(c, n) {
    n = n || 3;
    const highs = [], lows = [];
    for (let i = n; i < c.length - n; i++) {
      let isH = true, isL = true;
      for (let k = 1; k <= n; k++) {
        if (c[i].high <= c[i - k].high || c[i].high < c[i + k].high) isH = false;
        if (c[i].low >= c[i - k].low || c[i].low > c[i + k].low) isL = false;
      }
      if (isH) highs.push({ i, price: c[i].high, time: c[i].time });
      if (isL) lows.push({ i, price: c[i].low, time: c[i].time });
    }
    return { highs, lows };
  }

  // Cassures de structure : BOS dans le sens de la tendance, CHoCH quand la tendance s'inverse.
  function structure(c, sw) {
    const events = [];
    let trend = 0; // 1 haussier, -1 baissier
    let hi = null, lo = null; // dernier swing non cassé
    let hIdx = 0, lIdx = 0;
    for (let i = 0; i < c.length; i++) {
      while (hIdx < sw.highs.length && sw.highs[hIdx].i + 3 <= i) { hi = sw.highs[hIdx]; hIdx++; }
      while (lIdx < sw.lows.length && sw.lows[lIdx].i + 3 <= i) { lo = sw.lows[lIdx]; lIdx++; }
      if (hi && c[i].close > hi.price) {
        events.push({ type: trend === -1 ? 'CHoCH' : 'BOS', dir: 1, i, from: hi.i, price: hi.price, time: c[i].time });
        trend = 1; hi = null;
      } else if (lo && c[i].close < lo.price) {
        events.push({ type: trend === 1 ? 'CHoCH' : 'BOS', dir: -1, i, from: lo.i, price: lo.price, time: c[i].time });
        trend = -1; lo = null;
      }
    }
    return { events, trend };
  }

  // Order blocks : dernière bougie opposée avant le mouvement qui casse la structure.
  function orderBlocks(c, events) {
    const obs = [];
    for (const e of events) {
      for (let j = e.i - 1; j >= Math.max(0, e.from - 10); j--) {
        const bear = c[j].close < c[j].open, bull = c[j].close > c[j].open;
        if ((e.dir === 1 && bear) || (e.dir === -1 && bull)) {
          obs.push({ dir: e.dir, i: j, top: c[j].high, bottom: c[j].low, time: c[j].time, cause: e.type });
          break;
        }
      }
    }
    // Un OB est invalidé quand une clôture le traverse complètement ; il est « mitigé » quand le prix revient dedans.
    for (const ob of obs) {
      ob.status = 'frais';
      for (let k = ob.i + 2; k < c.length; k++) {
        if (ob.dir === 1 && c[k].close < ob.bottom) { ob.status = 'invalidé'; break; }
        if (ob.dir === -1 && c[k].close > ob.top) { ob.status = 'invalidé'; break; }
        if (ob.dir === 1 && c[k].low <= ob.top) ob.status = 'mitigé';
        if (ob.dir === -1 && c[k].high >= ob.bottom) ob.status = 'mitigé';
      }
    }
    return dedupe(obs);
  }

  function dedupe(obs) {
    const seen = new Set();
    return obs.filter(o => { const k = o.i + ':' + o.dir; if (seen.has(k)) return false; seen.add(k); return true; });
  }

  // Fair Value Gaps : écart entre la mèche de la bougie 1 et celle de la bougie 3.
  // On ignore les écarts minuscules : il faut au moins 30 % de la taille moyenne d'une bougie.
  function fvgs(c, minFrac) {
    minFrac = minFrac || 0.3;
    const avgRange = c.reduce((s, x) => s + (x.high - x.low), 0) / c.length;
    const min = avgRange * minFrac;
    const out = [];
    for (let i = 2; i < c.length; i++) {
      const a = c[i - 2], b = c[i];
      if (b.low - a.high >= min) out.push({ dir: 1, i: i - 1, top: b.low, bottom: a.high, time: c[i - 1].time });
      if (a.low - b.high >= min) out.push({ dir: -1, i: i - 1, top: a.low, bottom: b.high, time: c[i - 1].time });
    }
    for (const f of out) {
      f.filled = false;
      for (let k = f.i + 2; k < c.length; k++) {
        if (f.dir === 1 && c[k].low <= f.bottom) { f.filled = true; break; }
        if (f.dir === -1 && c[k].high >= f.top) { f.filled = true; break; }
      }
    }
    return out;
  }

  // Chasse de liquidité : la mèche dépasse un swing puis la bougie clôture de nouveau à l'intérieur.
  function sweeps(c, sw) {
    const out = [];
    const check = (list, dir) => {
      for (const s of list) {
        for (let k = s.i + 4; k < Math.min(c.length, s.i + 80); k++) {
          if (dir === -1 && c[k].high > s.price) { if (c[k].close < s.price) out.push({ dir: -1, i: k, level: s.price, time: c[k].time }); break; }
          if (dir === 1 && c[k].low < s.price) { if (c[k].close > s.price) out.push({ dir: 1, i: k, level: s.price, time: c[k].time }); break; }
        }
      }
    };
    check(sw.highs, -1); // balayage des sommets : liquidité acheteuse prise, signal baissier
    check(sw.lows, 1);   // balayage des creux : liquidité vendeuse prise, signal haussier
    return out.sort((a, b) => a.i - b.i);
  }

  // Volume anormal : plus de `mult` fois la moyenne des `len` bougies précédentes.
  function volumeSpikes(c, len, mult) {
    len = len || 20; mult = mult || 2.2;
    const out = [];
    if (!c.some(x => x.volume > 0)) return out;
    let sum = 0;
    for (let i = 0; i < c.length; i++) {
      if (i >= len) {
        const avg = sum / len;
        if (avg > 0 && c[i].volume > avg * mult) out.push({ i, ratio: c[i].volume / avg, dir: c[i].close >= c[i].open ? 1 : -1, time: c[i].time });
        sum -= c[i - len].volume;
      }
      sum += c[i].volume;
    }
    return out;
  }

  function analyze(c) {
    if (!c || c.length < 30) return null;
    const sw = swings(c, 3);
    const st = structure(c, sw);
    const obs = orderBlocks(c, st.events);
    const gaps = fvgs(c);
    const sw2 = sweeps(c, sw);
    const vol = volumeSpikes(c);
    const last = c[c.length - 1];
    const recent = c.length - 40;

    // Score de biais : -100 (vendeur) à +100 (acheteur), à partir des empreintes récentes.
    let score = 0;
    const reasons = [];
    if (st.trend) { score += 30 * st.trend; reasons.push(st.trend > 0 ? 'Structure haussière (dernière cassure vers le haut)' : 'Structure baissière (dernière cassure vers le bas)'); }
    const lastEv = st.events[st.events.length - 1];
    if (lastEv && lastEv.type === 'CHoCH' && lastEv.i >= recent) { score += 15 * lastEv.dir; reasons.push('CHoCH récent : changement de caractère ' + (lastEv.dir > 0 ? 'haussier' : 'baissier')); }
    const lastSweep = sw2.filter(s => s.i >= recent).pop();
    if (lastSweep) { score += 20 * lastSweep.dir; reasons.push(lastSweep.dir > 0 ? 'Liquidité sous un creux balayée (achat institutionnel possible)' : 'Liquidité au-dessus d\'un sommet balayée (vente institutionnelle possible)'); }
    const liveObs = obs.filter(o => o.status !== 'invalidé');
    const inOb = liveObs.filter(o => last.close <= o.top && last.close >= o.bottom);
    for (const o of inOb) { score += 20 * o.dir; reasons.push('Prix dans un order block ' + (o.dir > 0 ? 'haussier' : 'baissier')); }
    const recentVol = vol.filter(v => v.i >= c.length - 15);
    if (recentVol.length) { const v = recentVol[recentVol.length - 1]; score += 15 * v.dir; reasons.push('Volume anormal (x' + v.ratio.toFixed(1) + ') sur une bougie ' + (v.dir > 0 ? 'acheteuse' : 'vendeuse')); }
    score = Math.max(-100, Math.min(100, score));

    return { swings: sw, events: st.events, trend: st.trend, orderBlocks: obs, fvgs: gaps, sweeps: sw2, volume: vol, score, reasons, last };
  }

  const api = { swings, structure, orderBlocks, fvgs, sweeps, volumeSpikes, analyze };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SMC = api;
})(typeof self !== 'undefined' ? self : this);
