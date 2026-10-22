// K2K : écran principal. Croise le biais COT (fond) et le biais SMC (timing) pour le marché choisi.
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const css = getComputedStyle(document.documentElement);
  const C = name => css.getPropertyValue(name).trim();
  const COL = { bull: C('--bull'), bear: C('--bear'), gold: C('--gold'), warn: C('--warn'), muted: C('--muted'), line: C('--line'), fg: C('--fg'), surface: C('--surface') };

  // Unités analysées ensemble ; les grandes unités pèsent plus lourd dans la note globale du graphique.
  const TFS = [
    { tf: '4h', label: '4h', sec: 14400, weight: 3 },
    { tf: '1h', label: '1h', sec: 3600, weight: 2 },
    { tf: '30m', label: '30m', sec: 1800, weight: 1.5 },
    { tf: '15m', label: '15m', sec: 900, weight: 1 },
    { tf: '5m', label: '5m', sec: 300, weight: 1 },
  ];
  const PAPER = { bg: C('--paper'), grid: C('--paper-line'), ink: C('--paper-ink'), buy: C('--buy'), sell: C('--sell') };
  const CANDLES = { upColor: '#1f9d74', downColor: '#e0444f', borderUpColor: '#1f9d74', borderDownColor: '#e0444f', wickUpColor: '#1f9d74', wickDownColor: '#e0444f' };
  const state = { sym: 'XAUUSD', tf: '15m', frames: {}, source: '', cot: {}, imported: {}, fitted: '' };
  const frame = () => state.frames[state.tf] || null;
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
    layout: { background: { color: PAPER.bg }, textColor: PAPER.ink, fontFamily: 'IBM Plex Mono, monospace' },
    grid: { vertLines: { color: PAPER.grid }, horzLines: { color: PAPER.grid } },
    rightPriceScale: { borderColor: PAPER.grid },
    timeScale: { borderColor: PAPER.grid, timeVisible: true, secondsVisible: false },
    crosshair: { mode: 0 },
  });
  const candleSeries = chart.addCandlestickSeries(CANDLES);

  function drawZones() {
    const r = chartEl.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    zones.width = r.width * dpr; zones.height = r.height * dpr;
    const ctx = zones.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, r.width, r.height);
    const f = frame();
    if (!f) return;
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
    for (const g of f.smc.fvgs.filter(g => !g.filled).slice(-6)) box(g.time, g.top, g.bottom, 'rgba(196,150,40,0.10)', 'rgba(196,150,40,0.7)', [4, 3]);
    for (const o of f.smc.orderBlocks.filter(o => o.status !== 'invalidé').slice(-4)) {
      box(o.time, o.top, o.bottom, o.dir > 0 ? 'rgba(21,154,140,0.14)' : 'rgba(224,68,79,0.14)', o.dir > 0 ? PAPER.buy : PAPER.sell);
    }
  }
  chart.timeScale().subscribeVisibleTimeRangeChange(() => requestAnimationFrame(drawZones));
  new ResizeObserver(() => requestAnimationFrame(drawZones)).observe(chartEl);

  function renderChart() {
    const empty = $('chart-empty');
    const f = frame();
    $('chart-title').textContent = state.sym + ' · ' + state.tf;
    if (!f) {
      candleSeries.setData([]); candleSeries.setMarkers([]);
      drawZones();
      return;
    }
    empty.hidden = true;
    candleSeries.setData(f.candles.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
    const s = f.smc, markers = [];
    const narrow = chartEl.clientWidth < 600;
    for (const e of s.events.slice(narrow ? -4 : -10)) markers.push({ time: e.time, position: e.dir > 0 ? 'belowBar' : 'aboveBar', color: e.type === 'CHoCH' ? COL.gold : (e.dir > 0 ? COL.bull : COL.bear), shape: e.dir > 0 ? 'arrowUp' : 'arrowDown', text: e.type });
    for (const w of s.sweeps.slice(narrow ? -2 : -6)) markers.push({ time: w.time, position: w.dir > 0 ? 'belowBar' : 'aboveBar', color: COL.warn, shape: 'circle', text: '' });
    markers.sort((a, b) => a.time - b.time);
    candleSeries.setMarkers(markers);
    // On recadre seulement quand on change de marché ou d'unité, pas à chaque actualisation.
    const key = state.sym + state.tf;
    if (state.fitted !== key) {
      state.fitted = key;
      chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, f.candles.length - (narrow ? 80 : 150)), to: f.candles.length + 4 });
    }
    requestAnimationFrame(drawZones);
  }

  // ---------- Multi-unités ----------
  function mtfScore() {
    let sum = 0, w = 0;
    for (const t of TFS) { const f = state.frames[t.tf]; if (f) { sum += f.smc.score * t.weight; w += t.weight; } }
    return w ? Math.round(sum / w) : null;
  }

  function renderMtf() {
    const box = $('mtf');
    box.textContent = '';
    for (const t of TFS) {
      const f = state.frames[t.tf];
      const row = document.createElement('button');
      row.type = 'button'; row.className = 'mtf-row'; row.setAttribute('role', 'tab');
      row.setAttribute('aria-selected', String(t.tf === state.tf));
      row.innerHTML = '<span class="mtf-tf"></span><span class="mtf-trend"></span><span class="mtf-last"></span><span class="mtf-score"></span>';
      row.querySelector('.mtf-tf').textContent = t.label;
      const tr = row.querySelector('.mtf-trend'), last = row.querySelector('.mtf-last'), sc = row.querySelector('.mtf-score');
      if (!f) {
        tr.textContent = '—'; tr.className = 'mtf-trend flat';
        last.textContent = state.loading ? 'Chargement…' : 'Pas de données';
      } else {
        const v = f.smc.score;
        tr.textContent = v >= 15 ? '▲ Haussier' : v <= -15 ? '▼ Baissier' : '■ Neutre';
        tr.className = 'mtf-trend ' + (v >= 15 ? 'bull' : v <= -15 ? 'bear' : 'flat');
        const ev = f.smc.events[f.smc.events.length - 1];
        last.textContent = ev ? ev.type + (ev.dir > 0 ? ' ↑ ' : ' ↓ ') + price(ev.price) : 'Aucune cassure';
        sc.textContent = (v > 0 ? '+' : '') + v;
        sc.className = 'mtf-score ' + (v >= 15 ? 'bull' : v <= -15 ? 'bear' : '');
      }
      row.addEventListener('click', () => selectTf(t.tf));
      box.appendChild(row);
    }
  }


  // ---------- Scanner d'order blocks ----------
  // Zones encore valides (non cassées), les plus proches du prix d'abord.
  function liveZones(f) {
    const last = f.candles[f.candles.length - 1].close;
    return f.smc.orderBlocks.filter(o => o.status !== 'invalidé')
      .map(o => ({ ...o, level: o.dir > 0 ? o.top : o.bottom, dist: Math.abs((o.dir > 0 ? o.top : o.bottom) - last) / last }))
      .sort((a, b) => a.dist - b.dist).slice(0, 5);
  }

  const scanCharts = [];
  function renderScanner() {
    const grid = $('scan-grid');
    while (scanCharts.length) scanCharts.pop().remove();
    grid.textContent = '';
    const near = [];
    for (const t of TFS) {
      const f = state.frames[t.tf];
      const card = document.createElement('button');
      card.type = 'button'; card.className = 'scan-card';
      card.setAttribute('aria-pressed', String(t.tf === state.tf));
      card.innerHTML = '<div class="scan-head"><b></b><span></span></div><div class="scan-chart"></div>';
      card.querySelector('b').textContent = state.sym + ' · ' + t.label;
      grid.appendChild(card);
      card.addEventListener('click', () => { selectTf(t.tf); $('chart').scrollIntoView({ behavior: 'smooth', block: 'center' }); });
      if (!f) { card.querySelector('span').textContent = state.loading ? 'Chargement…' : 'Pas de données'; continue; }
      const zones = liveZones(f);
      const buys = zones.filter(z => z.dir > 0).length;
      card.querySelector('span').textContent = buys + ' achat · ' + (zones.length - buys) + ' vente';
      const ch = LightweightCharts.createChart(card.querySelector('.scan-chart'), {
        autoSize: true, localization: { locale: 'fr-FR' },
        layout: { background: { color: PAPER.bg }, textColor: PAPER.ink, fontFamily: 'IBM Plex Mono, monospace', fontSize: 10 },
        grid: { vertLines: { visible: false }, horzLines: { color: PAPER.grid } },
        rightPriceScale: { borderVisible: false }, timeScale: { borderVisible: false, timeVisible: true },
        handleScroll: false, handleScale: false, crosshair: { mode: 2 },
      });
      scanCharts.push(ch);
      const se = ch.addCandlestickSeries(CANDLES);
      se.setData(f.candles.slice(-120).map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
      for (const z of zones) {
        se.createPriceLine({
          price: z.level, color: z.dir > 0 ? PAPER.buy : PAPER.sell, lineWidth: 1,
          lineStyle: z.status === 'frais' ? LightweightCharts.LineStyle.Solid : LightweightCharts.LineStyle.Dotted,
          axisLabelVisible: false, title: z.dir > 0 ? 'ZONE ACHAT' : 'ZONE VENTE',
        });
        near.push({ tf: t.label, z, last: f.candles[f.candles.length - 1].close });
      }
      ch.timeScale().fitContent();
    }
    const body = $('near-body');
    body.textContent = '';
    near.sort((a, b) => a.z.dist - b.z.dist);
    if (!near.length) { body.innerHTML = '<tr><td colspan="4">Aucune zone valide pour le moment.</td></tr>'; return; }
    for (const n of near.slice(0, 8)) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td class="num"></td><td><span class="tag"></span></td><td class="num"></td><td class="num"></td>';
      const td = tr.querySelectorAll('td');
      td[0].textContent = n.tf;
      const tag = td[1].querySelector('.tag');
      tag.textContent = (n.z.dir > 0 ? 'ACHAT' : 'VENTE') + (n.z.status === 'frais' ? '' : ' ·touchée');
      tag.className = 'tag ' + (n.z.dir > 0 ? 'buy' : 'sell');
      td[2].textContent = price(n.z.level);
      const inside = n.last <= n.z.top && n.last >= n.z.bottom;
      td[3].textContent = inside ? 'dans la zone' : (n.z.dist * 100).toFixed(2) + ' %';
      body.appendChild(tr);
    }
  }

  // ---------- Empreintes ----------
  function renderEvents() {
    const list = $('events');
    list.textContent = '';
    $('events-tf').textContent = state.tf;
    const fr = frame();
    if (!fr) { list.innerHTML = '<li><span class="dot"></span><div class="why">Pas encore de bougies pour ce marché.</div><span></span></li>'; return; }
    const s = fr.smc, items = [];
    for (const e of s.events) items.push({ t: e.time, dir: e.dir, what: e.type + (e.dir > 0 ? ' haussier' : ' baissier'), why: (e.type === 'CHoCH' ? 'La tendance change de camp : clôture ' : 'La tendance continue : clôture ') + (e.dir > 0 ? 'au-dessus de ' : 'sous ') + price(e.price) });
    for (const o of s.orderBlocks) if (o.status !== 'invalidé') items.push({ t: o.time, dir: o.dir, what: 'Order block ' + (o.dir > 0 ? 'acheteur' : 'vendeur') + ' (' + o.status + ')', why: 'Zone ' + price(o.bottom) + ' – ' + price(o.top) + ' : dernière bougie opposée avant la cassure' });
    for (const w of s.sweeps) items.push({ t: w.time, dir: w.dir, what: 'Chasse de liquidité', why: (w.dir > 0 ? 'Mèche sous ' : 'Mèche au-dessus de ') + price(w.level) + ' puis retour : les stops ont été pris' });
    for (const v of s.volume) items.push({ t: v.time, dir: v.dir, what: 'Volume x' + v.ratio.toFixed(1), why: 'Bougie ' + (v.dir > 0 ? 'acheteuse' : 'vendeuse') + ' avec un volume anormal' });
    for (const f of s.fvgs.filter(f => !f.filled).slice(-2)) items.push({ t: f.time, dir: f.dir, what: 'FVG ' + (f.dir > 0 ? 'haussier' : 'baissier') + ' non comblé', why: 'Déséquilibre ' + price(f.bottom) + ' – ' + price(f.top) + ' : le prix revient souvent le combler' });
    items.sort((a, b) => b.t - a.t);
    for (const it of items.slice(0, 6)) {
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
    const sb = mtfScore();
    setGauge('g-cot', cb); setGauge('g-smc', sb);
    const pill = $('v-pill');
    let title, text, cls;
    if (cb == null && sb == null) {
      title = 'En attente de données'; cls = ''; text = 'Les positions des institutions et les bougies sont en cours de chargement.';
    } else if (cb != null && sb != null && Math.sign(cb) !== Math.sign(sb) && Math.abs(cb) >= 15 && Math.abs(sb) >= 15) {
      title = 'Désaccord : prudence'; cls = 'warn';
      text = 'Les institutions sont ' + (cb > 0 ? 'acheteuses' : 'vendeuses') + ' sur le fond, mais le graphique montre une pression ' + (sb > 0 ? 'acheteuse' : 'vendeuse') + '. ' + alignText() + ' Mieux vaut attendre que le graphique rejoigne le camp des institutions.';
    } else {
      const v = Math.round(cb != null && sb != null ? (cb + sb) / 2 : (cb != null ? cb : sb));
      const [t, c] = label(v); title = t; cls = c;
      const parts = [];
      if (cb != null) {
        const f = cot.summary.groups.find(g => g.id === 'funds');
        parts.push('Les ' + f.name.split(' (')[0].toLowerCase() + ' sont ' + (f.month >= 0 ? 'en train d\'acheter' : 'en train de vendre') + ' depuis 4 semaines (' + (f.month > 0 ? '+' : '') + fmt.format(Math.round(f.month)) + ' contrats nets).');
      } else parts.push('Le rapport COT n\'est pas chargé.');
      if (sb != null) parts.push(alignText());
      else parts.push('Importe des bougies pour ajouter l\'analyse du graphique.');
      text = parts.join(' ');
    }
    $('v-title').textContent = title;
    $('v-text').textContent = text;
    pill.textContent = state.sym + (cls === 'warn' ? ' · signaux opposés' : cb != null || sb != null ? ' · ' + label(Math.round(((cb ?? sb) + (sb ?? cb)) / 2))[0].toLowerCase() : '');
    pill.className = 'pill ' + cls;
  }

  // Résumé de l'alignement : combien d'unités vont dans le même sens.
  function alignText() {
    const up = [], down = [];
    for (const t of TFS) { const f = state.frames[t.tf]; if (!f) continue; if (f.smc.score >= 15) up.push(t.label); else if (f.smc.score <= -15) down.push(t.label); }
    const n = TFS.filter(t => state.frames[t.tf]).length;
    if (up.length === n) return 'Toutes les unités sont haussières.';
    if (down.length === n) return 'Toutes les unités sont baissières.';
    const parts = [];
    if (up.length) parts.push('haussier en ' + up.join(', '));
    if (down.length) parts.push('baissier en ' + down.join(', '));
    return parts.length ? 'Graphique ' + parts.join(' ; ') + '.' : 'Graphique sans direction claire.';
  }

  // ---------- Chargement ----------
  let loadSeq = 0;
  async function loadCandles(silent) {
    const seq = ++loadSeq;
    const sym = state.sym;
    const empty = $('chart-empty');
    if (!silent) { state.frames = {}; state.loading = true; renderAll(); }
    if (state.imported[sym]) {
      state.frames = framesFromFile(state.imported[sym].candles);
      state.loading = false;
      $('chart-source').textContent = state.imported[sym].source;
      if (!state.frames[state.tf]) state.tf = (TFS.slice().reverse().find(t => state.frames[t.tf]) || TFS[4]).tf;
      renderAll(); return;
    }
    if (!Prices.LIVE[sym]) {
      state.loading = false;
      empty.hidden = false;
      empty.textContent = 'Pas de flux de prix gratuit pour le Nasdaq. Exporte tes bougies 5 min depuis MT5 ou TradingView, puis touche « Importer un fichier ».';
      $('chart-source').textContent = '';
      renderAll(); return;
    }
    if (!silent) { empty.hidden = false; empty.textContent = 'Chargement des bougies…'; }
    const results = await Promise.allSettled(TFS.map(t => Prices.fetchLive(sym, t.tf, 500)));
    if (seq !== loadSeq) return;
    state.loading = false;
    const frames = {};
    let err = null;
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') { const smc = SMC.analyze(r.value); if (smc) frames[TFS[i].tf] = { candles: r.value, smc }; }
      else err = r.reason;
    });
    if (!Object.keys(frames).length) {
      empty.hidden = false;
      empty.textContent = 'Impossible de charger les prix (' + (err ? err.message : 'aucune donnée') + '). Vérifie ta connexion, ou importe un fichier MT5 / TradingView.';
      renderAll(); return;
    }
    state.frames = frames;
    $('chart-source').textContent = 'Binance ' + Prices.LIVE[sym] + (sym === 'XAUUSD' ? ' (jeton adossé à l\'or)' : '') + ' · mis à jour ' + new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    renderAll();
  }

  // Un fichier importé (5 min par exemple) sert à reconstruire les unités plus grandes.
  function framesFromFile(c) {
    const diffs = [];
    for (let i = 1; i < Math.min(c.length, 200); i++) diffs.push(c[i].time - c[i - 1].time);
    diffs.sort((a, b) => a - b);
    const base = diffs[Math.floor(diffs.length / 2)] || 300;
    const out = {};
    for (const t of TFS) {
      if (t.sec < base) continue;
      const bars = t.sec === base ? c : resample(c, t.sec);
      const smc = SMC.analyze(bars);
      if (smc) out[t.tf] = { candles: bars, smc };
    }
    return out;
  }

  function resample(c, sec) {
    const out = [];
    for (const k of c) {
      const t = Math.floor(k.time / sec) * sec;
      const last = out[out.length - 1];
      if (last && last.time === t) {
        last.high = Math.max(last.high, k.high); last.low = Math.min(last.low, k.low); last.close = k.close; last.volume += k.volume;
      } else out.push({ time: t, open: k.open, high: k.high, low: k.low, close: k.close, volume: k.volume });
    }
    return out;
  }

  async function loadCot(sym) {
    if (state.cot[sym] && !state.cot[sym].error) return;
    try { state.cot[sym] = await COT.fetchMarket(sym, 156); }
    catch (e) { state.cot[sym] = { error: e.message }; }
    if (sym === state.sym) { renderCot(); renderVerdict(); }
  }

  function renderAll() { renderMtf(); renderScanner(); renderChart(); renderEvents(); renderCot(); renderVerdict(); }

  // ---------- Interactions ----------
  function selectMarket(sym) {
    state.sym = sym;
    store.set('sym', sym);
    document.querySelectorAll('.markets button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.sym === sym)));
    state.fitted = '';
    renderCot();
    loadCandles();
    loadCot(sym);
  }
  function selectTf(tf) {
    state.tf = tf;
    store.set('tf', tf);
    renderMtf(); renderChart(); renderEvents();
    document.querySelectorAll('.scan-card').forEach((c, i) => c.setAttribute('aria-pressed', String(TFS[i].tf === tf)));
  }
  document.querySelectorAll('.markets button').forEach(b => b.addEventListener('click', () => selectMarket(b.dataset.sym)));
  $('refresh').addEventListener('click', () => { delete state.cot[state.sym]; delete state.imported[state.sym]; loadCandles(); loadCot(state.sym); });
  $('csv').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const c = Prices.parseCsv(await file.text());
      state.imported[state.sym] = { candles: c, source: 'Fichier ' + file.name + ' · ' + c.length + ' bougies' };
      state.fitted = '';
      loadCandles();
    } catch (err) {
      const empty = $('chart-empty');
      empty.hidden = false;
      empty.textContent = 'Fichier non reconnu : ' + err.message;
    }
  });

  // Actualisation automatique des prix en direct toutes les minutes.
  setInterval(() => { if (!document.hidden && Prices.LIVE[state.sym] && !state.imported[state.sym]) loadCandles(true); }, 60000);

  const savedTf = store.get('tf');
  if (savedTf && TFS.some(t => t.tf === savedTf)) state.tf = savedTf;
  selectMarket(store.get('sym') || 'XAUUSD');

  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
