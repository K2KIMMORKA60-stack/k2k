// K2K : plan de trade automatique, façon analyste SMC.
// Le sens vient du 4h et du 1h ; l'entrée se cherche sur le meilleur order block en 30m, 15m ou 5m ;
// le stop se place derrière l'OB et les objectifs sur la liquidité opposée.
(function (root) {
  'use strict';

  const ENTRY_TFS = ['15m', '5m', '30m'];
  const MIN_RR = 2;

  // Biais de fond : structure du 4h (poids 3) et du 1h (poids 2), plus leur note SMC.
  function htfBias(frames) {
    let v = 0, n = 0;
    for (const [tf, w] of [['4h', 3], ['1h', 2]]) {
      const f = frames[tf];
      if (!f) continue;
      v += w * (f.smc.trend * 50 + f.smc.score * 0.5);
      n += w;
    }
    if (!n) return 0;
    const b = v / n;
    return b >= 25 ? 1 : b <= -25 ? -1 : 0;
  }

  // Objectifs : niveaux de liquidité dans le sens du trade, du plus proche au plus lointain.
  function targets(frames, dir, entry) {
    const lv = [];
    for (const tf of ['5m', '15m', '30m', '1h', '4h']) {
      const f = frames[tf];
      if (!f) continue;
      const s = f.smc;
      const hiTf = tf === '1h' || tf === '4h';
      for (const l of s.liquidity) if (!l.taken && l.dir === dir) lv.push({ price: l.level, label: l.type + ' ' + tf, ext: hiTf });
      const list = dir > 0 ? s.swings.highs : s.swings.lows;
      for (const sw of list.slice(-4)) lv.push({ price: sw.price, label: (dir > 0 ? 'sommet ' : 'creux ') + tf, ext: hiTf });
      if (s.range) lv.push({ price: dir > 0 ? s.range.high : s.range.low, label: 'extrémité du range ' + tf, ext: hiTf });
    }
    return lv.filter(l => (dir > 0 ? l.price > entry : l.price < entry)).sort((a, b) => dir * (a.price - b.price));
  }

  function build(frames, cotBias) {
    const dir = htfBias(frames);
    const anyFrame = frames['5m'] || frames['15m'] || frames['30m'] || frames['1h'] || frames['4h'];
    if (!anyFrame) return null;
    const last = anyFrame.candles[anyFrame.candles.length - 1].close;
    if (!dir) return { status: 'wait', dir: 0, last, reason: 'Le 4h et le 1h ne donnent pas de direction claire. On attend une cassure de structure sur ces unités avant de chercher une entrée.' };

    // Meilleur order block dans le sens du biais, pas trop loin du prix.
    const cands = [];
    for (const tf of ENTRY_TFS) {
      const f = frames[tf];
      if (!f) continue;
      const unit = f.smc.atr;
      for (const o of f.smc.orderBlocks) {
        if (o.dir !== dir || o.status === 'invalidé' || o.quality < 40) continue;
        const inside = last <= o.top && last >= o.bottom;
        const ahead = dir > 0 ? last > o.top : last < o.bottom; // le prix doit revenir dessus
        if (!inside && !ahead) continue;
        const dist = inside ? 0 : Math.abs(last - (dir > 0 ? o.top : o.bottom));
        if (dist > unit * 12) continue;
        cands.push({ tf, o, unit, inside, dist, rank: o.quality - (dist / unit) * 3 + (tf === '15m' ? 5 : 0) });
      }
    }
    cands.sort((a, b) => b.rank - a.rank);
    if (!cands.length) {
      return { status: 'wait', dir, last, reason: 'Le biais est ' + (dir > 0 ? 'acheteur' : 'vendeur') + ' mais aucun order block de qualité n\'est disponible près du prix en 30m, 15m ou 5m. On attend qu\'une nouvelle zone se forme.' };
    }

    const best = cands[0];
    const o = best.o;
    const entry = best.inside ? last : (dir > 0 ? o.top : o.bottom);
    const stop = dir > 0 ? o.bottom - best.unit * 0.25 : o.top + best.unit * 0.25;
    const risk = Math.abs(entry - stop);
    const tg = targets(frames, dir, entry).filter(t => Math.abs(t.price - entry) >= risk * 1);
    const tp1 = tg[0] || null;
    // TP2 : liquidité plus lointaine (de préférence en 1h ou 4h), au-delà du TP1 et à au moins MIN_RR.
    const far = tg.filter(t => !tp1 || dir * (t.price - tp1.price) >= risk * 0.5);
    const tp2 = far.find(t => t.ext && Math.abs(t.price - entry) >= risk * MIN_RR) || far.find(t => Math.abs(t.price - entry) >= risk * MIN_RR) || null;
    const rr1 = tp1 ? Math.abs(tp1.price - entry) / risk : 0;
    const rr2 = tp2 ? Math.abs(tp2.price - entry) / risk : 0;

    // Confluences : chaque point vérifié renforce le setup.
    const ef = frames[best.tf].smc;
    const checks = [];
    const add = (ok, text) => checks.push({ ok, text });
    add(true, 'Biais ' + (dir > 0 ? 'haussier' : 'baissier') + ' en 4h et 1h');
    const htfAligned = ['4h', '1h', '30m', '15m', '5m'].filter(tf => frames[tf] && Math.sign(frames[tf].smc.score) === dir).length;
    add(htfAligned >= 4, htfAligned + ' unités sur 5 dans le même sens');
    add(cotBias != null && Math.sign(cotBias) === dir && Math.abs(cotBias) >= 15, 'Les institutions (COT) vont dans le même sens');
    const ote = ef.range && ef.range.ote.dir === dir && o.bottom <= ef.range.ote.top && o.top >= ef.range.ote.bottom;
    add(!!ote, 'Order block dans la zone OTE (62 à 79 %)');
    const zoneOk = ef.range && ((dir > 0 && entry < ef.range.eq) || (dir < 0 && entry > ef.range.eq));
    add(!!zoneOk, dir > 0 ? 'Entrée en zone discount' : 'Entrée en zone premium');
    add(o.why.includes('FVG laissé derrière'), 'FVG dans le prolongement de l\'OB');
    add((ef.sweeps.some(s => s.dir === dir && s.i >= o.i - 25 && s.i <= o.i + 3) || o.why.includes('a pris de la liquidité')), 'Liquidité prise avant le départ');
    add(o.status === 'frais', 'Zone jamais touchée');
    add(rr2 >= MIN_RR, 'Ratio d\'au moins ' + MIN_RR + ' R');

    const confluence = Math.round(checks.filter(c => c.ok).length / checks.length * 100);
    const status = rr2 >= MIN_RR ? (best.inside ? 'active' : 'pending') : 'weak';

    return { status, dir, last, tf: best.tf, ob: o, entry, stop, risk, tp1, tp2, rr1, rr2, checks, confluence, atMarket: best.inside };
  }

  const api = { build, htfBias, targets, MIN_RR };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Plan = api;
})(typeof self !== 'undefined' ? self : this);
