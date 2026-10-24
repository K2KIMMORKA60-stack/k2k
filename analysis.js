// K2K : rapport d'analyse SMC rédigé, sur le modèle des analyses « SMC IA » que Khaldor trouve les plus utiles :
// vue d'ensemble, structure, liquidité (BSL / SSL), points d'intérêt, scénario principal et alternatif avec
// probabilités, niveaux à surveiller et note de confiance. Texte seulement : rien n'est dessiné sur le graphique.
(function (root) {
  'use strict';

  const esc = t => String(t).replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));
  const stars = n => '★'.repeat(Math.max(1, Math.min(5, n))) + '☆'.repeat(5 - Math.max(1, Math.min(5, n)));
  const dirWord = d => (d > 0 ? 'haussier' : d < 0 ? 'baissier' : 'neutre');

  // Suite des derniers points de swing, nommés HH / HL / LH / LL comme sur un graphique annoté.
  function swingPoints(s) {
    const tag = (list, hi) => list.map((x, k) => ({ ...x, hi, name: k === 0 ? (hi ? 'H' : 'L') : hi ? (x.price > list[k - 1].price ? 'HH' : 'LH') : (x.price > list[k - 1].price ? 'HL' : 'LL') }));
    return tag(s.swings.highs.slice(-4), true).slice(1).concat(tag(s.swings.lows.slice(-4), false).slice(1)).sort((a, b) => a.i - b.i).slice(-5);
  }

  function trendName(pts) {
    const h = pts.filter(p => p.hi).pop(), l = pts.filter(p => !p.hi).pop();
    if (!h || !l) return 'en construction';
    if (h.name === 'HH' && l.name === 'HL') return 'HH-HL (haussière)';
    if (h.name === 'LH' && l.name === 'LL') return 'LH-LL (baissière)';
    return h.name + '-' + l.name + ' (mixte)';
  }

  // Niveau psychologique (chiffre rond) le plus proche : 80 000 sur BTC, 2 700 sur l'or, 1,05 sur l'EURUSD.
  function roundLevel(x) {
    const e = Math.floor(Math.log10(x)), step = Math.pow(10, x < 10 ? e - 2 : e - 1);
    return Math.round(x / step) * step;
  }

  // ctx = { sym, tf, frames, plan, cotBias, price(p), when(t), zones(f, n) }
  function build(ctx) {
    const f = ctx.frames[ctx.tf];
    if (!f || !f.smc) return '';
    const s = f.smc, P = ctx.price, last = f.candles[f.candles.length - 1].close;
    const htf = ['4h', '1h'].filter(t => t !== ctx.tf && ctx.frames[t]).map(t => ({ tf: t, s: ctx.frames[t].smc }));
    const bias = Math.sign(s.trend || s.score);
    const htfDir = Math.sign(htf.reduce((a, h) => a + (h.s.score || 0), 0));
    const ev = s.events[s.events.length - 1];
    const out = [];
    const h3 = t => out.push('<h3>' + t + '</h3>');
    const p = t => out.push('<p>' + t + '</p>');
    const table = (head, rows) => out.push('<div class="table-wrap"><table class="cot"><thead><tr>' + head.map(h => '<th>' + h + '</th>').join('') + '</tr></thead><tbody>' + rows.map(r => '<tr>' + r.map(c => '<td>' + c + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>');

    // 1. Vue d'ensemble
    h3('Vue d\'ensemble');
    let v = esc(ctx.sym + ' en ' + ctx.tf + ' : biais ' + dirWord(bias) + ', prix ' + P(last));
    if (s.range) v += esc(', en zone ' + s.range.zone + ' (' + Math.round(s.range.pos * 100) + ' % du range ' + P(s.range.low) + ' – ' + P(s.range.high) + ')');
    v += '.';
    if (htf.length) v += ' ' + esc('Unités supérieures : ' + htf.map(h => h.tf + ' ' + dirWord(Math.sign(h.s.trend || h.s.score))).join(', ') + (htfDir && bias ? (htfDir === bias ? ', alignées avec ce biais.' : ', en sens contraire : prudence.') : '.'));
    p(v);

    // 2. Structure de marché
    h3('Structure de marché');
    const pts = swingPoints(s);
    const phase = !ev ? 'Consolidation' : ev.type === 'CHoCH' ? 'Retournement (CHoCH ' + (ev.dir > 0 ? 'haussier' : 'baissier') + ')' : 'Continuation (BOS ' + (ev.dir > 0 ? 'haussier' : 'baissier') + ' confirmé)';
    table(['Élément', 'Lecture'], [
      ['Biais', esc(dirWord(bias))],
      ['Phase', esc(phase)],
      ['Tendance', esc(trendName(pts))],
      ['Dernier événement', ev ? esc(ev.type + (ev.dir > 0 ? ' ↑ ' : ' ↓ ') + P(ev.price) + ' · ' + ctx.when(ev.time)) : '—'],
    ]);
    if (pts.length) p('<b>Points clés.</b> ' + esc(pts.map(x => x.name + ' ' + P(x.price)).join(' → ')));

    // 3. Liquidité
    h3('Analyse de liquidité');
    const above = [], below = [];
    for (const l of s.liquidity.filter(l => !l.taken)) (l.level > last ? above : below).push({ level: l.level, name: l.type, imp: 5 });
    for (const x of s.swings.highs.slice(-6)) if (x.price > last && !above.some(a => Math.abs(a.level - x.price) / x.price < 0.0005)) above.push({ level: x.price, name: 'sommet', imp: 3 });
    for (const x of s.swings.lows.slice(-6)) if (x.price < last && !below.some(a => Math.abs(a.level - x.price) / x.price < 0.0005)) below.push({ level: x.price, name: 'creux', imp: 3 });
    const psy = roundLevel(last);
    if (Math.abs(psy - last) / last > 0.0003) (psy > last ? above : below).push({ level: psy, name: 'psychologique', imp: 4 });
    above.sort((a, b) => a.level - b.level); below.sort((a, b) => b.level - a.level);
    p('<b>BSL (liquidité au-dessus).</b> ' + (above.length ? esc(above.slice(0, 3).map(l => P(l.level) + ' (' + l.name + ')').join(', ')) : 'aucune visible.'));
    p('<b>SSL (liquidité en dessous).</b> ' + (below.length ? esc(below.slice(0, 3).map(l => P(l.level) + ' (' + l.name + ')').join(', ')) : 'aucune visible.'));
    const sw = s.sweeps[s.sweeps.length - 1];
    if (sw) p('<b>Dernier balayage.</b> ' + esc((sw.dir > 0 ? 'SSL prise sous ' : 'BSL prise au-dessus de ') + P(sw.level) + ' · ' + ctx.when(sw.time) + (sw.dir > 0 ? ' : signe d\'achat institutionnel.' : ' : signe de vente institutionnelle.')));

    // 4. Points d'intérêt
    h3('Points d\'intérêt');
    const zs = ctx.zones(f, 6);
    const supply = zs.filter(o => o.dir < 0), demand = zs.filter(o => o.dir > 0);
    const zl = o => P(o.bottom) + ' – ' + P(o.top) + ' ' + stars(o.stars || 1);
    const force = n => n >= 5 ? 'Très fort' : n >= 4 ? 'Fort' : n >= 3 ? 'Moyen' : 'Faible';
    const obRows = supply.slice(0, 3).concat(demand.slice(0, 3)).sort((a, b) => b.top - a.top)
      .map(o => [o.dir < 0 ? 'Offre (supply)' : 'Demande (demand)', esc(zl(o).replace(/ [★☆]+$/, '')), stars(o.stars || 1) + ' ' + force(o.stars || 1) + (o.status === 'touché' || o.status === 'mitigé' ? ' · déjà touchée' : '')]);
    if (obRows.length) table(['Order block', 'Zone', 'Force'], obRows); else p('Aucun order block valide près du prix.');
    // Breaker block : un order block cassé change de camp (ancien support devenu résistance, et inversement).
    const brk = s.orderBlocks.filter(o => o.status === 'invalidé' && o.top - o.bottom <= (s.atr || Infinity) * 3)
      .sort((a, b) => Math.abs((a.top + a.bottom) / 2 - last) - Math.abs((b.top + b.bottom) / 2 - last))[0];
    if (brk) { const res = (brk.top + brk.bottom) / 2 > last; p('<b>Breaker block.</b> ' + esc(P(brk.bottom) + ' – ' + P(brk.top) + ' : ancienne zone ' + (brk.dir > 0 ? 'd\'achat' : 'de vente') + ' cassée, elle agit maintenant comme ' + (res ? 'résistance (zone de vente au retour).' : 'support (zone d\'achat au retour).'))); }
    const gaps = s.fvgs.filter(g => !g.filled).sort((a, b) => Math.abs((a.top + a.bottom) / 2 - last) - Math.abs((b.top + b.bottom) / 2 - last)).slice(0, 2);
    if (gaps.length) p('<b>FVG non comblés.</b> ' + esc(gaps.map(g => (g.dir > 0 ? 'haussier ' : 'baissier ') + P(g.bottom) + ' – ' + P(g.top)).join(' ; ')));

    // 5. Scénarios
    const pl = ctx.plan && ctx.plan.status !== 'wait' ? ctx.plan : null;
    const mainDir = pl ? pl.dir : bias || htfDir || 1;
    let prob = 55;
    if (htfDir === mainDir) prob += 10;
    if (ctx.cotBias != null && Math.sign(ctx.cotBias) === mainDir) prob += 5;
    if (sw && sw.dir === mainDir) prob += 5;
    if (pl && pl.confluence >= 60) prob += 5;
    prob = Math.min(80, prob);
    const buy = mainDir > 0;
    const targets = (buy ? above : below).slice(0, 2);
    const poi = (buy ? demand : supply)[0];
    h3('Scénario principal · ' + (buy ? 'haussier' : 'baissier') + ' (' + prob + ' %)');
    const trig = pl ? (pl.atMarket ? 'prix déjà dans l\'OB ' + pl.tf + ' ' + P(pl.ob.bottom) + ' – ' + P(pl.ob.top) + ' : chercher une confirmation (CHoCH en petite unité)' : 'retour dans l\'OB ' + pl.tf + ' ' + P(pl.ob.bottom) + ' – ' + P(pl.ob.top))
      : poi ? 'réaction dans la zone ' + P(poi.bottom) + ' – ' + P(poi.top) + ' puis CHoCH en petite unité' : 'cassure de structure (BOS) ' + (buy ? 'au-dessus du dernier sommet' : 'sous le dernier creux');
    const tgt = pl && pl.tp1 ? [pl.tp1.price].concat(pl.tp2 && pl.tp2 !== pl.tp1 ? [pl.tp2.price] : []) : targets.map(t => t.level);
    const inv = pl ? (buy ? pl.ob.bottom : pl.ob.top) : poi ? (buy ? poi.bottom : poi.top) : null;
    const path = ['Prix actuel ' + P(last), trig.charAt(0).toUpperCase() + trig.slice(1), (buy ? 'Rejet haussier' : 'Rejet baissier') + ' et confirmation'].concat(tgt.map((t, k) => 'Cible ' + (k + 1) + ' : ' + P(t)));
    out.push('<ol class="path">' + path.map(x => '<li>' + esc(x) + '</li>').join('') + '</ol>');
    out.push('<ul class="scen">' + (inv != null ? '<li><b>Invalidation :</b> ' + esc('clôture ' + (pl ? pl.tf : ctx.tf) + ' ' + (buy ? 'sous ' : 'au-dessus de ') + P(inv)) + '</li>' : '')
      + '<li><b>Logique :</b> ' + esc('structure ' + (bias > 0 ? 'haussière' : bias < 0 ? 'baissière' : 'neutre') + (ev ? ', dernier ' + ev.type + (ev.dir > 0 ? ' haussier' : ' baissier') : '') + (sw ? ', ' + (sw.dir > 0 ? 'SSL' : 'BSL') + ' balayée' : '') + (htfDir === mainDir ? ', unités supérieures dans le même sens' : '') + '.') + '</li></ul>');
    const altT = (buy ? below : above).find(l => inv == null || (buy ? l.level < inv : l.level > inv));
    h3('Scénario alternatif · ' + (buy ? 'baissier' : 'haussier') + ' (' + (100 - prob) + ' %)');
    const altPath = [(inv != null ? 'Clôture ' + (buy ? 'sous ' : 'au-dessus de ') + P(inv) : 'Cassure dans l\'autre sens'), 'CHoCH ' + (buy ? 'baissier' : 'haussier') + ' en ' + ctx.tf].concat(altT ? ['Retour vers ' + P(altT.level) + ' (' + altT.name + ')'] : []);
    out.push('<ol class="path">' + altPath.map(x => '<li>' + esc(x) + '</li>').join('') + '</ol>');
    p(esc('Si ' + (inv != null ? 'le prix clôture ' + (buy ? 'sous ' : 'au-dessus de ') + P(inv) : 'la structure casse dans l\'autre sens') + ', le marché peut aller chercher ' + (altT ? 'la liquidité à ' + P(altT.level) + ' (' + altT.name + ')' : 'le prochain niveau ' + (buy ? 'en dessous' : 'au-dessus')) + '. On ne force pas : on attend une nouvelle structure.'));

    // 6. Niveaux à surveiller
    h3('Niveaux à surveiller');
    const lv = above.slice(0, 3).map(l => [l.level, (l.name === 'sommet' ? 'Sommet' : l.name) + ' · BSL', l.imp])
      .concat(below.slice(0, 3).map(l => [l.level, (l.name === 'creux' ? 'Creux' : l.name) + ' · SSL', l.imp]))
      .concat(zs.slice(0, 3).map(o => [(o.top + o.bottom) / 2, (o.dir > 0 ? 'Demande' : 'Offre') + ' (OB)', o.stars || 1]));
    if (brk) lv.push([(brk.top + brk.bottom) / 2, 'Breaker block', 4]);
    lv.push([last, 'Prix actuel', 0]);
    lv.sort((a, b) => b[0] - a[0]);
    table(['Niveau', 'Type', 'Rôle', 'Importance'], lv.map(r => [esc(P(r[0])), r[2] ? esc(r[1]) : '<b>' + esc(r[1]) + '</b>', r[2] ? (r[0] > last ? 'Résistance' : 'Support') : '—', r[2] ? stars(r[2]) : '—']));
    if (inv != null) p('<b>Invalidation du scénario ' + (buy ? 'haussier' : 'baissier') + ' :</b> ' + esc('clôture ' + (pl ? pl.tf : ctx.tf) + ' ' + (buy ? 'sous ' : 'au-dessus de ') + P(inv) + ' avec élan.'));

    // 7. Conclusion
    let conf = 5;
    if (htfDir && htfDir === mainDir) conf++;
    if (ctx.cotBias != null && Math.sign(ctx.cotBias) === mainDir) conf++;
    if (pl && pl.confluence >= 60) conf++;
    if (sw && sw.dir === mainDir) conf++;
    if (htfDir && htfDir !== mainDir) conf--;
    if (ctx.tf === '5m') conf--;
    conf = Math.max(3, Math.min(9, conf));
    h3('Conclusion');
    p(esc('Biais ' + (buy ? 'haussier' : 'baissier') + ' tant que ' + (inv != null ? P(inv) + ' tient' : 'la structure tient') + '. ' + (pl ? 'Plan K2K : ' + (buy ? 'achat' : 'vente') + ' à ' + P(pl.entry) + ', stop ' + P(pl.stop) + '.' : 'Pas d\'entrée propre pour l\'instant : patience.')) + ' <b>Confiance globale : ' + conf + '/10</b>' + esc(' (' + [htfDir === mainDir ? 'unités supérieures alignées' : 'unités supérieures pas alignées', ctx.cotBias != null ? (Math.sign(ctx.cotBias) === mainDir ? 'COT d\'accord' : 'COT pas d\'accord') : 'pas de COT', ctx.tf === '5m' ? 'unité courte' : null].filter(Boolean).join(', ') + ').'));
    return out.join('');
  }

  // Version texte du rapport, pour l'envoyer à Claude.
  function text(html) { return html.replace(/<\/(h3|p|li|tr)>/g, '\n').replace(/<\/td>/g, ' | ').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\n{2,}/g, '\n').trim(); }

  const api = { build, text };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Analysis = api;
})(typeof self !== 'undefined' ? self : this);
