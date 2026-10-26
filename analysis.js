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
    const buy = mainDir > 0;
    const targets = (buy ? above : below).slice(0, 2);
    const poi = (buy ? demand : supply)[0];
    const trig = pl ? (pl.atMarket ? 'prix déjà dans l\'OB ' + pl.tf + ' ' + P(pl.ob.bottom) + ' – ' + P(pl.ob.top) + ' : chercher une confirmation (CHoCH en petite unité)' : 'retour dans l\'OB ' + pl.tf + ' ' + P(pl.ob.bottom) + ' – ' + P(pl.ob.top))
      : poi ? 'réaction dans la zone ' + P(poi.bottom) + ' – ' + P(poi.top) + ' puis CHoCH en petite unité' : 'cassure de structure (BOS) ' + (buy ? 'au-dessus du dernier sommet' : 'sous le dernier creux');
    const tgt = pl && pl.tp1 ? [pl.tp1.price].concat(pl.tp2 && pl.tp2 !== pl.tp1 ? [pl.tp2.price] : []) : targets.map(t => t.level);
    const inv = pl ? (buy ? pl.ob.bottom : pl.ob.top) : poi ? (buy ? poi.bottom : poi.top) : null;
    // Probabilité mesurée : sur l'historique réel de cette unité, retours dans un order block du même sens
    // (avec ou contre la structure), cible au même ratio gain / risque, touchée avant la clôture d'invalidation.
    const st = ctx.stats, MIN = (root.Stats && root.Stats.MIN_CASES) || 30;
    const entryLvl = pl ? pl.entry : poi ? (buy ? poi.top : poi.bottom) : null;
    const R = tgt.length && inv != null && entryLvl != null && entryLvl !== inv ? Math.min(10, Math.max(0.3, Math.abs(tgt[0] - entryLvl) / Math.abs(entryLvl - inv))) : null;
    // Cas précis : même situation ET même sens du 4h qu'aujourd'hui. Affiché dès qu'il a assez de cas.
    const f4 = ctx.tf !== '4h' && ctx.frames['4h'] ? ctx.frames['4h'].smc : null;
    const dir4 = f4 ? Math.sign(f4.trend || f4.score) : 0;
    const mAll = st && R ? st.scenario(mainDir, bias === mainDir, R) : null;
    const mHtf = st && R && st.hasHtf && dir4 ? st.scenario(mainDir, bias === mainDir, R, dir4) : null;
    const precise = !!(mHtf && mHtf.pct != null);
    const m = precise ? mHtf : mAll;
    const w4 = dir4 ? ', avec le 4h ' + (dir4 > 0 ? 'haussier' : 'baissier') : '';
    const tag = v => st === undefined ? 'mesure en cours…' : !st || !m ? 'non mesurable' : m.pct == null ? 'pas assez de données' : v + ' % mesuré';
    h3('Scénario principal · ' + (buy ? 'haussier' : 'baissier') + ' (' + tag(m && m.pct) + ')');
    const num = (v, d) => v.toFixed(d).replace('.', ',');
    if (st && m) p('<span class="source">' + esc(m.pct == null
      ? 'Seulement ' + m.n + ' cas comparables dans l\'historique ' + ctx.tf + ' (il en faut ' + MIN + ') : pas de chiffre plutôt qu\'un chiffre inventé.'
      : 'Sur les ' + m.n + ' dernières fois où le prix est revenu dans un order block ' + (buy ? 'haussier' : 'baissier') + ' en ' + ctx.tf + (bias === mainDir ? ' dans le sens de la structure' : ' contre la structure') + (precise ? w4 : '') + ', la cible 1 (à ' + num(R, 1) + ' fois le risque) a été touchée avant l\'invalidation dans ' + m.pct + ' % des cas, et l\'invalidation dans ' + (100 - m.pct) + ' %. Historique réel depuis le ' + new Date(st.from * 1000).toLocaleDateString('fr-FR') + '.'
        + (precise && mAll && mAll.pct != null ? ' Tous cas confondus (sans regarder le 4h) : ' + mAll.pct + ' % sur ' + mAll.n + ' cas.' : '')
        + (!precise && mHtf ? ' Cas précis' + w4 + ' : seulement ' + mHtf.n + ' cas, pas assez pour un chiffre ; chiffre général affiché.' : '')) + '</span>');
    // Seuil de rentabilité, avantage moyen et marge d'erreur : pour lire correctement le pourcentage.
    // Le spread est payé à chaque trade : il réduit le gain et augmente la perte, donc il remonte le seuil.
    const cost = R && ctx.spread > 0 ? ctx.spread / Math.abs(entryLvl - inv) : 0;
    const beRaw = R ? 100 * (1 + cost) / (1 + R) : null;
    if (st && m && m.pct != null) {
      const be = Math.round(beRaw), q = m.w / m.n, ev = q * (R - cost) - (1 - q) * (1 + cost);
      p('<b>Lecture du ' + m.pct + ' %.</b> ' + esc('Avec une cible à ' + num(R, 1) + ' fois le risque' + (cost ? ' et un spread de ' + P(ctx.spread) + ' (' + num(cost, 2) + ' R par trade)' : ', sans spread renseigné') + ', il faut gagner ' + be + ' % des fois pour être à zéro (seuil de rentabilité). Résultat moyen mesuré' + (cost ? ', spread déduit' : '') + ' : ' + (ev >= 0 ? '+' : '') + num(ev, 2) + ' R par trade. Marge d\'erreur avec ' + m.n + ' cas : la vraie valeur est entre ' + m.lo + ' % et ' + m.hi + ' %. ')
        + '<b>' + esc(m.lo > be ? 'Avantage probable : même le bas de la marge est au-dessus du seuil.' : m.hi < be ? 'Désavantage : même le haut de la marge est sous le seuil.' : 'Avantage pas encore prouvé : la marge passe sous le seuil de rentabilité.') + '</b>');
    }
    const path = ['Prix actuel ' + P(last), trig.charAt(0).toUpperCase() + trig.slice(1), (buy ? 'Rejet haussier' : 'Rejet baissier') + ' et confirmation'].concat(tgt.map((t, k) => 'Cible ' + (k + 1) + ' : ' + P(t)));
    out.push('<ol class="path">' + path.map(x => '<li>' + esc(x) + '</li>').join('') + '</ol>');
    out.push('<ul class="scen">' + (inv != null ? '<li><b>Invalidation :</b> ' + esc('clôture ' + (pl ? pl.tf : ctx.tf) + ' ' + (buy ? 'sous ' : 'au-dessus de ') + P(inv)) + '</li>' : '')
      + '<li><b>Logique :</b> ' + esc('structure ' + (bias > 0 ? 'haussière' : bias < 0 ? 'baissière' : 'neutre') + (ev ? ', dernier ' + ev.type + (ev.dir > 0 ? ' haussier' : ' baissier') : '') + (sw ? ', ' + (sw.dir > 0 ? 'SSL' : 'BSL') + ' balayée' : '') + (htfDir === mainDir ? ', unités supérieures dans le même sens' : '') + '.') + '</li></ul>');
    // Cible du scénario alternatif : premier niveau à au moins une bougie moyenne au-delà de l'invalidation.
    const altT = (buy ? below : above).find(l => inv == null || (buy ? l.level < inv - (s.atr || 0) : l.level > inv + (s.atr || 0)));
    // Scénario alternatif mesuré à part : après une clôture d'invalidation, la cible opposée est-elle atteinte
    // avant que le prix ne reclôture dans la zone ?
    const h = entryLvl != null && inv != null ? Math.abs(entryLvl - inv) : 0;
    const Ralt = altT && h ? Math.min(10, Math.max(0.5, Math.abs(altT.level - inv) / h)) : null;
    const ma = st && R && Ralt ? st.alternative(mainDir, bias === mainDir, R, Ralt, precise ? dir4 : null) : null;
    const tagAlt = st === undefined ? 'mesure en cours…' : !st || !ma ? 'non mesurable' : ma.pct == null ? 'pas assez de données' : ma.pct + ' % mesuré après invalidation';
    h3('Scénario alternatif · ' + (buy ? 'baissier' : 'haussier') + ' (' + tagAlt + ')');
    const altPath = [(inv != null ? 'Clôture ' + (buy ? 'sous ' : 'au-dessus de ') + P(inv) : 'Cassure dans l\'autre sens'), 'CHoCH ' + (buy ? 'baissier' : 'haussier') + ' en ' + ctx.tf].concat(altT ? ['Retour vers ' + P(altT.level) + ' (' + altT.name + ')'] : []);
    if (st && ma) p('<span class="source">' + esc(ma.pct == null
      ? 'Seulement ' + ma.n + ' invalidations comparables dans l\'historique (il en faut ' + MIN + ') : pas de chiffre.'
      : 'Mesuré à part : sur ' + ma.n + ' invalidations passées, le prix a ensuite atteint la cible ' + (buy ? 'baissière' : 'haussière') + ' avant de revenir dans la zone dans ' + ma.pct + ' % des cas (marge ' + ma.lo + ' – ' + ma.hi + ' %).') + '</span>');
    out.push('<ol class="path">' + altPath.map(x => '<li>' + esc(x) + '</li>').join('') + '</ol>');
    p(esc('Si ' + (inv != null ? 'le prix clôture ' + (buy ? 'sous ' : 'au-dessus de ') + P(inv) : 'la structure casse dans l\'autre sens') + ', le marché peut aller chercher ' + (altT ? 'la liquidité à ' + P(altT.level) + ' (' + altT.name + ')' : 'le prochain niveau ' + (buy ? 'en dessous' : 'au-dessus')) + '. On ne force pas : on attend une nouvelle structure.'));

    // 6. Niveaux à surveiller
    h3('Niveaux à surveiller');
    const cat = l => (l.name === 'psychologique' ? 'psy' : 'swing');
    const lv = above.slice(0, 3).map(l => [l.level, (l.name === 'sommet' ? 'Sommet' : l.name) + ' · BSL', l.imp, cat(l)])
      .concat(below.slice(0, 3).map(l => [l.level, (l.name === 'creux' ? 'Creux' : l.name) + ' · SSL', l.imp, cat(l)]))
      .concat(zs.slice(0, 3).map(o => [(o.top + o.bottom) / 2, (o.dir > 0 ? 'Demande' : 'Offre') + ' (OB)', o.stars || 1, 'ob']));
    if (brk) lv.push([(brk.top + brk.bottom) / 2, 'Breaker block', 4, 'breaker']);
    lv.push([last, 'Prix actuel', 0]);
    lv.sort((a, b) => b[0] - a[0]);
    // Colonnes Baissière / Haussière mesurées : à chaque contact passé avec ce type de niveau (même côté du prix),
    // le prix est-il reparti d'une bougie moyenne dans le sens du rejet, ou a-t-il cassé le niveau ?
    // Entre 45 et 55 % : bruit, affiché en gris « neutre » sans étoiles. Le nombre de cas est toujours visible.
    const cell = (v, n, cls) => v >= 45 && v <= 55 ? '<span class="source">neutre ' + v + ' % · ' + n + ' cas</span>' : '<span class="' + cls + '">' + stars(Math.round(v / 20)) + ' ' + v + ' % · ' + n + ' cas</span>';
    const none = n => '<span class="source">pas assez (' + n + ' cas)</span>';
    table(['Niveau', 'Type', 'Rôle', 'Importance', 'Baissière', 'Haussière'], lv.map(r => {
      if (!r[2]) {
        const ok = m && m.pct != null, mc = ok ? '<span class="' + (buy ? 'odds-buy' : 'odds-sell') + '">cible 1 : ' + m.pct + ' % · ' + m.n + ' cas</span>' : '—';
        return [esc(P(r[0])), '<b>' + esc(r[1]) + '</b>', '—', '—', buy ? '—' : mc, buy ? mc : '—'];
      }
      const side = r[0] > last ? -1 : 1, q = st ? st.level(r[3], side) : null;
      const head = [esc(P(r[0])), esc(r[1]), side < 0 ? '<span class="role-sell">Vendre</span>' : '<span class="role-buy">Acheter</span>', stars(r[2])];
      if (!q) return head.concat(['…', '…']);
      if (q.pct == null) return head.concat([none(q.n), none(q.n)]);
      const sell = side < 0 ? q.pct : 100 - q.pct;
      return head.concat([cell(sell, q.n, 'odds-sell'), cell(100 - sell, q.n, 'odds-buy')]);
    }));
    p('<span class="source">' + esc(st === null ? 'Historique trop court ou indisponible : pas de probabilité affichée plutôt qu\'un chiffre inventé.' : st
      ? 'Baissière / Haussière : mesuré sur ' + st.bars + ' bougies réelles ' + ctx.tf + ' depuis le ' + new Date(st.from * 1000).toLocaleDateString('fr-FR') + '. Pour chaque type de niveau, on a compté les contacts passés : rejet (le prix repart d\'une bougie moyenne) ou cassure (pour une zone : clôture au-delà de l\'autre bord). Entre 45 et 55 % : neutre, l\'écart ne veut rien dire. Moins de ' + MIN + ' cas : pas de chiffre. Une statistique passée, pas une garantie.'
      : 'Mesure sur l\'historique réel en cours…') + '</span>');
    if (inv != null) p('<b>Invalidation du scénario ' + (buy ? 'haussier' : 'baissier') + ' :</b> ' + esc('clôture ' + (pl ? pl.tf : ctx.tf) + ' ' + (buy ? 'sous ' : 'au-dessus de ') + P(inv) + ' avec élan.'));

    // 7. Conclusion. Confiance calculée uniquement à partir des mesures :
    // avantage mesuré par rapport au seuil de rentabilité (4 pts), solidité de la mesure (2 pts),
    // marge d'erreur au-dessus du seuil (2 pts), alignement du 4h et du 1h avec le scénario (2 pts).
    h3('Conclusion');
    const concl = esc('Biais ' + (buy ? 'haussier' : 'baissier') + ' tant que ' + (inv != null ? P(inv) + ' tient' : 'la structure tient') + '. ' + (pl ? 'Plan K2K : ' + (buy ? 'achat' : 'vente') + ' à ' + P(pl.entry) + ', stop ' + P(pl.stop) + '.' : 'Pas d\'entrée propre pour l\'instant : patience.'));
    // Pas de note quand K2K dit lui-même « pas de setup » ou « prudence » : sinon le chiffre contredit l'analyse.
    const noNote = !pl ? 'pas de setup' : ctx.disagree ? 'désaccord entre institutions et graphique, prudence' : dir4 && dir4 !== mainDir ? 'le 4h est ' + (dir4 > 0 ? 'haussier' : 'baissier') + ', contre ce scénario : prudence' : null;
    if (noNote) {
      p(concl + ' <b>Confiance globale : pas de note</b>' + esc(' (' + noNote + '. ' + (m && m.pct != null ? 'La mesure ci-dessus reste une information, pas un signal d\'entrée.' : '') + ')').replace(' )', ')').replace('. )', '.)'));
    } else if (m && m.pct != null) {
      const be = beRaw;
      const edge = 2 + 2 * Math.max(-1, Math.min(1, (m.pct - be) / 20));
      const size = m.n >= 100 ? 2 : m.n >= 50 ? 1.5 : 1;
      const sure = m.lo > be ? 2 : m.pct > be ? 1 : 0;
      const al = ['4h', '1h'].filter(t => ctx.frames[t] && Math.sign(ctx.frames[t].smc.trend || ctx.frames[t].smc.score) === mainDir).length;
      const conf = Math.max(0, Math.min(10, Math.round(edge + size + sure + al)));
      const pts = v => num(v, 1).replace(',0', '');
      p(concl + ' <b>Confiance globale : ' + conf + '/10</b>' + esc(' (calculée : avantage mesuré ' + pts(edge) + '/4, nombre de cas ' + pts(size) + '/2, marge d\'erreur ' + sure + '/2, alignement 4h et 1h ' + al + '/2).'));
    } else {
      p(concl + ' <b>Confiance globale : non mesurable</b>' + esc(' (pas assez de cas mesurés pour ce scénario : pas de note plutôt qu\'une note inventée).'));
    }
    return out.join('');
  }

  // Version texte du rapport, pour l'envoyer à Claude.
  function text(html) { return html.replace(/<\/(h3|p|li|tr)>/g, '\n').replace(/<\/td>/g, ' | ').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\n{2,}/g, '\n').trim(); }

  const api = { build, text };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Analysis = api;
})(typeof self !== 'undefined' ? self : this);
