// K2K : probabilités mesurées sur l'historique réel, à la place des pourcentages fixés à la main.
// Pour chaque situation (retour dans un order block, contact avec un sommet, un creux, un chiffre rond…),
// on cherche toutes les fois où elle s'est produite dans les bougies passées de cet actif et de cette unité,
// et on compte ce qui s'est passé ensuite. Moins de 30 cas : on n'affiche pas de chiffre.
(function (root) {
  'use strict';

  const MIN_CASES = 30;
  const HORIZON = 300; // au-delà, le cas est ignoré (ni gagné ni perdu)
  const HISTORY = 3000;

  // Taille moyenne d'une bougie à chaque instant, sans regarder le futur.
  function atrSeries(c, len) {
    len = len || 14;
    const tr = c.map((x, i) => i ? Math.max(x.high - x.low, Math.abs(x.high - c[i - 1].close), Math.abs(x.low - c[i - 1].close)) : x.high - x.low);
    const out = new Float64Array(c.length);
    let sum = 0;
    for (let i = 0; i < c.length; i++) { sum += tr[i]; if (i >= len) sum -= tr[i - len]; out[i] = sum / Math.min(i + 1, len); }
    return out;
  }

  // Pas du chiffre rond : 1 000 sur BTC, 100 sur l'or, 0,01 sur l'EURUSD.
  function roundStep(x) { const e = Math.floor(Math.log10(x)); return Math.pow(10, x < 10 ? e - 2 : e - 1); }

  function build(c, S) {
    S = S || root.SMC;
    if (!c || c.length < 200) return null;
    const sw = S.swings(c, 3);
    const st = S.structure(c, sw);
    const atr = atrSeries(c);
    // Sens de la structure connu à chaque bougie (dernière cassure).
    const trend = new Int8Array(c.length);
    for (let i = 0, t = 0, e = 0; i < c.length; i++) { while (e < st.events.length && st.events[e].i <= i) t = st.events[e++].dir; trend[i] = t; }

    // Contact avec un niveau : le prix part-il d'un ATR dans le sens de la réaction, ou casse-t-il d'un ATR ?
    // side -1 = résistance (le prix arrive par en dessous), +1 = support.
    const levels = {};
    const record = (key, v) => { const b = levels[key] || (levels[key] = { n: 0, rev: 0 }); b.n++; b.rev += v; };
    function resolve(k, level, side) {
      const a = atr[k];
      for (let j = k; j < Math.min(c.length, k + HORIZON); j++) {
        const brk = side < 0 ? c[j].high >= level + a : c[j].low <= level - a;
        const rev = j > k && (side < 0 ? c[j].low <= level - a : c[j].high >= level + a);
        if (brk && rev) return { j, v: null };
        if (brk) return { j, v: 0 };
        if (rev) return { j, v: 1 };
      }
      return { j: c.length, v: null };
    }
    function touch(cat, side, level, from) {
      for (let k = Math.max(1, from); k < c.length; k++) {
        if (side < 0 ? c[k].high >= level : c[k].low <= level) {
          const r = resolve(k, level, side);
          if (r.v != null) record(cat + ':' + side, r.v);
          return;
        }
      }
    }
    for (const s of sw.highs) touch('swing', -1, s.price, s.i + 4);
    for (const s of sw.lows) touch('swing', 1, s.price, s.i + 4);

    // Order blocks : chaque cassure de structure crée une zone ; on suit son premier retour.
    const setups = [];
    for (const ev of st.events) {
      const ob = S.orderBlocks(c, [ev])[0];
      if (!ob) continue;
      const entry = ob.dir > 0 ? ob.top : ob.bottom, inv = ob.dir > 0 ? ob.bottom : ob.top;
      for (let k = ev.i + 1; k < c.length; k++) {
        if (ob.dir > 0 ? c[k].low <= ob.top : c[k].high >= ob.bottom) {
          if (entry !== inv) setups.push({ dir: ob.dir, k, entry, inv, aligned: trend[k - 1] === ob.dir });
          const r = resolve(k, entry, ob.dir);
          if (r.v != null) record('ob:' + ob.dir, r.v);
          break;
        }
      }
      // Breaker : après une clôture qui traverse la zone, son retour dans l'autre sens.
      for (let k = ob.i + 2; k < c.length; k++) {
        if (ob.dir > 0 ? c[k].close < ob.bottom : c[k].close > ob.top) { touch('breaker', -ob.dir, ob.dir > 0 ? ob.bottom : ob.top, k + 1); break; }
      }
    }

    // Chiffres ronds, au pas du prix actuel.
    const step = roundStep(c[c.length - 1].close);
    for (let k = 1; k < c.length;) {
      const up = Math.ceil(c[k - 1].close / step) * step, dn = Math.floor(c[k - 1].close / step) * step;
      let r = null;
      if (c[k].high >= up && c[k - 1].high < up) { r = resolve(k, up, -1); if (r.v != null) record('psy:-1', r.v); }
      else if (c[k].low <= dn && c[k - 1].low > dn) { r = resolve(k, dn, 1); if (r.v != null) record('psy:1', r.v); }
      k = r ? Math.max(k + 1, r.j) : k + 1;
    }

    const pct = (n, w) => ({ n, pct: n >= MIN_CASES ? Math.round(w / n * 100) : null });
    return {
      bars: c.length, from: c[0].time,
      // Retour dans un order block : la cible (à R fois le risque) est-elle touchée avant une clôture au-delà de la zone ?
      scenario(dir, aligned, R) {
        let n = 0, w = 0;
        for (const s of setups) {
          if (s.dir !== dir || s.aligned !== aligned) continue;
          const tgt = s.entry + dir * R * Math.abs(s.entry - s.inv);
          for (let j = s.k; j < Math.min(c.length, s.k + HORIZON); j++) {
            const lost = dir > 0 ? c[j].close < s.inv : c[j].close > s.inv;
            const won = j > s.k && (dir > 0 ? c[j].high >= tgt : c[j].low <= tgt);
            if (lost) { n++; break; }
            if (won) { n++; w++; break; }
          }
        }
        return pct(n, w);
      },
      // Part des contacts où le niveau a tenu (rejet), par type de niveau et selon qu'il est au-dessus ou en dessous.
      level(cat, side) { const b = levels[cat + ':' + side]; return b ? pct(b.n, b.rev) : pct(0, 0); },
    };
  }

  // Historique mis en cache 30 minutes par marché et unité ; on recalcule en arrière-plan.
  const cache = {};
  // undefined : pas encore mesuré ; null : historique trop court ou indisponible.
  function get(sym, tf) { const e = cache[sym + tf]; return e && !e.pending && Date.now() - e.at < 30 * 60000 ? e.data : undefined; }
  function load(sym, tf, fallback) {
    const key = sym + tf, e = cache[key];
    if (e && (e.pending || Date.now() - e.at < 30 * 60000)) return e.pending || Promise.resolve(e.data);
    const p = (root.Prices.LIVE[sym] ? root.Prices.fetchHistory(sym, tf, HISTORY) : Promise.resolve(fallback))
      .catch(() => fallback)
      .then(c => { const data = build(c); cache[key] = { at: Date.now(), data }; return data; });
    cache[key] = { at: 0, pending: p };
    return p;
  }

  const api = { MIN_CASES, roundStep, build, get, load };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Stats = api;
})(typeof self !== 'undefined' ? self : this);
