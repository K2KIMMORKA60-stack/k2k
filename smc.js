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

  // Order blocks, tracés comme sur TradingView : entre le sommet (ou creux) cassé et la cassure, on prend la bougie
  // du point extrême (plus bas creux pour un OB haussier, plus haut sommet pour un OB baissier), de sa mèche haute à sa mèche basse.
  function orderBlocks(c, events) {
    const obs = [];
    for (const e of events) {
      let x = -1;
      for (let j = e.from; j < e.i; j++) {
        if (x < 0 || (e.dir === 1 ? c[j].low < c[x].low : c[j].high > c[x].high)) x = j;
      }
      if (x >= 0 && x < e.i - 0) { obs.push({ dir: e.dir, i: x, top: c[x].high, bottom: c[x].low, time: c[x].time, cause: e.type }); continue; }
      // Repli : dernière bougie opposée avant le mouvement qui casse la structure.
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

  // Taille moyenne d'une bougie (ATR simplifié sur `len` bougies) : sert d'unité pour les marges et les tolérances.
  function atr(c, len) {
    len = len || 14;
    const n = Math.min(len, c.length - 1);
    let sum = 0;
    for (let i = c.length - n; i < c.length; i++) sum += Math.max(c[i].high - c[i].low, Math.abs(c[i].high - c[i - 1].close), Math.abs(c[i].low - c[i - 1].close));
    return sum / n;
  }

  // Range de travail : du dernier sommet au dernier creux de swing. Au-dessus de 50 % = premium (cher), en dessous = discount.
  // OTE (optimal trade entry) = retracement de 62 à 79 % du dernier mouvement.
  function dealingRange(c, sw, trend) {
    const h = sw.highs[sw.highs.length - 1], l = sw.lows[sw.lows.length - 1];
    if (!h || !l) return null;
    const hi = Math.max(h.price, ...c.slice(Math.min(h.i, l.i)).map(x => x.high));
    const lo = Math.min(l.price, ...c.slice(Math.min(h.i, l.i)).map(x => x.low));
    const r = hi - lo;
    if (r <= 0) return null;
    const last = c[c.length - 1].close;
    const pos = (last - lo) / r;
    // Mouvement haussier (le creux précède le sommet) : on cherche à acheter dans le retracement, et inversement.
    const up = trend ? trend > 0 : l.i < h.i;
    const ote = up ? { top: hi - 0.62 * r, bottom: hi - 0.79 * r, dir: 1 } : { top: lo + 0.79 * r, bottom: lo + 0.62 * r, dir: -1 };
    return { high: hi, low: lo, eq: lo + r / 2, pos, zone: pos > 0.5 ? 'premium' : 'discount', ote };
  }

  // Réservoirs de liquidité : sommets égaux (EQH), creux égaux (EQL), plus haut / plus bas de la veille (PDH / PDL).
  // Un niveau est « pris » quand le prix l'a dépassé depuis.
  function liquidity(c, sw, unit) {
    const out = [];
    const tol = unit * 0.15;
    const pairs = (list, type, dir) => {
      for (let a = list.length - 1; a > 0 && a >= list.length - 8; a--) {
        for (let b = a - 1; b >= 0 && b >= a - 4; b--) {
          if (Math.abs(list[a].price - list[b].price) <= tol) {
            const level = dir > 0 ? Math.max(list[a].price, list[b].price) : Math.min(list[a].price, list[b].price);
            const after = c.slice(list[a].i + 1);
            const taken = dir > 0 ? after.some(x => x.high > level) : after.some(x => x.low < level);
            out.push({ type, level, dir, taken, time: list[a].time });
            break;
          }
        }
      }
    };
    pairs(sw.highs, 'EQH', 1);
    pairs(sw.lows, 'EQL', -1);
    const day = t => Math.floor(t / 86400);
    const today = day(c[c.length - 1].time);
    const yest = c.filter(x => day(x.time) === today - 1);
    if (yest.length && yest.length < c.length) {
      const pdh = Math.max(...yest.map(x => x.high)), pdl = Math.min(...yest.map(x => x.low));
      const todays = c.filter(x => day(x.time) === today);
      out.push({ type: 'PDH', level: pdh, dir: 1, taken: todays.some(x => x.high > pdh) });
      out.push({ type: 'PDL', level: pdl, dir: -1, taken: todays.some(x => x.low < pdl) });
    }
    // On garde un seul niveau par prix (à la tolérance près).
    return out.filter((x, i) => out.findIndex(y => y.type.slice(0, 2) === x.type.slice(0, 2) && Math.abs(y.level - x.level) <= tol) === i);
  }

  // Note de qualité d'un order block, sur 100 : force du départ, FVG laissé, type de cassure, zone, fraîcheur, liquidité prise avant.
  function gradeBlocks(c, obs, gaps, range, sw, unit) {
    const avgBody = c.reduce((s, x) => s + Math.abs(x.close - x.open), 0) / c.length || 1;
    for (const o of obs) {
      const why = [];
      let q = 0;
      const next = c.slice(o.i + 1, o.i + 4);
      const disp = Math.max(0, ...next.map(x => Math.abs(x.close - x.open))) / avgBody;
      if (disp >= 2) { q += 25; why.push('départ violent'); } else if (disp >= 1.4) { q += 15; why.push('bon départ'); }
      if (gaps.some(g => g.dir === o.dir && g.i > o.i && g.i <= o.i + 3)) { q += 20; why.push('FVG laissé derrière'); }
      if (o.cause === 'CHoCH') { q += 20; why.push('a provoqué un CHoCH'); } else { q += 12; why.push('a provoqué un BOS'); }
      if (range) {
        const mid = (o.top + o.bottom) / 2;
        if ((o.dir > 0 && mid < range.eq) || (o.dir < 0 && mid > range.eq)) { q += 15; why.push(o.dir > 0 ? 'en zone discount' : 'en zone premium'); }
      }
      if (o.status === 'frais') { q += 15; why.push('jamais touché'); } else if (o.status === 'mitigé') q += 4;
      const prior = (o.dir > 0 ? sw.lows : sw.highs).filter(s => s.i < o.i && s.i >= o.i - 25);
      if (prior.some(s => (o.dir > 0 ? c[o.i].low < s.price : c[o.i].high > s.price))) { q += 10; why.push('a pris de la liquidité'); }
      if (o.top - o.bottom > unit * 3) q -= 10; // zone trop large : stop trop loin
      o.quality = Math.max(0, Math.min(100, q));
      o.why = why;
      // Étoiles : les 5 critères qui donnent le plus de chances de réaction. 5 étoiles = tous réunis.
      const keys = ['départ violent', 'FVG laissé derrière', 'a pris de la liquidité', 'jamais touché', o.dir > 0 ? 'en zone discount' : 'en zone premium'];
      o.stars = Math.max(1, keys.filter(k => why.includes(k)).length);
    }
    return obs;
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
    const unit = atr(c, 14);
    const range = dealingRange(c, sw, st.trend);
    gradeBlocks(c, obs, gaps, range, sw, unit);
    const liq = liquidity(c, sw, unit);

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

    return { swings: sw, events: st.events, trend: st.trend, orderBlocks: obs, fvgs: gaps, sweeps: sw2, volume: vol, score, reasons, last, atr: unit, range, liquidity: liq };
  }

  const api = { swings, structure, orderBlocks, fvgs, sweeps, volumeSpikes, atr, dealingRange, liquidity, gradeBlocks, analyze };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SMC = api;
})(typeof self !== 'undefined' ? self : this);
