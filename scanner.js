// K2K : écran d'accueil façon « OB Scanner ». Scanne tout l'univers sur une unité, une carte par marché,
// bougies en direct, et « Agrandir » ouvre la fiche complète (multi-unités, plan de trade, COT).
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const CANDLES = { upColor: '#3fbf4f', downColor: '#111111', borderUpColor: '#111111', borderDownColor: '#111111', wickUpColor: '#111111', wickDownColor: '#111111' };
  const NO_FEED = {
    NQ100: 'NQ100 (actions du Nasdaq) : pas de flux de prix gratuit. Ouvre NAS100 dans « Indices » pour importer un fichier MT5 ou TradingView.',
    'Énergie': 'Énergie (pétrole, gaz) : pas de flux de prix gratuit pour le moment.',
  };
  const UNIT_TF = { '5m': '5m', '15m': '15m', '1h': '1h', '4h': '4h', '1d': '4h', '1w': '4h' };
  const store = {
    get(k, d) { try { return localStorage.getItem('k2k.home.' + k) || d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('k2k.home.' + k, v); } catch (e) { /* stockage indisponible */ } },
  };
  const ui = {
    unit: store.get('unit', '1h'),
    cls: new Set(store.get('cls', '').split(',').filter(Boolean)),
    sort: store.get('sort', 'near'),
    layout: store.get('layout', 'grid'),
    mode: 'scan',
    q: '',
  };
  const results = {}; // sym -> { f: { candles, smc }, err }
  let scanning = false, scannedUnit = null, scannedAt = null;

  function price(p) {
    const d = p >= 1000 ? 2 : p >= 10 ? 3 : 5;
    return p.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  const pct = d => (d * 100).toFixed(2).replace('.', ',') + ' %';

  // ---------- Filtres ----------
  function bindChips(id, isOn, onClick) {
    const box = $(id);
    const sync = () => box.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(isOn(b.dataset.v))));
    box.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { onClick(b.dataset.v); sync(); }));
    sync();
  }
  bindChips('f-unit', v => v === ui.unit, v => { ui.unit = v; store.set('unit', v); scan(); });
  bindChips('f-cls', v => ui.cls.has(v), v => { if (ui.cls.has(v)) ui.cls.delete(v); else ui.cls.add(v); store.set('cls', [...ui.cls].join(',')); render(); });
  bindChips('f-stars', v => +v === Zones.minStars, v => { Zones.setMinStars(+v); render(); });
  bindChips('f-sort', v => v === ui.sort, v => { ui.sort = v; store.set('sort', v); render(); });
  bindChips('f-layout', v => v === ui.layout, v => { ui.layout = v; store.set('layout', v); render(); });
  $('f-search').addEventListener('input', e => { ui.q = e.target.value.trim().toUpperCase(); render(); });
  document.querySelectorAll('.modes button').forEach(b => b.addEventListener('click', () => {
    ui.mode = b.dataset.mode;
    document.querySelectorAll('.modes button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    if (location.hash) location.hash = ''; else render();
  }));

  // ---------- Scan ----------
  async function scan(silent) {
    if (scanning) return;
    scanning = true;
    const unit = ui.unit;
    const btn = $('scan-btn');
    btn.classList.add('busy'); btn.disabled = true;
    if (!silent) $('scan-btn-text').textContent = 'Scan en cours…';
    const list = Prices.UNIVERSE.filter(m => !m.fileOnly);
    const got = await Promise.allSettled(list.map(m => Prices.fetchLive(m.sym, unit, 300)));
    got.forEach((r, i) => {
      const sym = list[i].sym;
      if (r.status === 'fulfilled' && r.value && r.value.length) {
        const smc = SMC.analyze(r.value);
        results[sym] = smc ? { f: { candles: r.value, smc } } : { err: 'pas assez de bougies' };
      } else results[sym] = { err: r.reason ? r.reason.message : 'indisponible' };
    });
    scanning = false; scannedUnit = unit; scannedAt = new Date();
    btn.classList.remove('busy'); btn.disabled = false;
    $('scan-btn-text').textContent = 'Relancer le scan';
    if (unit !== ui.unit) return scan(); // l'unité a changé pendant le scan
    render();
    connect();
  }
  $('scan-btn').addEventListener('click', () => scan());

  // ---------- Sélection des zones selon l'onglet ----------
  const touches = (k, o) => k.low <= o.top && k.high >= o.bottom;
  function zonesFor(f) {
    const all = Zones.nearest(f, 4);
    if (ui.mode === 'scan') return all;
    const c = f.candles, n = c.length, atr = f.smc.atr || 0, last = c[n - 1].close;
    if (ui.mode === 'touched') return all.filter(o => c.slice(-3).some(k => touches(k, o))).map(o => ({ ...o, hl: 'touched' }));
    // Réaction : zone touchée sur les 12 dernières bougies, puis le prix repart dans son sens d'au moins une demi-ATR.
    return all.filter(o => c.slice(-12, -1).some(k => touches(k, o)) && (o.dir > 0 ? last > o.top + atr * 0.5 : last < o.bottom - atr * 0.5)).map(o => ({ ...o, hl: 'reaction' }));
  }

  // ---------- Cartes ----------
  const cardCharts = [];
  const liveCards = {}; // sym -> { se, f, zones, distEl }
  function clearCharts() {
    for (const k in liveCards) delete liveCards[k];
    while (cardCharts.length) { const e = cardCharts.pop(); e.dead = true; if (e.ro) e.ro.disconnect(); e.ch.remove(); }
  }

  function render() {
    const box = $('cards');
    clearCharts();
    box.textContent = '';
    box.className = 'cards ' + ui.layout;
    const sel = ui.cls;
    const pick = m => (!sel.size || sel.has(m.cls)) && (!ui.q || m.sym.includes(ui.q) || m.name.toUpperCase().includes(ui.q));
    const items = [];
    for (const m of Prices.UNIVERSE.filter(pick)) {
      if (m.fileOnly) { if (ui.mode === 'scan') items.push({ m, file: true, near: Infinity, count: 0, recent: 0 }); continue; }
      const r = results[m.sym];
      if (!r || !r.f) continue;
      const z = zonesFor(r.f);
      if (!z.length && (ui.mode !== 'scan' || Zones.minStars > 1)) continue;
      // Note de la carte : meilleure zone (qualité de l'order block, moins un malus si elle est loin du prix).
      const grade = z.length ? Math.max(...z.map(o => Math.round(Math.max(0, o.quality - o.dist * 1000)))) : 0;
      items.push({ m, f: r.f, z, grade, near: z.length ? z[0].dist : Infinity, count: z.length, recent: z.length ? Math.max(...z.map(o => o.time)) : 0 });
    }
    const by = { near: (a, b) => a.near - b.near, count: (a, b) => b.count - a.count || a.near - b.near, recent: (a, b) => b.recent - a.recent, grade: (a, b) => b.grade - a.grade };
    items.sort((a, b) => (a.file - b.file) || by[ui.sort](a, b));
    for (const it of items) box.appendChild(it.file ? fileCard(it.m) : card(it));

    // Classes sans flux gratuit et messages vides, dits franchement.
    for (const c of sel) if (NO_FEED[c]) box.appendChild(note(NO_FEED[c]));
    if ((!sel.size || sel.has('Forex')) && results.EURUSD && results.EURUSD.err) box.appendChild(note('Forex : l\'euro (EUR/USDT sur Binance) n\'a pas répondu. Les autres paires Forex n\'ont pas de flux gratuit.'));
    if (!items.some(i => !i.file)) {
      const msg = scanning || !scannedAt ? 'Scan en cours…'
        : ui.mode === 'scan' && Zones.minStars > 1 && !items.some(i => i.count) ? 'Aucun order block ' + Zones.minStars + ' étoiles en ' + label(ui.unit) + ' pour le moment. Essaie « 4★ et + » ou une autre unité.'
        : ui.mode === 'touched' ? 'Aucun order block touché sur les 3 dernières bougies ' + label(ui.unit) + '.'
        : ui.mode === 'reaction' ? 'Aucune réaction nette sur un order block en ' + label(ui.unit) + ' pour le moment.'
        : 'Aucun marché ne correspond à ta recherche.';
      if (!(sel.size && [...sel].every(c => NO_FEED[c]))) box.prepend(note(msg));
    }
    const n = Object.values(results).filter(r => r.f).length;
    $('scan-note').textContent = scannedAt
      ? n + ' marchés analysés en ' + label(scannedUnit) + ' · mis à jour à ' + scannedAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
      : 'Analyse des Order Blocks sur tout l\'univers';
  }
  const label = u => ({ '1d': 'Daily', '1w': 'Weekly' }[u] || u);

  function note(text) { const p = document.createElement('p'); p.className = 'cards-note'; p.textContent = text; return p; }

  function badge(cls, text) { const s = document.createElement('span'); s.className = 'badge ' + cls; s.textContent = text; return s; }

  function card(it) {
    const { m, f, z } = it;
    const el = document.createElement('article');
    el.className = 'card';
    el.innerHTML = '<div class="card-chart"><div class="cc"></div><canvas class="scan-zones" aria-hidden="true"></canvas><button class="grow" type="button">Agrandir ⤢</button><a class="tv tv-mini" target="_blank" rel="noopener">TradingView ↗</a></div><div class="card-foot"></div>';
    const foot = el.querySelector('.card-foot');
    const sym = document.createElement('b'); sym.className = 'sym'; sym.textContent = m.sym; foot.appendChild(sym);
    foot.appendChild(badge('tf', label(scannedUnit)));
    if (z.some(o => o.dir > 0)) foot.appendChild(badge('buy', 'ACHAT'));
    if (z.some(o => o.dir < 0)) foot.appendChild(badge('sell', 'VENTE'));
    const dist = badge('dist', '');
    if (z.length) foot.appendChild(dist);
    const cls = document.createElement('span'); cls.className = 'cls'; cls.textContent = m.cls; foot.appendChild(cls);
    el.querySelector('.tv-mini').href = Prices.tvUrl(m.sym, scannedUnit);
    const open = () => { location.hash = '#/' + m.sym + '/' + UNIT_TF[scannedUnit]; };
    el.querySelector('.grow').addEventListener('click', open);
    $('cards').appendChild(el); // le graphique a besoin d'être dans la page pour prendre sa taille

    const holder = el.querySelector('.card-chart'), cv = el.querySelector('.scan-zones');
    // L'échelle s'élargit seulement pour les zones proches : les bougies restent grandes et lisibles.
    const shown = f.candles.slice(-70), hi = Math.max(...shown.map(k => k.high)), lo = Math.min(...shown.map(k => k.low)), ext = (hi - lo) * 0.5;
    const levels = z.flatMap(o => [o.top, o.bottom]).filter(v => v >= lo - ext && v <= hi + ext);
    const ch = LightweightCharts.createChart(el.querySelector('.cc'), {
      autoSize: true, localization: { locale: 'fr-FR', priceFormatter: Zones.fmtPrice },
      layout: { background: { color: '#ffffff' }, textColor: '#131722', fontFamily: "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif", fontSize: 10 },
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.08 } },
      timeScale: { borderVisible: false, timeVisible: scannedUnit !== '1d' && scannedUnit !== '1w', rightOffset: 3, barSpacing: 5 },
      handleScroll: false, handleScale: false, crosshair: { mode: 2 },
    });
    const entry = { ch, dead: false };
    cardCharts.push(entry);
    // Échelle élargie pour que les zones proches restent visibles, comme sur le scanner de référence.
    const se = ch.addCandlestickSeries({
      ...CANDLES, priceLineVisible: true, priceLineStyle: 2, priceLineColor: '#3fbf4f', lastValueVisible: true,
      autoscaleInfoProvider: orig => {
        const r = orig();
        if (r && levels.length) { r.priceRange.minValue = Math.min(r.priceRange.minValue, ...levels); r.priceRange.maxValue = Math.max(r.priceRange.maxValue, ...levels); }
        return r;
      },
    });
    se.setData(f.candles.slice(-70).map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
    const redraw = () => requestAnimationFrame(() => { if (!entry.dead) Zones.draw(cv, holder, ch, se, z, {}); });
    ch.timeScale().subscribeVisibleTimeRangeChange(redraw);
    entry.ro = new ResizeObserver(redraw);
    entry.ro.observe(holder);
    ch.timeScale().fitContent();
    liveCards[m.sym] = { se, f, z, dist, redraw };
    setDist(liveCards[m.sym]);
    return el;
  }

  function setDist(lc) {
    if (!lc.z.length) return;
    const last = lc.f.candles[lc.f.candles.length - 1].close;
    let best = Infinity;
    for (const o of lc.z) best = Math.min(best, last <= o.top && last >= o.bottom ? 0 : Math.abs(o.level - last) / last);
    lc.dist.textContent = best === 0 ? 'dans la zone' : 'prix à ' + pct(best);
    lc.dist.classList.toggle('in', best === 0);
  }

  function fileCard(m) {
    const el = document.createElement('article');
    el.className = 'card file';
    el.innerHTML = '<div class="card-empty"><p></p><button class="btn" type="button">Ouvrir et importer un fichier</button></div><div class="card-foot"><b class="sym"></b><span class="cls"></span></div>';
    el.querySelector('p').textContent = m.name + ' : pas de flux de prix gratuit. Exporte tes bougies depuis MT5 ou TradingView et K2K trouve les order blocks.';
    el.querySelector('.sym').textContent = m.sym;
    el.querySelector('.cls').textContent = m.cls;
    el.querySelector('button').addEventListener('click', () => { location.hash = '#/' + m.sym + '/' + UNIT_TF[ui.unit]; });
    return el;
  }

  // ---------- Bougies en direct pour toutes les cartes (un seul flux Binance) ----------
  let ws = null, wsToken = 0;
  function disconnect() { wsToken++; if (ws) { ws.onclose = null; ws.close(); ws = null; } }
  function connect() {
    disconnect();
    if (!('WebSocket' in window) || !$('home').offsetParent && $('home').hidden) return;
    const token = wsToken;
    const pairs = Object.keys(results).filter(s => results[s].f && Prices.LIVE[s]);
    if (!pairs.length) return;
    const bySym = {};
    for (const s of pairs) bySym[Prices.LIVE[s]] = s;
    const streams = pairs.map(s => Prices.LIVE[s].toLowerCase() + '@kline_' + scannedUnit).join('/');
    const hosts = ['wss://stream.binance.com:9443', 'wss://data-stream.binance.vision'];
    let hi = 0;
    const open = () => {
      if (token !== wsToken) return;
      const sock = new WebSocket(hosts[hi] + '/stream?streams=' + streams);
      ws = sock;
      sock.onmessage = e => {
        if (token !== wsToken) return;
        const k = JSON.parse(e.data).data;
        if (!k || !k.k) return;
        const sym = bySym[k.s], r = results[sym];
        if (!r || !r.f || k.k.i !== scannedUnit) return;
        const b = k.k, bar = { time: Math.floor(b.t / 1000), open: +b.o, high: +b.h, low: +b.l, close: +b.c, volume: +b.v };
        const c = r.f.candles, last = c[c.length - 1];
        if (last && last.time === bar.time) c[c.length - 1] = bar;
        else if (!last || bar.time > last.time) c.push(bar);
        else return;
        const lc = liveCards[sym];
        if (!lc) return;
        try { lc.se.update({ time: bar.time, open: bar.open, high: bar.high, low: bar.low, close: bar.close }); } catch (err) { return; }
        setDist(lc);
        lc.redraw();
      };
      sock.onclose = () => { if (token !== wsToken) return; hi = (hi + 1) % hosts.length; setTimeout(open, 3000); };
    };
    open();
  }

  // Nouveau scan complet toutes les 2 minutes tant que l'accueil est affiché.
  setInterval(() => { if (!document.hidden && !$('home').hidden) scan(true); }, 120000);

  // ---------- Navigation : accueil ↔ fiche d'un marché ----------
  let fromHome = false;
  function route() {
    const m = location.hash.match(/^#\/([A-Z0-9]+)\/(\w+)$/);
    const known = m && Prices.UNIVERSE.some(u => u.sym === m[1]);
    $('home').hidden = !!known;
    $('detail').hidden = !known;
    document.querySelectorAll('.modes button').forEach(b => b.setAttribute('aria-pressed', String(!known && b.dataset.mode === ui.mode)));
    if (known) {
      disconnect();
      clearCharts();
      window.scrollTo(0, 0);
      K2K.open(m[1], m[2]);
    } else {
      K2K.close();
      if (scannedUnit === ui.unit && scannedAt) { render(); connect(); } else scan();
    }
  }
  window.addEventListener('hashchange', () => { if (location.hash) fromHome = true; route(); });
  $('back').addEventListener('click', () => { if (fromHome) history.back(); else location.hash = ''; });
  $('home-link').addEventListener('click', () => { ui.mode = 'scan'; if (location.hash) location.hash = ''; else render(); });

  // ---------- Claude ----------
  function homeSummary() {
    const lines = ['Scanner K2K en ' + label(scannedUnit || ui.unit) + ' : order blocks les plus proches du prix.'];
    for (const s of Object.keys(results)) {
      const r = results[s];
      if (!r.f) continue;
      const z = Zones.nearest(r.f, 3);
      const last = r.f.candles[r.f.candles.length - 1].close;
      lines.push(s + ' à ' + price(last) + ' : ' + (z.length ? z.map(o => (o.dir > 0 ? 'zone achat ' : 'zone vente ') + price(o.bottom) + '-' + price(o.top) + ' (' + pct(o.dist) + ')').join(' ; ') : 'aucune zone valide'));
    }
    lines.push('En tant qu\'analyste SMC, quel marché présente le meilleur setup maintenant, et pourquoi ?');
    return lines.join('\n');
  }
  $('ask-claude').addEventListener('click', () => Zones.askClaude($('detail').hidden ? homeSummary() : K2K.summary()));

  route();
})();
