// K2K : écran principal. Croise le biais COT (fond) et le biais SMC (timing) pour le marché choisi.
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const css = getComputedStyle(document.documentElement);
  const C = name => css.getPropertyValue(name).trim();
  const COL = { bull: C('--bull'), bear: C('--bear'), gold: C('--gold'), warn: C('--warn'), muted: C('--muted'), line: C('--line'), fg: C('--fg'), surface: C('--surface') };

  const state = { sym: 'XAUUSD', tf: '5m', candles: null, source: '', smc: null, cot: {}, imported: {} };
  const fmt = new Intl.NumberFormat('fr-FR');
  const store = {
    get(k) { try { return localStorage.getItem('k2k.' + k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem('k2k.' + k, v); } catch (e) { /* stockage indisponible */ } },
  };

  // ---------- Graphique ----------
  const chartEl = $('chart'), zones = $('zones');
  const chart = LightweightCharts.createChart(chartEl, {
    autoSize: true,
    localization: { locale: 'fr-FR' },
    layout: { background: { color: COL.surface }, textColor: COL.muted, fontFamily: 'IBM Plex Mono, monospace' },
    grid: { vertLines: { color: 'rgba(38,49,71,0.5)' }, horzLines: { color: 'rgba(38,49,71,0.5)' } },
    rightPriceScale: { borderColor: COL.line },
    timeScale: { borderColor: COL.line, timeVisible: true, secondsVisible: false },
    crosshair: { mode: 0 },
  });
  const candleSeries = chart.addCandlestickSeries({
    upColor: COL.bull, downColor: COL.bear, borderUpColor: COL.bull, borderDownColor: COL.bear, wickUpColor: COL.bull, wickDownColor: COL.bear,
  });

  function drawZones() {
    const r = chartEl.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    zones.width = r.width * dpr; zones.height = r.height * dpr;
    const ctx = zones.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, r.width, r.height);
    if (!state.smc || !state.candles) return;
    const ts = chart.timeScale();
    const plotW = r.width - candleSeries.priceScale().width();
    const box = (t, top, bottom, fill, stroke, dash) => {
      let x = ts.timeToCoordinate(t);
      const y1 = candleSeries.priceToCoordinate(top), y2 = candleSeries.priceToCoordinate(bottom);
      if (y1 == null || y2 == null) return;
      if (x == null) x = 0;
      if (x > plotW) return;
      ctx.fillStyle = fill; ctx.fillRect(x, y1, plotW - x, y2 - y1);
      ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.setLineDash(dash || []);
      ctx.strokeRect(x + 0.5, y1 + 0.5, plotW - x - 1, y2 - y1);
    };
    for (const f of state.smc.fvgs.filter(f => !f.filled).slice(-8)) box(f.time, f.top, f.bottom, 'rgba(217,180,90,0.13)', 'rgba(217,180,90,0.6)', [4, 3]);
    for (const o of state.smc.orderBlocks.filter(o => o.status !== 'invalidé').slice(-6)) {
      box(o.time, o.top, o.bottom, o.dir > 0 ? 'rgba(47,191,143,0.16)' : 'rgba(239,93,107,0.16)', o.dir > 0 ? COL.bull : COL.bear);
    }
  }
  chart.timeScale().subscribeVisibleTimeRangeChange(() => requestAnimationFrame(drawZones));
  new ResizeObserver(() => requestAnimationFrame(drawZones)).observe(chartEl);

  function renderChart() {
    const empty = $('chart-empty');
    if (!state.candles) {
      candleSeries.setData([]); candleSeries.setMarkers([]);
      drawZones();
      return;
    }
    empty.hidden = true;
    candleSeries.setData(state.candles.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
    const s = state.smc, markers = [];
    for (const e of s.events.slice(-12)) markers.push({ time: e.time, position: e.dir > 0 ? 'belowBar' : 'aboveBar', color: e.type === 'CHoCH' ? COL.gold : (e.dir > 0 ? COL.bull : COL.bear), shape: e.dir > 0 ? 'arrowUp' : 'arrowDown', text: e.type });
    for (const w of s.sweeps.slice(-8)) markers.push({ time: w.time, position: w.dir > 0 ? 'belowBar' : 'aboveBar', color: COL.warn, shape: 'circle', text: 'Liq' });
    markers.sort((a, b) => a.time - b.time);
    candleSeries.setMarkers(markers);
    chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, state.candles.length - 160), to: state.candles.length + 4 });
    requestAnimationFrame(drawZones);
  }

  // ---------- Empreintes ----------
  function renderEvents() {
    const list = $('events');
    list.textContent = '';
    if (!state.smc) { list.innerHTML = '<li><span class="dot"></span><div class="why">Pas encore de bougies pour ce marché.</div><span></span></li>'; return; }
    const s = state.smc, items = [];
    for (const e of s.events) items.push({ t: e.time, dir: e.dir, what: e.type + (e.dir > 0 ? ' haussier' : ' baissier'), why: (e.type === 'CHoCH' ? 'La tendance change de camp : clôture ' : 'La tendance continue : clôture ') + (e.dir > 0 ? 'au-dessus de ' : 'sous ') + price(e.price) });
    for (const o of s.orderBlocks) if (o.status !== 'invalidé') items.push({ t: o.time, dir: o.dir, what: 'Order block ' + (o.dir > 0 ? 'acheteur' : 'vendeur') + ' (' + o.status + ')', why: 'Zone ' + price(o.bottom) + ' – ' + price(o.top) + ' : dernière bougie opposée avant la cassure' });
    for (const w of s.sweeps) items.push({ t: w.time, dir: w.dir, what: 'Chasse de liquidité', why: (w.dir > 0 ? 'Mèche sous ' : 'Mèche au-dessus de ') + price(w.level) + ' puis retour : les stops ont été pris' });
    for (const v of s.volume) items.push({ t: v.time, dir: v.dir, what: 'Volume x' + v.ratio.toFixed(1), why: 'Bougie ' + (v.dir > 0 ? 'acheteuse' : 'vendeuse') + ' avec un volume anormal' });
    for (const f of s.fvgs.filter(f => !f.filled).slice(-2)) items.push({ t: f.time, dir: f.dir, what: 'FVG ' + (f.dir > 0 ? 'haussier' : 'baissier') + ' non comblé', why: 'Déséquilibre ' + price(f.bottom) + ' – ' + price(f.top) + ' : le prix revient souvent le combler' });
    items.sort((a, b) => b.t - a.t);
    for (const it of items.slice(0, 10)) {
      const li = document.createElement('li');
      li.className = it.dir > 0 ? 'bull' : 'bear';
      li.innerHTML = '<span class="dot"></span><div><div class="what"></div><div class="why"></div></div><time></time>';
      li.querySelector('.what').textContent = it.what;
      li.querySelector('.why').textContent = it.why;
      li.querySelector('time').textContent = when(it.t);
      list.appendChild(li);
    }
  }

  function price(p) {
    const d = p >= 1000 ? 2 : p >= 10 ? 3 : 5;
    return p.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function when(t) {
    return new Date(t * 1000).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  // ---------- COT ----------
  let cotChart = null;
  function renderCot() {
    const body = $('cot-body');
    const data = state.cot[state.sym];
    body.textContent = '';
    if (!data || data.error) {
      $('cot-date').textContent = '';
      body.innerHTML = '<tr><td colspan="5" class="' + (data && data.error ? 'error' : '') + '"></td></tr>';
      body.querySelector('td').textContent = data && data.error ? 'Rapport COT indisponible : ' + data.error : 'Chargement du rapport COT…';
      if (cotChart) { cotChart.remove(); cotChart = null; }
      return;
    }
    const sum = data.summary;
    $('cot-date').textContent = data.market.label + ' · rapport du ' + new Date(sum.date).toLocaleDateString('fr-FR');
    for (const g of sum.groups) {
      const tr = document.createElement('tr');
      const sign = n => (n > 0 ? '+' : '') + fmt.format(Math.round(n));
      tr.innerHTML = '<td></td><td class="num"></td><td class="num"></td><td class="num"></td><td><div class="idx"><div class="idx-track"><div class="idx-fill"></div></div><span class="num"></span></div></td>';
      const td = tr.querySelectorAll('td');
      td[0].textContent = g.name;
      td[1].textContent = sign(g.net); td[1].className = 'num ' + (g.net >= 0 ? 'up' : 'down');
      td[2].textContent = sign(g.week); td[2].className = 'num ' + (g.week >= 0 ? 'up' : 'down');
      td[3].textContent = sign(g.month); td[3].className = 'num ' + (g.month >= 0 ? 'up' : 'down');
      tr.querySelector('.idx-fill').style.width = g.index + '%';
      tr.querySelector('.idx .num').textContent = g.index;
      body.appendChild(tr);
    }
    // Évolution des positions nettes sur un an.
    if (cotChart) cotChart.remove();
    cotChart = LightweightCharts.createChart($('cot-chart'), {
      autoSize: true,
    localization: { locale: 'fr-FR' },
      layout: { background: { color: COL.surface }, textColor: COL.muted, fontFamily: 'IBM Plex Mono, monospace', fontSize: 11 },
      grid: { vertLines: { visible: false }, horzLines: { color: 'rgba(38,49,71,0.5)' } },
      rightPriceScale: { borderColor: COL.line }, timeScale: { borderColor: COL.line },
      handleScroll: false, handleScale: false,
    });
    const colors = { banks: COL.gold, funds: COL.bull, hedge: '#7aa7ff', prod: COL.muted };
    const year = data.series.slice(-52);
    for (const g of data.market.groups) {
      const s = cotChart.addLineSeries({ color: colors[g.id], lineWidth: 2, title: g.name.split(' (')[0], priceLineVisible: false, lastValueVisible: false, priceFormat: { type: 'price', precision: 0, minMove: 1 } });
      s.setData(year.map(x => ({ time: x.date, value: x[g.id].net })));
    }
    cotChart.timeScale().fitContent();
  }

  // ---------- Verdict ----------
  function setGauge(id, v) {
    const bar = $(id);
    if (v == null) { bar.style.width = '0'; $(id + '-val').textContent = '—'; return; }
    const w = Math.abs(v) / 2;
    bar.style.left = v >= 0 ? '50%' : (50 - w) + '%';
    bar.style.width = w + '%';
    bar.style.background = v >= 0 ? COL.bull : COL.bear;
    $(id + '-val').textContent = (v > 0 ? '+' : '') + v;
  }

  function label(v) {
    if (v >= 45) return ['Acheteur fort', 'bull'];
    if (v >= 15) return ['Plutôt acheteur', 'bull'];
    if (v <= -45) return ['Vendeur fort', 'bear'];
    if (v <= -15) return ['Plutôt vendeur', 'bear'];
    return ['Neutre', ''];
  }

  function renderVerdict() {
    const cot = state.cot[state.sym];
    const cb = cot && cot.summary ? cot.summary.bias : null;
    const sb = state.smc ? state.smc.score : null;
    setGauge('g-cot', cb); setGauge('g-smc', sb);
    $('g-smc-sub').textContent = state.candles ? 'SMC ' + (state.source.startsWith('Fichier') ? 'fichier' : state.tf) : 'SMC';
    const pill = $('v-pill');
    let title, text, cls;
    if (cb == null && sb == null) {
      title = 'En attente de données'; cls = ''; text = 'Les positions des institutions et les bougies sont en cours de chargement.';
    } else if (cb != null && sb != null && Math.sign(cb) !== Math.sign(sb) && Math.abs(cb) >= 15 && Math.abs(sb) >= 15) {
      title = 'Désaccord : prudence'; cls = 'warn';
      text = 'Les institutions sont ' + (cb > 0 ? 'acheteuses' : 'vendeuses') + ' sur le fond, mais le graphique montre une pression ' + (sb > 0 ? 'acheteuse' : 'vendeuse') + '. Mieux vaut attendre que le graphique rejoigne le camp des institutions.';
    } else {
      const v = Math.round(cb != null && sb != null ? (cb + sb) / 2 : (cb != null ? cb : sb));
      const [t, c] = label(v); title = t; cls = c;
      const parts = [];
      if (cb != null) {
        const f = cot.summary.groups.find(g => g.id === 'funds');
        parts.push('Les ' + f.name.split(' (')[0].toLowerCase() + ' sont ' + (f.month >= 0 ? 'en train d\'acheter' : 'en train de vendre') + ' depuis 4 semaines (' + (f.month > 0 ? '+' : '') + fmt.format(Math.round(f.month)) + ' contrats nets).');
      } else parts.push('Le rapport COT n\'est pas chargé.');
      if (state.smc) parts.push(state.smc.reasons[0] ? state.smc.reasons.join('. ') + '.' : 'Pas d\'empreinte nette sur le graphique.');
      else parts.push('Importe des bougies pour ajouter l\'analyse du graphique.');
      text = parts.join(' ');
    }
    $('v-title').textContent = title;
    $('v-text').textContent = text;
    pill.textContent = state.sym + (cls === 'warn' ? ' · signaux opposés' : cb != null || sb != null ? ' · ' + label(Math.round(((cb ?? sb) + (sb ?? cb)) / 2))[0].toLowerCase() : '');
    pill.className = 'pill ' + cls;
  }

  // ---------- Chargement ----------
  let loadSeq = 0;
  async function loadCandles() {
    const seq = ++loadSeq;
    const sym = state.sym;
    state.candles = null; state.smc = null;
    const empty = $('chart-empty');
    $('chart-title').textContent = sym;
    if (state.imported[sym]) {
      setCandles(state.imported[sym].candles, state.imported[sym].source);
      return;
    }
    if (!Prices.LIVE[sym]) {
      empty.hidden = false;
      empty.textContent = 'Pas de flux de prix gratuit pour le Nasdaq. Exporte tes bougies depuis MT5 ou TradingView, puis touche « Importer ».';
      $('chart-source').textContent = '';
      renderAll(); return;
    }
    empty.hidden = false; empty.textContent = 'Chargement des bougies…';
    try {
      const c = await Prices.fetchLive(sym, state.tf, 500);
      if (seq !== loadSeq) return;
      setCandles(c, 'Binance ' + Prices.LIVE[sym] + (sym === 'XAUUSD' ? ' (jeton adossé à l\'or, suit le prix de l\'once)' : '') + ' · ' + state.tf + ' · mis à jour ' + new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }));
    } catch (e) {
      if (seq !== loadSeq) return;
      empty.hidden = false;
      empty.textContent = 'Impossible de charger les prix (' + e.message + '). Vérifie ta connexion, ou importe un fichier MT5 / TradingView.';
      renderAll();
    }
  }

  function setCandles(c, source) {
    state.candles = c; state.source = source;
    state.smc = SMC.analyze(c);
    $('chart-source').textContent = source;
    renderAll();
  }

  async function loadCot(sym) {
    if (state.cot[sym] && !state.cot[sym].error) return;
    try { state.cot[sym] = await COT.fetchMarket(sym, 156); }
    catch (e) { state.cot[sym] = { error: e.message }; }
    if (sym === state.sym) { renderCot(); renderVerdict(); }
  }

  function renderAll() { renderChart(); renderEvents(); renderCot(); renderVerdict(); }

  // ---------- Interactions ----------
  function selectMarket(sym) {
    state.sym = sym;
    store.set('sym', sym);
    document.querySelectorAll('.markets button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.sym === sym)));
    renderCot();
    loadCandles();
    loadCot(sym);
  }
  document.querySelectorAll('.markets button').forEach(b => b.addEventListener('click', () => selectMarket(b.dataset.sym)));
  $('tf').addEventListener('change', e => { state.tf = e.target.value; store.set('tf', state.tf); delete state.imported[state.sym]; loadCandles(); });
  $('refresh').addEventListener('click', () => { delete state.cot[state.sym]; delete state.imported[state.sym]; loadCandles(); loadCot(state.sym); });
  $('csv').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const c = Prices.parseCsv(await file.text());
      state.imported[state.sym] = { candles: c, source: 'Fichier ' + file.name + ' · ' + c.length + ' bougies' };
      setCandles(c, state.imported[state.sym].source);
    } catch (err) {
      const empty = $('chart-empty');
      empty.hidden = false;
      empty.textContent = 'Fichier non reconnu : ' + err.message;
    }
  });

  // Actualisation automatique des prix en direct toutes les minutes.
  setInterval(() => { if (!document.hidden && Prices.LIVE[state.sym] && !state.imported[state.sym]) loadCandles(); }, 60000);

  const savedTf = store.get('tf');
  if (savedTf) { state.tf = savedTf; $('tf').value = savedTf; }
  selectMarket(store.get('sym') || 'XAUUSD');

  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
