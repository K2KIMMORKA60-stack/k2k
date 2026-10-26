// K2K : probabilités mesurées sur l'historique réel, à la place des pourcentages fixés à la main.
// Pour chaque situation (retour dans un order block, contact avec un sommet, un creux, un chiffre rond…),
// on cherche toutes les fois où elle s'est produite dans les bougies passées de cet actif et de cette unité,
// et on compte ce qui s'est passé ensuite. Moins de 30 cas : on n'affiche pas de chiffre.
(function (root) {
  'use strict';

  const MIN_CASES = 30;
  const HORIZON = 300; // au-delà, le cas est ignoré (ni gagné ni perdu)
  // Profondeur d'historique par unité : environ 3 ans en 1h et 4h, 1 an en 30m, 6 mois en 15m et 5m
  // (au-delà, trop de bougies pour un téléphone). Plus de cas, des marges plus serrées, plusieurs types de marché.
  const HISTORY = { '5m': 52000, '15m': 17500, '30m': 17500, '1h': 26300, '4h': 6600, '1d': 1100, '1w': 600 };

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

  // Sens de la structure 4h connu à un instant donné : seulement les bougies 4h déjà clôturées.
  function htfTrend(h, S) {
    if (!h || h.length < 50) return null;
    const ev = S.structure(h, S.swings(h, 3)).events;
    const tr = new Int8Array(h.length);
    for (let i = 0, t = 0, e = 0; i < h.length; i++) { while (e < ev.length && ev[e].i <= i) t = ev[e++].dir; tr[i] = t; }
    return time => {
      let lo = 0, hi = h.length - 1, k = -1;
      while (lo <= hi) { const mid = (lo + hi) >> 1; if (h[mid].time + 14400 <= time) { k = mid; lo = mid + 1; } else hi = mid - 1; }
      return k < 0 ? null : tr[k];
    };
  }

  function build(c, S, h4) {
    S = S || root.SMC;
    if (!c || c.length < 200) return null;
    const at4h = htfTrend(h4, S);
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
    // Contact avec une zone (order block, breaker) : réaction = départ d'un ATR depuis le bord touché ;
    // cassure = clôture au-delà de l'autre bord. Un retest profond qui reste dans la zone n'est pas une cassure.
    function resolveZone(k, near, far, side) {
      const a = atr[k];
      for (let j = k; j < Math.min(c.length, k + HORIZON); j++) {
        const brk = side < 0 ? c[j].close > far : c[j].close < far;
        const rev = j > k && (side < 0 ? c[j].low <= near - a : c[j].high >= near + a);
        if (brk && rev) return { j, v: null };
        if (brk) return { j, v: 0 };
        if (rev) return { j, v: 1 };
      }
      return { j: c.length, v: null };
    }
    function touchZone(cat, side, near, far, from) {
      for (let k = Math.max(1, from); k < c.length; k++) {
        if (side < 0 ? c[k].high >= near : c[k].low <= near) {
          const r = resolveZone(k, near, far, side);
          if (r.v != null) record(cat + ':' + side, r.v);
          return;
        }
      }
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
          if (entry !== inv) setups.push({ dir: ob.dir, k, entry, inv, aligned: trend[k - 1] === ob.dir, htf: at4h ? at4h(c[k].time) : null });
          const r = resolveZone(k, entry, inv, ob.dir);
          if (r.v != null) record('ob:' + ob.dir, r.v);
          break;
        }
      }
      // Breaker : après une clôture qui traverse la zone, son retour dans l'autre sens.
      for (let k = ob.i + 2; k < c.length; k++) {
        if (ob.dir > 0 ? c[k].close < ob.bottom : c[k].close > ob.top) { touchZone('breaker', -ob.dir, ob.dir > 0 ? ob.bottom : ob.top, ob.dir > 0 ? ob.top : ob.bottom, k + 1); break; }
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

    // Pourcentage avec sa marge d'erreur (intervalle de Wilson à 95 %) : avec peu de cas, la vraie valeur peut être loin.
    const pct = (n, w) => {
      if (n < MIN_CASES) return { n, w, pct: null };
      const p = w / n, z = 1.96, d = 1 + z * z / n, mid = (p + z * z / (2 * n)) / d, half = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d;
      return { n, w, pct: Math.round(p * 100), lo: Math.round((mid - half) * 100), hi: Math.round((mid + half) * 100) };
    };
    // Issue de chaque retour dans un order block : 1 cible touchée, 0 invalidation (clôture au-delà de la zone), avec la bougie.
    function outcome(s, R) {
      const tgt = s.entry + s.dir * R * Math.abs(s.entry - s.inv);
      for (let j = s.k; j < Math.min(c.length, s.k + HORIZON); j++) {
        if (s.dir > 0 ? c[j].close < s.inv : c[j].close > s.inv) return { v: 0, j };
        if (j > s.k && (s.dir > 0 ? c[j].high >= tgt : c[j].low <= tgt)) return { v: 1, j };
      }
      return null;
    }
    return {
      bars: c.length, from: c[0].time,
      // Retour dans un order block : la cible (à R fois le risque) est-elle touchée avant une clôture au-delà de la zone ?
      hasHtf: !!at4h,
      // htf (facultatif) : sens du 4h au moment du retour (1 haussier, -1 baissier) pour mesurer le cas précis.
      scenario(dir, aligned, R, htf) {
        let n = 0, w = 0;
        for (const s of setups) {
          if (s.dir !== dir || s.aligned !== aligned || (htf != null && s.htf !== htf)) continue;
          const o = outcome(s, R);
          if (o) { n++; w += o.v; }
        }
        return pct(n, w);
      },
      // Scénario alternatif, mesuré à part : après la clôture d'invalidation, le prix atteint-il la cible opposée
      // (Ralt fois la hauteur de la zone, depuis le bord cassé) avant de reclôturer dans la zone ?
      alternative(dir, aligned, R, Ralt, htf) {
        let n = 0, w = 0;
        for (const s of setups) {
          if (s.dir !== dir || s.aligned !== aligned || (htf != null && s.htf !== htf)) continue;
          const o = outcome(s, R);
          if (!o || o.v) continue;
          const tgt = s.inv - dir * Ralt * Math.abs(s.entry - s.inv);
          for (let j = o.j + 1; j < Math.min(c.length, o.j + HORIZON); j++) {
            if (dir > 0 ? c[j].low <= tgt : c[j].high >= tgt) { n++; w++; break; }
            if (dir > 0 ? c[j].close > s.inv : c[j].close < s.inv) { n++; break; }
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
    const live = !!root.Prices.LIVE[sym];
    const main = (live ? root.Prices.fetchHistory(sym, tf, HISTORY[tf] || 3000) : Promise.resolve(fallback)).catch(() => fallback);
    // Le 4h sert à mesurer le cas précis (par exemple OB haussier en 1h quand le 4h est baissier).
    const h4 = live && tf !== '4h' ? root.Prices.fetchHistory(sym, '4h', HISTORY['4h']).catch(() => null) : Promise.resolve(null);
    const p = Promise.all([main, h4]).then(([c, h]) => { const data = build(c, null, h); cache[key] = { at: Date.now(), data }; return data; });
    cache[key] = { at: 0, pending: p };
    return p;
  }

  function clear(sym) { for (const k of Object.keys(cache)) if (k.startsWith(sym)) delete cache[k]; }

  const api = { clear, MIN_CASES, roundStep, build, get, load };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Stats = api;
})(typeof self !== 'undefined' ? self : this);
